/**
 * jitConsent.js
 *
 * Just-in-time permission consent for widget→backend calls.
 *
 * When a widget hits a gate without an existing grant for the requested
 * (domain, action, args), the gate calls `requestApproval` which:
 *   1. Synchronously emits `widget:permission-required` to all
 *      BrowserWindows with a unique requestId.
 *   2. Returns a Promise that resolves on user response or rejects on
 *      timeout.
 *   3. Coalesces requests with the same coalescing key so a widget
 *      bursting identical calls produces one prompt, not many.
 *
 * The renderer's JitConsentModal subscribes to the event, presents the
 * user with granularity options (this once / this tool / this tool +
 * parent dir), and replies via `widget:permission-response` with
 * `{ requestId, decision }`. main.js wires the IPC handler back to
 * `_handleResponse`.
 *
 * The module is intentionally domain-agnostic in shape — the request
 * payload carries `domain` so future plug-ins (fs, algolia, llm) reuse
 * the same machinery. Phase 1 only emits with `domain: "mcp"`.
 *
 * Public surface:
 *   requestApproval(req, opts) → Promise<{ approve, scope?, ... }>
 *   _handleResponse({ requestId, decision }) → void   (called from main.js IPC)
 *   _resetForTest() → void                            (test-only)
 */
"use strict";

const { BrowserWindow, ipcMain } = require("electron");

const REQUEST_CHANNEL = "widget:permission-required";
const RESPONSE_CHANNEL = "widget:permission-response";
const DEFAULT_TIMEOUT_MS = 60_000;

// requestId → { resolve, reject, timeout, coalesceKey, joinedResolvers }
const _pending = new Map();
// coalesceKey → requestId (so duplicate requests join the live one)
const _coalesce = new Map();
let _idCounter = 0;

function nextRequestId() {
  _idCounter += 1;
  return `jit-${Date.now()}-${_idCounter}`;
}

/**
 * Build a coalescing key from the request. Two requests share the same
 * key iff they're "the same prompt" — same widget, same domain+action,
 * same target server/tool. Args beyond that (e.g. exact path) DON'T
 * differentiate; if the user is being asked about read_file already,
 * approving handles all current paths.
 */
function coalesceKeyOf(req) {
  if (req.domain === "mcp") {
    const innerArgs = req.args || {};
    return [
      req.widgetId,
      "mcp",
      innerArgs.serverName || "",
      innerArgs.toolName || "",
    ].join("::");
  }
  // Default: domain + action + serialized top-level args
  return [
    req.widgetId,
    req.domain,
    req.action,
    JSON.stringify(req.args || {}),
  ].join("::");
}

function emitEvent(payload) {
  let wins = [];
  try {
    wins = BrowserWindow.getAllWindows() || [];
  } catch {
    wins = [];
  }
  for (const w of wins) {
    try {
      w?.webContents?.send?.(REQUEST_CHANNEL, payload);
    } catch {
      // best-effort broadcast
    }
  }
}

function validateRequest(req) {
  if (!req || typeof req !== "object") return "invalid request: not an object";
  if (typeof req.widgetId !== "string" || !req.widgetId)
    return "invalid request: widgetId required";
  if (typeof req.domain !== "string" || !req.domain)
    return "invalid request: domain required";
  if (typeof req.action !== "string" || !req.action)
    return "invalid request: action required";
  return null;
}

/**
 * Request user approval for an out-of-grant call. Returns a promise
 * that resolves with the user's decision or rejects on timeout / bad
 * input.
 *
 * decision shape (resolved value):
 *   { approve: true, scope: "once" | "tool" | "parent" | "custom", ...extras }
 *   { approve: false, reason?: string }
 *
 * `scope` informs the caller how to write the resulting grant.
 */
function requestApproval(req, opts = {}) {
  const validation = validateRequest(req);
  if (validation) {
    return Promise.reject(new Error(validation));
  }

  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? opts.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  // If a prompt for the same coalesce key is already pending, join it.
  const key = coalesceKeyOf(req);
  if (_coalesce.has(key)) {
    const existingId = _coalesce.get(key);
    const existing = _pending.get(existingId);
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.joinedResolvers.push({ resolve, reject });
      });
    }
    // Stale coalesce entry; drop and fall through to a fresh request.
    _coalesce.delete(key);
  }

  return new Promise((resolve, reject) => {
    const requestId = nextRequestId();
    const timeout = setTimeout(() => {
      const entry = _pending.get(requestId);
      if (!entry) return;
      _pending.delete(requestId);
      _coalesce.delete(entry.coalesceKey);
      const err = new Error(
        `JIT consent timed out for ${req.widgetId} (${req.domain}/${req.action}) after ${timeoutMs}ms`,
      );
      reject(err);
      for (const j of entry.joinedResolvers) j.reject(err);
    }, timeoutMs);

    _pending.set(requestId, {
      resolve,
      reject,
      timeout,
      coalesceKey: key,
      joinedResolvers: [],
    });
    _coalesce.set(key, requestId);

    emitEvent({
      requestId,
      widgetId: req.widgetId,
      domain: req.domain,
      action: req.action,
      args: req.args || {},
      // Slice 5 (package-scope): the gate pre-resolves these via
      // resolveSiblings before calling here. Modal renders the
      // "Apply to all widgets from <package>" checkbox when
      // siblingWidgetIds.length > 1; absence means single-widget.
      packageId:
        typeof req.packageId === "string" && req.packageId
          ? req.packageId
          : null,
      siblingWidgetIds: Array.isArray(req.siblingWidgetIds)
        ? req.siblingWidgetIds
        : [req.widgetId],
    });
  });
}

function _handleResponse({ requestId, decision } = {}) {
  if (!requestId || typeof requestId !== "string") return;
  const entry = _pending.get(requestId);
  if (!entry) return; // unknown request — drop silently
  clearTimeout(entry.timeout);
  _pending.delete(requestId);
  _coalesce.delete(entry.coalesceKey);
  const safe =
    decision && typeof decision === "object" ? decision : { approve: false };
  entry.resolve(safe);
  for (const j of entry.joinedResolvers) j.resolve(safe);
}

function _resetForTest() {
  for (const entry of _pending.values()) clearTimeout(entry.timeout);
  _pending.clear();
  _coalesce.clear();
  _idCounter = 0;
}

let _handlersRegistered = false;
/**
 * Wire the renderer→main response IPC. Idempotent.
 * Call once from main.js alongside other ipcMain setup.
 */
function setupJitConsentHandlers() {
  if (_handlersRegistered) return;
  if (!ipcMain || typeof ipcMain.on !== "function") return;
  ipcMain.on(RESPONSE_CHANNEL, (_event, payload) => {
    _handleResponse(payload);
  });
  _handlersRegistered = true;
}

module.exports = {
  requestApproval,
  setupJitConsentHandlers,
  _handleResponse,
  _resetForTest,
  REQUEST_CHANNEL,
  RESPONSE_CHANNEL,
  DEFAULT_TIMEOUT_MS,
};
