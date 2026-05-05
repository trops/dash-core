/**
 * networkGate.js
 *
 * Per-widget gate for outbound-network IPC actions (Phase 3 of JIT
 * consent). Same shape as `fsGate.js` but for hostname-based scoping.
 *
 * Channels currently gated by this:
 *   - readDataFromURL (dataController)  — fetch a URL into a file
 *   - wsConnect       (webSocketController) — open a WebSocket
 *
 * Channels NOT gated:
 *   - WS_SEND/DISCONNECT/STATUS/GET_ALL — operate on already-authorized
 *     connections, intentionally shared across widgets via the
 *     `consumers: Set<webContentsId>` design.
 *   - THEME_EXTRACT_FROM_URL — admin-only callers (Settings panels);
 *     no widget caller exists in the codebase.
 *
 * Grant shape (under `grant.domains.network`):
 *   {
 *     hosts: ["api.example.com", "*", ...]
 *   }
 *
 * Hostname matching:
 *   - Exact match (case-insensitive)
 *   - "*" wildcard in the grant matches any host (escape hatch;
 *     surfaced in the JIT modal as "no host scope — risky")
 *   - Subdomain wildcards ("*.example.com") are NOT supported in this
 *     slice — deferred to a follow-up.
 *
 * URL parsing uses the WHATWG URL constructor. Malformed URLs deny
 * synchronously and do NOT escalate to JIT (a JIT prompt would let a
 * widget probe URL parser quirks, which we'd rather not).
 *
 * JIT escalation: when the runtime calls `gateNetworkCallWithJit` and
 * the gate denies for "no network permissions granted", a
 * permission-required IPC fires and the user's response is merged
 * into the persisted grant. Other denial reasons (host not in
 * allowlist, malformed url, missing url) stay synchronous.
 */
"use strict";

const { getGrant, setGrant } = require("../mcp/grantedPermissions");
const { requestApproval } = require("../mcp/jitConsent");

function _isNoGrantDenial(reason) {
  return (
    typeof reason === "string" && /no network permissions granted/i.test(reason)
  );
}

function _hostMatches(host, allowedList) {
  if (!Array.isArray(allowedList) || allowedList.length === 0) return false;
  if (allowedList.includes("*")) return true;
  const lower = host.toLowerCase();
  return allowedList.some(
    (h) => typeof h === "string" && h.toLowerCase() === lower,
  );
}

function _parseHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Synchronous gate evaluation.
 * @returns {{ allow: true } | { allow: false, reason: string }}
 */
function gateNetworkCall({ widgetId, action, args }) {
  if (!widgetId) {
    return {
      allow: false,
      reason: "no widgetId supplied; cannot determine network permissions",
    };
  }

  const url = args && typeof args === "object" ? args.url : null;
  if (typeof url !== "string" || !url) {
    return {
      allow: false,
      reason:
        "network gate: action '" +
        action +
        "' requires args.url (got: " +
        JSON.stringify(url) +
        ")",
    };
  }

  const host = _parseHost(url);
  if (!host) {
    return {
      allow: false,
      reason: "network gate: malformed url '" + url + "'",
    };
  }

  const grant = getGrant(widgetId);
  const netPerms = grant && grant.domains && grant.domains.network;
  if (!netPerms) {
    return {
      allow: false,
      reason:
        "widget '" +
        widgetId +
        "' has no network permissions granted; user must approve at runtime or in Settings → Privacy & Security",
    };
  }

  if (_hostMatches(host, netPerms.hosts)) {
    return { allow: true };
  }
  return {
    allow: false,
    reason:
      "network gate: host '" +
      host +
      "' rejected — not in allowed hosts for widget '" +
      widgetId +
      "'",
  };
}

/**
 * Merge an approved JIT decision's grant into the widget's existing
 * grant under domains.network. Mirrors fsGate._mergeFsGrant.
 */
function _mergeNetworkGrant(current, addition) {
  const out = {
    grantOrigin: addition.grantOrigin || current?.grantOrigin || null,
    servers: { ...(current?.servers || {}) },
    domains: { ...(current?.domains || {}) },
  };
  const additionNet = addition?.domains?.network;
  if (additionNet) {
    const existingNet = out.domains.network || { hosts: [] };
    out.domains.network = {
      hosts: [
        ...new Set([
          ...(existingNet.hosts || []),
          ...(Array.isArray(additionNet.hosts) ? additionNet.hosts : []),
        ]),
      ],
    };
  }
  return out;
}

/**
 * Async gate that escalates "no network grant" denials to a JIT
 * consent prompt when `opts.enableJit` is true. On approval, merges
 * the decision's grant blob into the persisted grant and re-evaluates.
 */
async function gateNetworkCallWithJit(req, opts = {}) {
  const initial = gateNetworkCall(req);
  if (initial.allow) return initial;
  if (!opts.enableJit) return initial;
  if (!_isNoGrantDenial(initial.reason)) return initial;

  let decision;
  try {
    decision = await requestApproval(
      {
        widgetId: req.widgetId,
        domain: "network",
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
        req.widgetId +
        "' calling network '" +
        req.action +
        "'",
    };
  }

  const host = _parseHost(req.args?.url) || "*";
  const addition =
    decision.granted && typeof decision.granted === "object"
      ? decision.granted
      : {
          grantOrigin: "live",
          domains: { network: { hosts: [host] } },
        };
  addition.grantOrigin = "live";

  try {
    const current = getGrant(req.widgetId);
    const merged = _mergeNetworkGrant(current, addition);
    setGrant(req.widgetId, merged);
  } catch (e) {
    return {
      allow: false,
      reason:
        "JIT consent: failed to persist network grant: " +
        (e && e.message ? e.message : String(e)),
    };
  }

  return gateNetworkCall(req);
}

module.exports = {
  gateNetworkCall,
  gateNetworkCallWithJit,
};
