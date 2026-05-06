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

// Stub jitConsent.requestApproval BEFORE fsGate is required so the
// JIT-flow tests can drive the renderer-decision side without touching
// real IPC. Tests assign a function to `__mockApproval` per-case.
let __mockApproval = (_req, _opts) => {
  throw new Error("__mockApproval was called but the test didn't set one");
};
const jitConsentPath = require.resolve("../mcp/jitConsent");
require.cache[jitConsentPath] = {
  id: jitConsentPath,
  filename: jitConsentPath,
  loaded: true,
  exports: {
    requestApproval: (req, opts) => __mockApproval(req, opts),
  },
};

const { gateFsCall, gateFsCallWithJit, isFsWriteAction } = require("./fsGate");
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

// ---- per-action grant scoping (slice 4) ------------------------------
//
// Slice 4 introduces an `actions[]` allowlist alongside readPaths/
// writePaths. With it present, only listed actions are allowed (path
// scope still applies). When absent, every action in the appropriate
// read/write class is allowed — Option A migration so pre-slice grants
// keep working until the user re-consents.

test("gateFsCall: action allowlist enforced when actions[] is present", () => {
  reset();
  setGrant("@trops/widget-actions", {
    grantOrigin: "live",
    domains: {
      fs: {
        actions: ["saveToFile"],
        readPaths: [],
        writePaths: ["y"],
      },
    },
  });
  // Action in allowlist → allowed (path also matches)
  let r = gateFsCall({
    widgetId: "@trops/widget-actions",
    action: "saveToFile",
    args: { filename: "y" },
  });
  assert.strictEqual(r.allow, true);
  // Different write action with same path → denied (NEW per slice 4)
  r = gateFsCall({
    widgetId: "@trops/widget-actions",
    action: "transformFile",
    args: { filename: "y" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /actions allowlist/i);
});

test("gateFsCall: legacy grant without actions[] allows any action (Option A migration)", () => {
  // Pre-slice-4 grant — no `actions` field. Gate must continue to
  // allow any read/write action against the existing path scope.
  reset();
  setGrant("@trops/widget-legacy", {
    grantOrigin: "manual",
    domains: { fs: { readPaths: [], writePaths: ["y"] } },
  });
  let r = gateFsCall({
    widgetId: "@trops/widget-legacy",
    action: "saveToFile",
    args: { filename: "y" },
  });
  assert.strictEqual(r.allow, true);
  r = gateFsCall({
    widgetId: "@trops/widget-legacy",
    action: "transformFile",
    args: { filename: "y" },
  });
  assert.strictEqual(r.allow, true);
});

// ---- gateFsCallWithJit — structural escalation -----------------------

test("gateFsCallWithJit: JIT off → returns sync gate verdict", async () => {
  reset();
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return { approve: true };
  };
  const r = await gateFsCallWithJit(
    {
      widgetId: "@trops/no-grant-yet",
      action: "saveToFile",
      args: { filename: "x" },
    },
    { enableJit: false },
  );
  assert.strictEqual(approvalCalled, false);
  assert.strictEqual(r.allow, false);
});

test("gateFsCallWithJit: escalates when widget has no fs grant", async () => {
  reset();
  let approvalCalled = false;
  __mockApproval = async (req) => {
    approvalCalled = true;
    assert.strictEqual(req.widgetId, "@trops/no-grant-fs");
    assert.strictEqual(req.domain, "fs");
    return {
      approve: true,
      granted: {
        grantOrigin: "live",
        domains: {
          fs: {
            actions: ["saveToFile"],
            readPaths: [],
            writePaths: ["x"],
          },
        },
      },
    };
  };
  const r = await gateFsCallWithJit(
    {
      widgetId: "@trops/no-grant-fs",
      action: "saveToFile",
      args: { filename: "x" },
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, true);
  assert.strictEqual(r.allow, true);
});

test("gateFsCallWithJit: escalates when filename not in writePaths (was silently denied)", async () => {
  reset();
  setGrant("@trops/partial-fs", {
    grantOrigin: "live",
    domains: {
      fs: { actions: ["saveToFile"], readPaths: [], writePaths: ["a"] },
    },
  });
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return {
      approve: true,
      granted: {
        grantOrigin: "live",
        domains: {
          fs: { actions: ["saveToFile"], readPaths: [], writePaths: ["b"] },
        },
      },
    };
  };
  const r = await gateFsCallWithJit(
    {
      widgetId: "@trops/partial-fs",
      action: "saveToFile",
      args: { filename: "b" },
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, true);
  assert.strictEqual(r.allow, true);
});

test("gateFsCallWithJit: escalates when action not in actions[] (was silently denied)", async () => {
  reset();
  setGrant("@trops/partial-actions", {
    grantOrigin: "live",
    domains: {
      fs: { actions: ["saveToFile"], readPaths: [], writePaths: ["x"] },
    },
  });
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return {
      approve: true,
      granted: {
        grantOrigin: "live",
        domains: {
          fs: {
            actions: ["transformFile"],
            readPaths: [],
            writePaths: ["x"],
          },
        },
      },
    };
  };
  const r = await gateFsCallWithJit(
    {
      widgetId: "@trops/partial-actions",
      action: "transformFile",
      args: { filename: "x" },
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, true);
  assert.strictEqual(r.allow, true);
});

test("gateFsCallWithJit: does NOT escalate for unknown mount token", async () => {
  reset();
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return { approve: true };
  };
  const r = await gateFsCallWithJit(
    {
      token: "bogus-token",
      action: "saveToFile",
      args: { filename: "x" },
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, false);
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /unknown mount token/i);
});

test("gateFsCallWithJit: does NOT escalate for missing widgetId", async () => {
  reset();
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return { approve: true };
  };
  const r = await gateFsCallWithJit(
    { action: "saveToFile", args: { filename: "x" } },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, false);
  assert.strictEqual(r.allow, false);
});

test("gateFsCallWithJit: does NOT escalate for missing args.filename", async () => {
  reset();
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return { approve: true };
  };
  const r = await gateFsCallWithJit(
    {
      widgetId: "@trops/widget-no-fname",
      action: "saveToFile",
      args: {},
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, false);
  assert.strictEqual(r.allow, false);
});

test("gateFsCallWithJit: legacy grant (no actions[]) does NOT escalate when filename matches", async () => {
  // Pre-slice-4 grant + a covered call → sync gate allows; JIT must
  // not fire (would re-prompt the user for a permission they already
  // have under legacy semantics).
  reset();
  setGrant("@trops/widget-legacy-jit", {
    grantOrigin: "manual",
    domains: { fs: { readPaths: [], writePaths: ["x"] } },
  });
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return { approve: true };
  };
  const r = await gateFsCallWithJit(
    {
      widgetId: "@trops/widget-legacy-jit",
      action: "saveToFile",
      args: { filename: "x" },
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, false);
  assert.strictEqual(r.allow, true);
});
