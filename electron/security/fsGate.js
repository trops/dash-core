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

function _isNoGrantDenial(reason) {
  return (
    typeof reason === "string" && /no fs permissions granted/i.test(reason)
  );
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
    out.domains.fs = {
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
  }
  return out;
}

/**
 * Async gate that escalates "no fs grant" denials to a JIT consent
 * prompt when `opts.enableJit` is true. On approval, merges the
 * decision's grant blob into the persisted grant and re-evaluates.
 */
async function gateFsCallWithJit(req, opts = {}) {
  const initial = gateFsCall(req);
  if (initial.allow) return initial;
  if (!opts.enableJit) return initial;
  if (!_isNoGrantDenial(initial.reason)) return initial;

  // Resolve verified identity once (token wins over claimed widgetId).
  // Re-using the same resolution as gateFsCall keeps the JIT prompt
  // and grant write tied to the same identity the gate just denied.
  const resolved = _resolveIdentity({
    token: req.token,
    widgetId: req.widgetId,
  });
  const verifiedWidgetId = resolved.widgetId;
  if (!verifiedWidgetId) return initial;

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
      reason:
        "JIT consent " +
        (e && e.message ? e.message : "failed") +
        "; original denial: " +
        initial.reason,
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

  const filename = req.args?.filename || "*";
  const isWrite = isFsWriteAction(req.action);
  const addition =
    decision.granted && typeof decision.granted === "object"
      ? decision.granted
      : {
          grantOrigin: "live",
          domains: {
            fs: {
              readPaths: !isWrite ? [filename] : [],
              writePaths: isWrite ? [filename] : [],
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
