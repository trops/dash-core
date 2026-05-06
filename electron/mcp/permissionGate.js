/**
 * permissionGate.js
 *
 * Per-widget gating for MCP tool calls.
 *
 * When `gateToolCall` is invoked with a widget identity, server name,
 * tool name, and tool arguments, it consults the widget's GRANTED
 * permissions (electron/mcp/grantedPermissions.js) and either permits
 * the call or returns a clear denial reason.
 *
 * **Granted vs declared (Slice 2):** the widget's package.json
 * `dash.permissions.mcp` block is the *request* — read by
 * widgetPermissions.js and shown to the user at install time. The
 * *grant* is what the user actually approved. The runtime gate reads
 * grants only. A widget with a declared manifest but no grant entry
 * has no MCP access — fail-closed. The user grants permissions via
 * the install consent modal or Settings → Privacy & Security.
 *
 * Two layers:
 *
 *   1. **Tool-name allowlist** — the granted `tools[]` array for the
 *      target server determines which tool names this widget may
 *      invoke. Anything outside the list is rejected.
 *
 *   2. **Path-argument containment** — for tools whose arguments
 *      include a path-shaped key (`path`, `uri`, `filepath`, `file`,
 *      `directory`), the supplied path is validated with safePath()
 *      against the widget's granted `readPaths` or `writePaths` for
 *      the target server. The read/write distinction is heuristic
 *      based on the tool name (e.g. `write_file` is treated as a
 *      write).
 *
 * This is the runtime enforcement layer. Install-time consent UI is
 * Slice 2. Per-dashboard MCP-server scope reconfiguration is Slice 3.
 * When the feature flag is OFF (default), this gate is bypassed
 * entirely; mcpController behaves as before. When ON, every callTool
 * dispatch goes through this gate.
 */
"use strict";

const { getGrant, setGrant } = require("./grantedPermissions");
const { safePath } = require("../utils/safePath");
const { requestApproval } = require("./jitConsent");
const { lookup: lookupMountToken } = require("../security/mountTokenRegistry");
const { resolveSiblings } = require("../security/resolveSiblings");

// Lazy default for the registry snapshot — `widgetRegistry.js` pulls
// in a lot, so we don't want to require it at module-load time. The
// JIT path calls this only on escalation. Tests inject their own via
// `opts.getRegistrySnapshot` to avoid touching the real registry.
function _defaultRegistrySnapshot() {
  try {
    const reg = require("../widgetRegistry").getWidgetRegistry();
    return reg && reg.widgets ? reg.widgets : null;
  } catch (_) {
    return null;
  }
}

// See `electron/security/mountTokenRegistry.js`. When a token is
// supplied it's the trusted identity source — gates resolve widgetId
// via lookupMountToken and ignore renderer-claimed widgetId. Slice 1
// keeps the legacy widgetId-only path working (additive); slice 2 will
// flip to deny-without-token.
function _resolveIdentity({ token, widgetId }) {
  if (typeof token === "string" && token.length > 0) {
    const resolved = lookupMountToken(token);
    if (resolved) return { widgetId: resolved, source: "token" };
    return { widgetId: null, source: "token-unknown" };
  }
  return { widgetId: widgetId || null, source: "legacy" };
}

// Argument keys that look like paths. Different MCP servers use
// different conventions; this list covers the common filesystem-style
// servers. Extensible — add as new patterns surface.
const PATH_ARG_KEYS = ["path", "uri", "filepath", "file", "directory"];

// Heuristic: tool names matching this regex are treated as writes for
// purposes of choosing readPaths vs writePaths. The match is intentionally
// broad — we'd rather treat an ambiguous tool as a write (stricter) than
// as a read.
const WRITE_TOOL_PATTERN =
  /(^|_)(write|create|edit|delete|remove|append|move|rename|chmod|chown|mkdir)/i;

function isWriteTool(toolName) {
  if (typeof toolName !== "string") return false;
  return WRITE_TOOL_PATTERN.test(toolName);
}

/**
 * @returns {{ allow: true } | { allow: false, reason: string }}
 */
function gateToolCall({ widgetId, token, serverName, toolName, args }) {
  const resolved = _resolveIdentity({ token, widgetId });
  if (resolved.source === "token-unknown") {
    return {
      allow: false,
      reason: "MCP gate: unknown mount token; widget identity not verifiable",
    };
  }
  widgetId = resolved.widgetId;
  if (!widgetId) {
    return {
      allow: false,
      reason: "no widgetId supplied; cannot determine permissions",
    };
  }

  const perms = getGrant(widgetId);
  if (!perms) {
    return {
      allow: false,
      reason:
        "widget '" +
        widgetId +
        "' has no MCP permissions granted; user must approve at install time or in Settings → Privacy & Security",
    };
  }

  const serverPerms = perms.servers && perms.servers[serverName];
  if (!serverPerms) {
    return {
      allow: false,
      reason:
        "widget '" +
        widgetId +
        "' is not authorized to call '" +
        serverName +
        "'",
    };
  }

  if (!serverPerms.tools.includes(toolName)) {
    return {
      allow: false,
      reason:
        "tool '" +
        toolName +
        "' is not in the allowlist for widget '" +
        widgetId +
        "' on server '" +
        serverName +
        "'",
    };
  }

  // Path-argument containment. Only checked when the tool's args
  // include a path-shaped key.
  const isWrite = isWriteTool(toolName);
  // Write tools must use writePaths; read tools may use either
  // readPaths or writePaths (write access implies read access).
  const allowedPaths = isWrite
    ? serverPerms.writePaths
    : [...serverPerms.readPaths, ...serverPerms.writePaths];

  if (args && typeof args === "object") {
    for (const key of PATH_ARG_KEYS) {
      const v = args[key];
      if (typeof v !== "string" || !v) continue;
      if (allowedPaths.length === 0) {
        return {
          allow: false,
          reason:
            "tool '" +
            toolName +
            "' uses path argument '" +
            key +
            "' but widget '" +
            widgetId +
            "' has no " +
            (isWrite ? "writePaths" : "readPaths or writePaths") +
            " declared for server '" +
            serverName +
            "'",
        };
      }
      try {
        safePath(v, allowedPaths);
      } catch (e) {
        return {
          allow: false,
          reason:
            "path argument '" +
            key +
            "' rejected: " +
            (e && e.message ? e.message : String(e)),
        };
      }
    }
  }

  return { allow: true };
}

/**
 * Merge `addition` (a grant blob) into the widget's existing grant. Used
 * by the JIT path to extend an existing grant with a new tool/path
 * without clobbering grants for other servers.
 */
function _mergeGrant(current, addition) {
  const out = {
    grantOrigin: addition.grantOrigin || current?.grantOrigin || null,
    servers: { ...(current?.servers || {}) },
  };
  for (const [name, perms] of Object.entries(addition.servers || {})) {
    const existing = out.servers[name] || {
      tools: [],
      readPaths: [],
      writePaths: [],
    };
    out.servers[name] = {
      tools: [...new Set([...(existing.tools || []), ...(perms.tools || [])])],
      readPaths: [
        ...new Set([...(existing.readPaths || []), ...(perms.readPaths || [])]),
      ],
      writePaths: [
        ...new Set([
          ...(existing.writePaths || []),
          ...(perms.writePaths || []),
        ]),
      ],
    };
  }
  return out;
}

/**
 * Async wrapper around gateToolCall that escalates "missing in grant"
 * denials to a just-in-time consent prompt when `opts.enableJit` is true.
 * On approval, the user's chosen grant shape (carried on
 * `decision.granted`) is merged into the persisted grant and the gate
 * re-evaluates. On denial / timeout / disabled-flag, returns the
 * synchronous decision unchanged.
 *
 * Escalation signal is STRUCTURAL, not message-based: if the requested
 * tool isn't listed in the widget's grant for the requested server, JIT
 * fires. This uniformly covers no-grant, server-not-in-grant, and
 * tool-not-in-server's-allowlist — all three are recoverable by adding
 * to the grant via the modal. If the tool IS in the grant, the sync
 * gate's verdict stands: any denial it returns is a structural-integrity
 * issue (path-arg traversal, path-arg without paths declared) that isn't
 * a consent gap and shouldn't prompt. Identity-resolution failures
 * (unknown token, missing widgetId) likewise short-circuit to the sync
 * verdict — those are abuse or caller bugs, not consent gaps.
 *
 * @returns {Promise<{ allow: true } | { allow: false, reason: string }>}
 */
async function gateToolCallWithJit(req, opts = {}) {
  if (!opts.enableJit) return gateToolCall(req);

  // Identity must resolve to a concrete widgetId. Unknown tokens and
  // missing widgetId are returned by the sync gate — those denials are
  // not recoverable via consent.
  const resolved = _resolveIdentity({
    token: req.token,
    widgetId: req.widgetId,
  });
  if (resolved.source === "token-unknown" || !resolved.widgetId) {
    return gateToolCall(req);
  }
  const verifiedWidgetId = resolved.widgetId;

  // Structural escalation: when the tool already exists in the grant,
  // the sync gate's verdict is authoritative — any denial is structural
  // (containment / scope) and not recoverable by re-prompting. When the
  // tool is missing from the grant, escalate regardless of which of the
  // three "missing" shapes caused it.
  const grant = getGrant(verifiedWidgetId);
  const hasToolInGrant = !!(
    grant &&
    grant.servers &&
    grant.servers[req.serverName] &&
    Array.isArray(grant.servers[req.serverName].tools) &&
    grant.servers[req.serverName].tools.includes(req.toolName)
  );
  if (hasToolInGrant) return gateToolCall(req);

  // Slice 5: resolve siblings so the modal can offer "Apply to all
  // widgets from <package>". Siblings are computed from the registry
  // snapshot (currently-installed widgets only — newly-installed
  // siblings after consent must re-prompt; supply-chain defense).
  const getRegistrySnapshot =
    opts.getRegistrySnapshot || _defaultRegistrySnapshot;
  const siblingInfo = resolveSiblings(verifiedWidgetId, getRegistrySnapshot());

  let decision;
  try {
    decision = await requestApproval(
      {
        widgetId: verifiedWidgetId,
        domain: "mcp",
        action: "callTool",
        args: {
          serverName: req.serverName,
          toolName: req.toolName,
          args: req.args || {},
        },
        packageId: siblingInfo.packageId,
        siblingWidgetIds: siblingInfo.siblingWidgetIds,
      },
      { timeoutMs: opts.timeoutMs },
    );
  } catch (e) {
    return {
      allow: false,
      reason: "JIT consent " + (e && e.message ? e.message : "failed"),
    };
  }

  if (!decision || decision.approve !== true) {
    return {
      allow: false,
      reason:
        "user declined JIT consent for widget '" +
        verifiedWidgetId +
        "' calling '" +
        req.toolName +
        "' on '" +
        req.serverName +
        "'",
    };
  }

  // The renderer is expected to carry the chosen grant shape on
  // decision.granted. Fall back to a minimal tool-level grant if the
  // shape is missing — never silently grant paths the user didn't
  // explicitly approve.
  const addition =
    decision.granted && typeof decision.granted === "object"
      ? decision.granted
      : {
          grantOrigin: "live",
          servers: {
            [req.serverName]: {
              tools: [req.toolName],
              readPaths: [],
              writePaths: [],
            },
          },
        };
  // Force grantOrigin: "live" regardless of what the renderer sent.
  addition.grantOrigin = "live";

  // Slice 5: when the user opted into "Apply to all widgets from
  // <package>", write the same merged grant for every sibling — each
  // merge re-reads that sibling's existing grant so we don't clobber
  // its prior grants on other servers/tools. When the option is off
  // (or no siblings were resolved), behave as before: single-widget
  // write to the requesting widget only.
  const targetWidgetIds =
    decision.applyToSiblings === true &&
    Array.isArray(siblingInfo.siblingWidgetIds) &&
    siblingInfo.siblingWidgetIds.length > 1
      ? siblingInfo.siblingWidgetIds
      : [verifiedWidgetId];

  try {
    for (const targetId of targetWidgetIds) {
      const current = getGrant(targetId);
      const merged = _mergeGrant(current, addition);
      setGrant(targetId, merged);
    }
  } catch (e) {
    return {
      allow: false,
      reason:
        "JIT consent: failed to persist grant: " +
        (e && e.message ? e.message : String(e)),
    };
  }

  // Re-evaluate against the freshly-persisted grant. If the user's
  // grant shape didn't actually cover the requested call (e.g. they
  // approved a different tool or path), the gate denies as usual.
  return gateToolCall(req);
}

module.exports = {
  gateToolCall,
  gateToolCallWithJit,
  isWriteTool,
  PATH_ARG_KEYS,
};
