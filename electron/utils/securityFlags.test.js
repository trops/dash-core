/**
 * securityFlags.test.js
 *
 * Pins the default-on semantics for the two MCP security flags. The
 * stack defaults to ON (gate enforced + JIT consent prompts active);
 * only an explicit `false` in settings opts out. If these tests fail,
 * either the default flipped silently or the boolean parsing changed
 * — both are user-visible regressions.
 *
 * Run: `node --test electron/utils/securityFlags.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { readEnforceFlag, readJitFlag } = require("./securityFlags");

test("readEnforceFlag: missing settings → true (default-on)", () => {
  assert.strictEqual(readEnforceFlag(null), true);
  assert.strictEqual(readEnforceFlag(undefined), true);
});

test("readEnforceFlag: empty settings → true", () => {
  assert.strictEqual(readEnforceFlag({}), true);
});

test("readEnforceFlag: missing security block → true", () => {
  assert.strictEqual(readEnforceFlag({ debugMode: true }), true);
});

test("readEnforceFlag: empty security block → true", () => {
  assert.strictEqual(readEnforceFlag({ security: {} }), true);
});

test("readEnforceFlag: explicit true → true", () => {
  assert.strictEqual(
    readEnforceFlag({ security: { enforceWidgetMcpPermissions: true } }),
    true,
  );
});

test("readEnforceFlag: explicit false → false", () => {
  assert.strictEqual(
    readEnforceFlag({ security: { enforceWidgetMcpPermissions: false } }),
    false,
  );
});

test("readEnforceFlag: truthy non-false (e.g. 0, '', null) → still true", () => {
  // Anything except literal `false` keeps the default-on stance.
  assert.strictEqual(
    readEnforceFlag({ security: { enforceWidgetMcpPermissions: null } }),
    true,
  );
  assert.strictEqual(
    readEnforceFlag({ security: { enforceWidgetMcpPermissions: 0 } }),
    true,
  );
});

test("readJitFlag: missing settings → true (default-on)", () => {
  assert.strictEqual(readJitFlag(null), true);
  assert.strictEqual(readJitFlag(undefined), true);
});

test("readJitFlag: empty settings → true", () => {
  assert.strictEqual(readJitFlag({}), true);
});

test("readJitFlag: explicit false → false", () => {
  assert.strictEqual(
    readJitFlag({ security: { enableJitConsent: false } }),
    false,
  );
});

test("readJitFlag: explicit true → true", () => {
  assert.strictEqual(
    readJitFlag({ security: { enableJitConsent: true } }),
    true,
  );
});
