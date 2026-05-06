/**
 * mountTokenRegistry.js
 *
 * Trusted root of widget identity at the IPC boundary. Each time
 * `WidgetFactory` mounts a widget it calls
 * `framework:register-widget-mount`, which calls `register(widgetId)`
 * here. The returned token is baked into the widget's bound API
 * (`makeBoundApi`) and sent on every gated IPC call. Gates resolve the
 * widgetId via `lookup(token)` instead of trusting whatever the
 * renderer claims.
 *
 * Why server-generated tokens: the renderer-supplied widgetId path was
 * the original consent-bypass surface. Tokens are produced by
 * `crypto.randomBytes(24)` here (192 bits) and are NEVER accepted from
 * the renderer — the renderer can only present tokens it received from
 * a prior `register` call. A widget cannot fabricate a token for
 * another widgetId.
 *
 * Limit: in single-renderer (one BrowserWindow shared across all
 * widgets), a malicious widget can still walk the React fiber tree to
 * find another widget's bound API and call its functions — the bound
 * function fires IPC with the *victim's* token. Fully closing that
 * residual requires per-widget BrowserView (multi-week refactor). The
 * token model raises the bar from "type a widgetId string" to "walk
 * the fiber tree and call another widget's bound function," which is
 * a deliberate malicious step that's visible at install-time review.
 */
"use strict";

const crypto = require("crypto");

const _byToken = new Map(); // token → widgetId

function _generateToken() {
  // 24 random bytes = 48 hex chars = 192 bits of entropy. More than
  // enough; collision probability is negligible.
  return crypto.randomBytes(24).toString("hex");
}

/**
 * Register a widgetId mount and return a fresh token bound to it.
 * @param {string} widgetId
 * @returns {string} token
 */
function register(widgetId) {
  if (typeof widgetId !== "string" || widgetId.length === 0) {
    throw new Error(
      "mountTokenRegistry.register: widgetId must be a non-empty string",
    );
  }
  let token = _generateToken();
  // Defensive — collision is astronomically unlikely but if it did
  // happen we'd silently overwrite a valid mapping. Regenerate.
  while (_byToken.has(token)) {
    token = _generateToken();
  }
  _byToken.set(token, widgetId);
  return token;
}

/**
 * Resolve a token to the widgetId it was bound to.
 * @param {string} token
 * @returns {string|null}
 */
function lookup(token) {
  if (typeof token !== "string") return null;
  return _byToken.has(token) ? _byToken.get(token) : null;
}

/**
 * Drop a token. Silent no-op for unknown tokens or non-strings —
 * unregister is called from unmount cleanup paths and should never
 * throw.
 * @param {string} token
 */
function unregister(token) {
  if (typeof token !== "string") return;
  _byToken.delete(token);
}

/** Test-only — clears the registry between cases. */
function _resetForTests() {
  _byToken.clear();
}

module.exports = { register, lookup, unregister, _resetForTests };
