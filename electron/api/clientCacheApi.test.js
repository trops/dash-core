/**
 * clientCacheApi.test.js
 *
 * Regression-pin: the entire `clientCacheApi` module was deleted
 * because all four of its methods (invalidate, invalidateAll,
 * clearResponseCache, responseCacheStats) had no main-process
 * handlers in dash-electron. dash-electron's own preload exposes
 * `mainApi.clientCache` and `mainApi.responseCache` directly using
 * inline-string `ipcRenderer.invoke` channels — that namespace
 * wholly overrode the dash-core one at runtime, so the dash-core
 * exports were masked-and-broken.
 *
 * If a future commit re-creates this file, it MUST plumb a
 * `widgetId` param + per-widget gate (cache invalidation by widget,
 * not global) and declare the wired handlers in dash-electron.
 *
 * (Note: dash-electron's own clientCache/responseCache namespaces
 * are also unwired today and should be cleaned up in a follow-up
 * slice, but that's a dash-electron-only fix and is independent of
 * this dash-core-only removal.)
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

test("clientCacheApi.js does not exist (file was deleted)", () => {
  const file = path.join(__dirname, "clientCacheApi.js");
  assert.strictEqual(
    fs.existsSync(file),
    false,
    "clientCacheApi.js reappeared. See regression-pin docstring " +
      "for what's required before re-adding.",
  );
});

test("require('./clientCacheApi') throws", () => {
  assert.throws(() => {
    require("./clientCacheApi");
  }, /Cannot find module/);
});

test("api/index.js does not import clientCacheApi", () => {
  const src = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  assert.ok(
    !/clientCacheApi/.test(src),
    "api/index.js still references clientCacheApi (file was deleted).",
  );
});

test("mainApi defaults do not include a clientCache namespace from dash-core", () => {
  // We can't fully require mainApi here without an electron stub,
  // but we can read the source and assert the mount line is gone.
  const src = fs.readFileSync(path.join(__dirname, "mainApi.js"), "utf8");
  assert.ok(
    !/clientCache:\s*clientCacheApi/.test(src),
    "mainApi.js still mounts clientCache from a (deleted) " +
      "clientCacheApi module.",
  );
});
