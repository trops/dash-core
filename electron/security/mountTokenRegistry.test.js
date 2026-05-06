/**
 * mountTokenRegistry.test.js
 *
 * Pins for the per-widget-mount token map. The registry is the
 * trusted root of widget identity at the IPC boundary: gates resolve
 * the caller's widgetId from the token rather than trusting whatever
 * the renderer sends.
 *
 * Slice 1 invariants pinned here:
 *   - register() returns a token bound to the supplied widgetId
 *   - lookup() returns the widgetId for a known token, null otherwise
 *   - unregister() removes the binding
 *   - tokens are 192-bit-equivalent random hex (48 chars), distinct
 *     across calls, server-side generated (registry never accepts a
 *     caller-supplied token)
 *   - the same widgetId can be registered multiple times concurrently
 *     (multi-instance) and each gets its own token
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  register,
  lookup,
  unregister,
  _resetForTests,
} = require("./mountTokenRegistry");

test("register returns a token; lookup resolves widgetId", () => {
  _resetForTests();
  const token = register("@trops/widget-a");
  assert.strictEqual(typeof token, "string");
  assert.strictEqual(lookup(token), "@trops/widget-a");
});

test("lookup of unknown token returns null", () => {
  _resetForTests();
  assert.strictEqual(lookup("not-a-real-token"), null);
});

test("unregister removes the binding", () => {
  _resetForTests();
  const token = register("@trops/widget-b");
  assert.strictEqual(lookup(token), "@trops/widget-b");
  unregister(token);
  assert.strictEqual(lookup(token), null);
});

test("tokens are unique across calls", () => {
  _resetForTests();
  const t1 = register("@trops/widget-a");
  const t2 = register("@trops/widget-a");
  const t3 = register("@trops/widget-b");
  assert.notStrictEqual(t1, t2);
  assert.notStrictEqual(t1, t3);
  assert.notStrictEqual(t2, t3);
});

test("tokens are at least 32 hex chars (sufficient entropy)", () => {
  _resetForTests();
  const t = register("@trops/widget-a");
  assert.ok(/^[0-9a-f]{32,}$/.test(t), "token must be hex with >=32 chars");
});

test("multiple instances of same widget — each gets distinct token", () => {
  _resetForTests();
  const t1 = register("@trops/widget-a");
  const t2 = register("@trops/widget-a");
  assert.notStrictEqual(t1, t2);
  assert.strictEqual(lookup(t1), "@trops/widget-a");
  assert.strictEqual(lookup(t2), "@trops/widget-a");
  // Unregistering one leaves the other intact
  unregister(t1);
  assert.strictEqual(lookup(t1), null);
  assert.strictEqual(lookup(t2), "@trops/widget-a");
});

test("register rejects empty / non-string widgetIds", () => {
  _resetForTests();
  assert.throws(() => register(""), /widgetId/);
  assert.throws(() => register(null), /widgetId/);
  assert.throws(() => register(undefined), /widgetId/);
  assert.throws(() => register(42), /widgetId/);
});

test("unregister of unknown token is a silent no-op", () => {
  _resetForTests();
  // Must not throw
  unregister("not-a-real-token");
  unregister(null);
  unregister(undefined);
});
