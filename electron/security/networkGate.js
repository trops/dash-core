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
const { lookup: lookupMountToken } = require("./mountTokenRegistry");
const { resolveSiblings } = require("./resolveSiblings");

function _defaultRegistrySnapshot() {
  try {
    const reg = require("../widgetRegistry").getWidgetRegistry();
    return reg && reg.widgets ? reg.widgets : null;
  } catch (_) {
    return null;
  }
}

// See `mountTokenRegistry.js` and the matching block in fsGate.js —
// when a token is supplied, it's the trusted identity source; the
// renderer-claimed widgetId is ignored. Legacy widgetId-only callers
// still work in slice 1 (additive); slice 2 will flip to deny.
function _resolveIdentity({ token, widgetId }) {
  if (typeof token === "string" && token.length > 0) {
    const resolved = lookupMountToken(token);
    if (resolved) return { widgetId: resolved, source: "token" };
    return { widgetId: null, source: "token-unknown" };
  }
  return { widgetId: widgetId || null, source: "legacy" };
}

function _hostMatches(host, allowedList) {
  if (!Array.isArray(allowedList) || allowedList.length === 0) return false;
  if (allowedList.includes("*")) return true;
  const lower = host.toLowerCase();
  for (const entry of allowedList) {
    if (typeof entry !== "string") continue;
    const entryLower = entry.toLowerCase();
    // Exact match.
    if (entryLower === lower) return true;
    // Subdomain wildcard: "*.example.com" matches "example.com" and
    // any host ending in ".example.com". The leading dot on the
    // suffix-test is required — otherwise "*.example.com" would also
    // match "attackerexample.com", which is the kind of confusion
    // this feature is meant to avoid.
    if (entryLower.startsWith("*.")) {
      const base = entryLower.slice(2); // "example.com"
      if (lower === base) return true;
      if (lower.endsWith("." + base)) return true;
    }
  }
  return false;
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
function gateNetworkCall({ widgetId, token, action, args }) {
  const resolved = _resolveIdentity({ token, widgetId });
  if (resolved.source === "token-unknown") {
    return {
      allow: false,
      reason:
        "network gate: unknown mount token; widget identity not verifiable",
    };
  }
  widgetId = resolved.widgetId;
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

  // Slice 4: per-action allowlist. Same Option A migration as fsGate —
  // missing/empty `actions[]` falls through to the legacy "any action
  // against allowed hosts" semantics so pre-slice grants keep working.
  if (Array.isArray(netPerms.actions) && netPerms.actions.length > 0) {
    if (!netPerms.actions.includes(action)) {
      return {
        allow: false,
        reason:
          "network gate: action '" +
          action +
          "' not in actions allowlist for widget '" +
          widgetId +
          "'",
      };
    }
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
    const merged = {
      hosts: [
        ...new Set([
          ...(existingNet.hosts || []),
          ...(Array.isArray(additionNet.hosts) ? additionNet.hosts : []),
        ]),
      ],
    };
    // Slice 4: union `actions[]`. Only emit when at least one side
    // declared it — preserves Option A migration.
    const existingActions = Array.isArray(existingNet.actions)
      ? existingNet.actions
      : null;
    const additionActions = Array.isArray(additionNet.actions)
      ? additionNet.actions
      : null;
    if (existingActions || additionActions) {
      merged.actions = [
        ...new Set([...(existingActions || []), ...(additionActions || [])]),
      ];
    }
    out.domains.network = merged;
  }
  return out;
}

/**
 * Async gate that escalates "missing in grant" network denials to a
 * JIT consent prompt when `opts.enableJit` is true. Escalation signal
 * is STRUCTURAL: if the requested action+host isn't covered by the
 * widget's grant (action absent from `actions[]`, or host absent from
 * `hosts[]`), JIT fires. Identity-resolution failures and malformed-
 * args / malformed-URL denials short-circuit to the sync verdict — not
 * recoverable via consent. Once the request IS covered, the sync gate
 * is authoritative.
 */
async function gateNetworkCallWithJit(req, opts = {}) {
  if (!opts.enableJit) return gateNetworkCall(req);

  // Identity must resolve. Unknown tokens / missing widgetId aren't
  // consent gaps.
  const resolved = _resolveIdentity({
    token: req.token,
    widgetId: req.widgetId,
  });
  if (resolved.source === "token-unknown" || !resolved.widgetId) {
    return gateNetworkCall(req);
  }
  const verifiedWidgetId = resolved.widgetId;

  // Args must be well-formed enough to derive a host — malformed
  // calls aren't consent gaps.
  const url = req.args && typeof req.args === "object" ? req.args.url : null;
  if (typeof url !== "string" || !url) {
    return gateNetworkCall(req);
  }
  const host = _parseHost(url);
  if (!host) {
    return gateNetworkCall(req);
  }

  // Structural escalation: when the existing grant covers this
  // (action, host) pair, the sync gate's verdict is authoritative.
  const grant = getGrant(verifiedWidgetId);
  const netPerms = grant && grant.domains && grant.domains.network;
  if (netPerms) {
    const actionsAllow =
      !Array.isArray(netPerms.actions) ||
      netPerms.actions.length === 0 ||
      netPerms.actions.includes(req.action);
    const hostsAllow = _hostMatches(host, netPerms.hosts || []);
    if (actionsAllow && hostsAllow) {
      return gateNetworkCall(req);
    }
  }

  // Slice 5: resolve siblings for the package-scope checkbox.
  const getRegistrySnapshot =
    opts.getRegistrySnapshot || _defaultRegistrySnapshot;
  const siblingInfo = resolveSiblings(verifiedWidgetId, getRegistrySnapshot());

  let decision;
  try {
    decision = await requestApproval(
      {
        widgetId: verifiedWidgetId,
        domain: "network",
        action: req.action,
        args: req.args || {},
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
        "' calling network '" +
        req.action +
        "'",
    };
  }

  const addition =
    decision.granted && typeof decision.granted === "object"
      ? decision.granted
      : {
          grantOrigin: "live",
          domains: {
            network: { actions: [req.action], hosts: [host] },
          },
        };
  addition.grantOrigin = "live";

  // Slice 5: batch-write to all siblings when applyToSiblings === true.
  const targetWidgetIds =
    decision.applyToSiblings === true &&
    Array.isArray(siblingInfo.siblingWidgetIds) &&
    siblingInfo.siblingWidgetIds.length > 1
      ? siblingInfo.siblingWidgetIds
      : [verifiedWidgetId];

  try {
    for (const targetId of targetWidgetIds) {
      const current = getGrant(targetId);
      const merged = _mergeNetworkGrant(current, addition);
      setGrant(targetId, merged);
    }
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
