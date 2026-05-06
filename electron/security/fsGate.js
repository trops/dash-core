/**
 * fsGate.js
 *
 * Per-widget gate for `mainApi.data.*` IPC handlers (Phase 2 of JIT
 * consent). Same shape as `electron/mcp/permissionGate.js` but for the
 * filesystem domain — saveToFile/readFromFile in dataController.
 *
 * The gate evaluates against the widget's persisted grant under
 * `grant.domains.fs.{readPaths,writePaths}`. The existing `safePath()`
 * containment in dataController is unchanged — that constrains paths
 * to the userData/Dashboard/data dir; this gate adds per-widget
 * identity scoping on top, so two widgets can't read each other's
 * files even though both are inside the data dir.
 *
 * Action → read/write classification by name. Read tools may match
 * either readPaths or writePaths (write access implies read); write
 * tools must match writePaths only.
 *
 * Filename matching:
 *   - Exact match
 *   - "*" wildcard in the grant matches any filename (escape hatch
 *     for users who want broad widget access; surfaced in the JIT
 *     modal as "no path scope — risky")
 *
 * Path-traversal protection lives in safePath; the gate doesn't
 * re-check it. The gate is purely an identity+filename allowlist on
 * top of safePath's containment.
 *
 * JIT escalation: when the runtime calls `gateFsCallWithJit` and the
 * gate denies for "no fs permissions granted", a permission-required
 * IPC fires and the user's response is merged into the persisted
 * grant. Other denial reasons (filename not in allowlist, write to a
 * read-only entry) stay synchronous.
 */
"use strict";

const { getGrant, setGrant } = require("../mcp/grantedPermissions");
const { requestApproval } = require("../mcp/jitConsent");
const { lookup: lookupMountToken } = require("./mountTokenRegistry");

// If a token is supplied, the gate resolves widgetId via the mount
// registry and ignores any renderer-supplied widgetId. Tokens are
// server-generated and bound to a widgetId at WidgetFactory mount —
// the renderer cannot fabricate a token for another widget. See
// `mountTokenRegistry.js`.
//
// Legacy callers without a token fall through to the existing
// widgetId-based path (Slice 1 keeps this for back-compat; Slice 2
// flips to deny).
function _resolveIdentity({ token, widgetId }) {
  if (typeof token === "string" && token.length > 0) {
    const resolved = lookupMountToken(token);
    if (resolved) return { widgetId: resolved, source: "token" };
    return { widgetId: null, source: "token-unknown" };
  }
  return { widgetId: widgetId || null, source: "legacy" };
}

// Action names treated as writes. Anything not in this set is a read.
// Conservative — when in doubt, classify as a read so write-protected
// grants don't accidentally allow writes.
const WRITE_ACTIONS = new Set([
  "saveToFile",
  "saveData", // future-proof: the renderer-facing API name
  "convertJsonToCsvFile",
  "parseXMLStream",
  "parseCSVStream",
  "readDataFromURL", // writes to toFilepath despite the name
  "transformFile",
]);

function isFsWriteAction(action) {
  return WRITE_ACTIONS.has(action);
}

function _filenameMatches(filename, allowedList) {
  if (!Array.isArray(allowedList) || allowedList.length === 0) return false;
  if (allowedList.includes("*")) return true;
  return allowedList.includes(filename);
}

/**
 * Synchronous gate evaluation.
 * @returns {{ allow: true } | { allow: false, reason: string }}
 */
function gateFsCall({ widgetId, token, action, args }) {
  const resolved = _resolveIdentity({ token, widgetId });
  if (resolved.source === "token-unknown") {
    return {
      allow: false,
      reason: "fs gate: unknown mount token; widget identity not verifiable",
    };
  }
  widgetId = resolved.widgetId;
  if (!widgetId) {
    return {
      allow: false,
      reason: "no widgetId supplied; cannot determine fs permissions",
    };
  }

  const filename = args && typeof args === "object" ? args.filename : null;
  if (typeof filename !== "string" || !filename) {
    return {
      allow: false,
      reason:
        "fs gate: action '" +
        action +
        "' requires args.filename (got: " +
        JSON.stringify(filename) +
        ")",
    };
  }

  const grant = getGrant(widgetId);
  const fsPerms = grant && grant.domains && grant.domains.fs;
  if (!fsPerms) {
    return {
      allow: false,
      reason:
        "widget '" +
        widgetId +
        "' has no fs permissions granted; user must approve at runtime or in Settings → Privacy & Security",
    };
  }

  // Slice 4: per-action allowlist. When `actions[]` is present and
  // non-empty, only listed actions are allowed (path scope still
  // applies). When absent / empty, fall through to legacy behavior
  // (any read/write-class action allowed against the path scope) so
  // pre-slice grants keep working — Option A migration.
  if (Array.isArray(fsPerms.actions) && fsPerms.actions.length > 0) {
    if (!fsPerms.actions.includes(action)) {
      return {
        allow: false,
        reason:
          "fs gate: action '" +
          action +
          "' not in actions allowlist for widget '" +
          widgetId +
          "'",
      };
    }
  }

  const isWrite = isFsWriteAction(action);

  if (isWrite) {
    if (!Array.isArray(fsPerms.writePaths) || fsPerms.writePaths.length === 0) {
      return {
        allow: false,
        reason:
          "fs gate: widget '" +
          widgetId +
          "' has no writePaths granted for action '" +
          action +
          "'",
      };
    }
    if (!_filenameMatches(filename, fsPerms.writePaths)) {
      return {
        allow: false,
        reason:
          "fs gate: filename '" +
          filename +
          "' rejected — not in allowed writePaths for widget '" +
          widgetId +
          "'",
      };
    }
    return { allow: true };
  }

  // Read action — may use readPaths OR writePaths (write implies read)
  if (
    _filenameMatches(filename, fsPerms.readPaths) ||
    _filenameMatches(filename, fsPerms.writePaths)
  ) {
    return { allow: true };
  }
  return {
    allow: false,
    reason:
      "fs gate: filename '" +
      filename +
      "' rejected — not in allowed readPaths or writePaths for widget '" +
      widgetId +
      "'",
  };
}

/**
 * Merge an approved JIT decision's grant into the widget's existing
 * grant under domains.fs. Same shape as permissionGate._mergeGrant
 * but scoped to fs.
 */
function _mergeFsGrant(current, addition) {
  const out = {
    grantOrigin: addition.grantOrigin || current?.grantOrigin || null,
    servers: { ...(current?.servers || {}) },
    domains: { ...(current?.domains || {}) },
  };
  const additionFs = addition?.domains?.fs;
  if (additionFs) {
    const existingFs = out.domains.fs || { readPaths: [], writePaths: [] };
    const merged = {
      readPaths: [
        ...new Set([
          ...(existingFs.readPaths || []),
          ...(Array.isArray(additionFs.readPaths) ? additionFs.readPaths : []),
        ]),
      ],
      writePaths: [
        ...new Set([
          ...(existingFs.writePaths || []),
          ...(Array.isArray(additionFs.writePaths)
            ? additionFs.writePaths
            : []),
        ]),
      ],
    };
    // Slice 4: union `actions[]`. Only emit the field when at least
    // one side declared it — preserves Option A migration (a legacy
    // grant being extended without an action allowlist on the
    // addition still has none after merge).
    const existingActions = Array.isArray(existingFs.actions)
      ? existingFs.actions
      : null;
    const additionActions = Array.isArray(additionFs.actions)
      ? additionFs.actions
      : null;
    if (existingActions || additionActions) {
      merged.actions = [
        ...new Set([...(existingActions || []), ...(additionActions || [])]),
      ];
    }
    out.domains.fs = merged;
  }
  return out;
}

/**
 * Async gate that escalates "missing in grant" fs denials to a JIT
 * consent prompt when `opts.enableJit` is true. Escalation signal is
 * STRUCTURAL, not message-based: if the requested action+filename
 * isn't covered by the widget's grant (action absent from `actions[]`,
 * or filename absent from the appropriate readPaths/writePaths), JIT
 * fires. Identity-resolution failures and malformed-args denials short-
 * circuit to the sync gate's verdict — those are abuse or caller bugs,
 * not consent gaps. Once the request IS covered by the grant, the sync
 * gate is authoritative (any denial it returns is structural).
 */
async function gateFsCallWithJit(req, opts = {}) {
  if (!opts.enableJit) return gateFsCall(req);

  // Identity must resolve to a concrete widgetId. Unknown tokens and
  // missing widgetId are returned by the sync gate — those denials
  // aren't recoverable via consent.
  const resolved = _resolveIdentity({
    token: req.token,
    widgetId: req.widgetId,
  });
  if (resolved.source === "token-unknown" || !resolved.widgetId) {
    return gateFsCall(req);
  }
  const verifiedWidgetId = resolved.widgetId;

  // Args must be well-formed enough to derive a filename — malformed
  // calls are caller bugs, not consent gaps.
  const filename =
    req.args && typeof req.args === "object" ? req.args.filename : null;
  if (typeof filename !== "string" || !filename) {
    return gateFsCall(req);
  }

  // Structural escalation: when the existing grant covers this
  // (action, filename) pair, the sync gate's verdict is authoritative.
  // Otherwise the request is a consent gap; escalate. Mirrors
  // permissionGate.gateToolCallWithJit's "tool in grant?" check.
  const grant = getGrant(verifiedWidgetId);
  const fsPerms = grant && grant.domains && grant.domains.fs;
  if (fsPerms) {
    const actionsAllow =
      !Array.isArray(fsPerms.actions) ||
      fsPerms.actions.length === 0 ||
      fsPerms.actions.includes(req.action);
    const isWrite = isFsWriteAction(req.action);
    const allowedPaths = isWrite
      ? fsPerms.writePaths || []
      : [...(fsPerms.readPaths || []), ...(fsPerms.writePaths || [])];
    const pathsAllow = _filenameMatches(filename, allowedPaths);
    if (actionsAllow && pathsAllow) {
      return gateFsCall(req);
    }
  }

  let decision;
  try {
    decision = await requestApproval(
      {
        widgetId: verifiedWidgetId,
        domain: "fs",
        action: req.action,
        args: req.args || {},
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
        "' calling fs '" +
        req.action +
        "'",
    };
  }

  const fallbackFilename = req.args?.filename || "*";
  const fallbackIsWrite = isFsWriteAction(req.action);
  const addition =
    decision.granted && typeof decision.granted === "object"
      ? decision.granted
      : {
          grantOrigin: "live",
          domains: {
            fs: {
              actions: [req.action],
              readPaths: !fallbackIsWrite ? [fallbackFilename] : [],
              writePaths: fallbackIsWrite ? [fallbackFilename] : [],
            },
          },
        };
  addition.grantOrigin = "live";

  try {
    const current = getGrant(verifiedWidgetId);
    const merged = _mergeFsGrant(current, addition);
    setGrant(verifiedWidgetId, merged);
  } catch (e) {
    return {
      allow: false,
      reason:
        "JIT consent: failed to persist fs grant: " +
        (e && e.message ? e.message : String(e)),
    };
  }

  return gateFsCall(req);
}

module.exports = {
  gateFsCall,
  gateFsCallWithJit,
  isFsWriteAction,
  WRITE_ACTIONS,
};
