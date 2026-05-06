/**
 * pluginApi.test.js
 *
 * Regression-pin: the entire `plugins` namespace was deleted because
 * `mainApi.plugins.install` and `mainApi.plugins.uninstall` had zero
 * callers across either repo and `pluginController.install` was a
 * no-op stub (open-coded `path.join` whose result was discarded;
 * `uninstall` had no handler at all).
 *
 * If a future commit re-creates this surface, it MUST plumb a
 * `widgetId` parameter + per-widget gate (cross-widget plugin install
 * is exactly the kind of capability that needs JIT consent — same
 * pattern as fsGate / networkGate).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

test("pluginApi.js does not exist (file was deleted)", () => {
  const file = path.join(__dirname, "pluginApi.js");
  assert.strictEqual(
    fs.existsSync(file),
    false,
    "pluginApi.js reappeared. See regression-pin docstring for the " +
      "required widgetId + gate plumbing before re-adding.",
  );
});

test("require('./pluginApi') throws", () => {
  assert.throws(() => {
    require("./pluginApi");
  }, /Cannot find module/);
});

test("mainApi.js does not mount a plugins namespace", () => {
  const src = fs.readFileSync(path.join(__dirname, "mainApi.js"), "utf8");
  assert.ok(
    !/plugins:\s*pluginApi/.test(src),
    "mainApi.js still mounts a plugins namespace from a (deleted) pluginApi module.",
  );
  assert.ok(
    !/require\(["']\.\/pluginApi["']\)/.test(src),
    "mainApi.js still requires pluginApi.",
  );
});

test("electron/index.js does not import pluginController", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(
    !/require\(["']\.\/controller\/pluginController["']\)/.test(src),
    "electron/index.js still requires pluginController.",
  );
  assert.ok(
    !/\bpluginController\b/.test(src),
    "electron/index.js still references pluginController in exports.",
  );
});

test("controller/index.js does not import pluginController", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "controller", "index.js"),
    "utf8",
  );
  assert.ok(
    !/require\(["']\.\/pluginController["']\)/.test(src),
    "controller/index.js still requires pluginController.",
  );
  assert.ok(
    !/\bpluginInstall\b/.test(src),
    "controller/index.js still re-exports pluginInstall.",
  );
});

test("controller/pluginController.js does not exist", () => {
  const file = path.join(__dirname, "..", "controller", "pluginController.js");
  assert.strictEqual(
    fs.existsSync(file),
    false,
    "pluginController.js reappeared. The previous body was a no-op " +
      "stub — re-adding requires a real implementation, a widgetId " +
      "parameter, and a per-widget gate.",
  );
});
