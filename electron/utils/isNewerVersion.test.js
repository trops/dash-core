/**
 * isNewerVersion.test.js
 *
 * Pins the widget update check's version compare: only a higher registry
 * version counts as an update (never offer a downgrade).
 *
 * Run with `node --test electron/utils/isNewerVersion.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { isNewerVersion } = require("./isNewerVersion");

test("a higher registry version is an update", () => {
  assert.strictEqual(isNewerVersion("0.0.911", "0.0.910"), true);
  assert.strictEqual(isNewerVersion("1.0.0", "0.9.99"), true);
  assert.strictEqual(isNewerVersion("0.0.10", "0.0.9"), true);
});

test("a lower or equal registry version is not (no downgrade offers)", () => {
  assert.strictEqual(isNewerVersion("0.0.875", "0.0.910"), false);
  assert.strictEqual(isNewerVersion("0.0.910", "0.0.910"), false);
  assert.strictEqual(isNewerVersion("0.0.9", "0.0.10"), false);
});

test("pre-releases sort before their release", () => {
  assert.strictEqual(isNewerVersion("1.0.0", "1.0.0-beta"), true);
  assert.strictEqual(isNewerVersion("1.0.0-beta", "1.0.0"), false);
});

test("handles missing or odd versions", () => {
  assert.strictEqual(isNewerVersion(undefined, "1.0.0"), false);
  assert.strictEqual(isNewerVersion("1.0.0", undefined), true);
  assert.strictEqual(isNewerVersion("v1.2.0", "1.1.0"), true);
  assert.strictEqual(isNewerVersion("nightly", "1.0.0"), true);
});
