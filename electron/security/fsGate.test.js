/**
 * fsGate.test.js
 *
 * Pins the per-widget filesystem gate. Phase 2 of the JIT consent
 * machinery — same shape as permissionGate but for `mainApi.data.*`
 * IPC handlers (saveToFile, readFromFile) instead of MCP tool calls.
 *
 * The gate evaluates against `grant.domains.fs.{readPaths,writePaths}`.
 * Read/write classification is by action name (saveToFile → write,
 * readFromFile → read).
 *
 * Run: `node --test electron/security/fsGate.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Stub electron BEFORE require — fsGate's containment check uses
// safePath which calls app.getPath("userData") through electron.
const Module = require("node:module");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fs-gate-test-"));
const fakeElectron = {
  app: {
    getPath: (key) => {
      if (key === "userData") return path.join(tmpRoot, "userData");
      throw new Error("unknown path key: " + key);
    },
  },
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_fsgate__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_fsgate__"] = {
  id: "__stub_electron_fsgate__",
  filename: "__stub_electron_fsgate__",
  loaded: true,
  exports: fakeElectron,
};
fs.mkdirSync(path.join(tmpRoot, "userData"), { recursive: true });

const { gateFsCall, isFsWriteAction } = require("./fsGate");
const { setGrant, clearCache } = require("../mcp/grantedPermissions");

function reset() {
  clearCache();
  const grantsFile = path.join(tmpRoot, "userData", "widgetMcpGrants.json");
  if (fs.existsSync(grantsFile)) fs.unlinkSync(grantsFile);
}

test("isFsWriteAction: classifies known actions correctly", () => {
  assert.strictEqual(isFsWriteAction("saveToFile"), true);
  assert.strictEqual(isFsWriteAction("readFromFile"), false);
  assert.strictEqual(isFsWriteAction("readJSONFromFile"), false);
});

test("gateFsCall: missing widgetId rejected", () => {
  reset();
  const r = gateFsCall({
    widgetId: "",
    action: "readFromFile",
    args: { filename: "x.json" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /widgetId/i);
});

test("gateFsCall: no fs grant → deny with 'no fs permissions granted'", () => {
  reset();
  const r = gateFsCall({
    widgetId: "@trops/no-grant",
    action: "saveToFile",
    args: { filename: "x.json" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /no fs permissions granted/i);
});

test("gateFsCall: write action requires writePaths grant entry", () => {
  reset();
  // Read-only grant
  setGrant("@trops/widget-r", {
    grantOrigin: "manual",
    domains: {
      fs: {
        readPaths: ["x.json"],
        writePaths: [],
      },
    },
  });
  const r = gateFsCall({
    widgetId: "@trops/widget-r",
    action: "saveToFile",
    args: { filename: "x.json" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /no writePaths/i);
});

test("gateFsCall: read action allowed when filename matches readPaths", () => {
  reset();
  setGrant("@trops/widget-r", {
    grantOrigin: "manual",
    domains: {
      fs: {
        readPaths: ["my-data.json"],
        writePaths: [],
      },
    },
  });
  const r = gateFsCall({
    widgetId: "@trops/widget-r",
    action: "readFromFile",
    args: { filename: "my-data.json" },
  });
  assert.strictEqual(r.allow, true);
});

test("gateFsCall: write action allowed when filename matches writePaths", () => {
  reset();
  setGrant("@trops/widget-w", {
    grantOrigin: "manual",
    domains: {
      fs: {
        readPaths: [],
        writePaths: ["out.json"],
      },
    },
  });
  const r = gateFsCall({
    widgetId: "@trops/widget-w",
    action: "saveToFile",
    args: { filename: "out.json" },
  });
  assert.strictEqual(r.allow, true);
});

test("gateFsCall: filename not in grant → deny", () => {
  reset();
  setGrant("@trops/widget-x", {
    grantOrigin: "manual",
    domains: { fs: { readPaths: ["allowed.json"], writePaths: [] } },
  });
  const r = gateFsCall({
    widgetId: "@trops/widget-x",
    action: "readFromFile",
    args: { filename: "different.json" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /filename.*rejected|not in.*allowed/i);
});

test("gateFsCall: filename '*' wildcard allows any file", () => {
  reset();
  setGrant("@trops/widget-y", {
    grantOrigin: "manual",
    domains: { fs: { readPaths: ["*"], writePaths: [] } },
  });
  const r = gateFsCall({
    widgetId: "@trops/widget-y",
    action: "readFromFile",
    args: { filename: "anything.json" },
  });
  assert.strictEqual(r.allow, true);
});

test("gateFsCall: missing args.filename rejected", () => {
  reset();
  setGrant("@trops/widget-z", {
    grantOrigin: "manual",
    domains: { fs: { readPaths: ["*"], writePaths: [] } },
  });
  const r = gateFsCall({
    widgetId: "@trops/widget-z",
    action: "readFromFile",
    args: {},
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /filename/i);
});

test("gateFsCall: write tool can use either readPaths or writePaths? (no — strict write)", () => {
  // Write tools must use writePaths only — no fall-through to readPaths.
  // Read tools may read from writePaths (write access implies read).
  reset();
  setGrant("@trops/widget-strict", {
    grantOrigin: "manual",
    domains: { fs: { readPaths: ["x"], writePaths: ["y"] } },
  });
  // readFromFile reading from "y" is allowed (write implies read)
  let r = gateFsCall({
    widgetId: "@trops/widget-strict",
    action: "readFromFile",
    args: { filename: "y" },
  });
  assert.strictEqual(r.allow, true);
  // saveToFile writing to "x" (read-only path) is denied
  r = gateFsCall({
    widgetId: "@trops/widget-strict",
    action: "saveToFile",
    args: { filename: "x" },
  });
  assert.strictEqual(r.allow, false);
});
