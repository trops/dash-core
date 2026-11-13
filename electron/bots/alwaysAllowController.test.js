/**
 * alwaysAllowController.test.js — Always allow in the real botController: an
 * answer saves the grant (a provider tool, or a web fetch's site or page),
 * Undo takes back exactly that, and Ask again removes one row. Electron is
 * stubbed, like aiRunProfile.test.js; grants go to a temp folder.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-alwaysallow-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_alwaysallow__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_alwaysallow__"] = {
  id: "__stub_electron_alwaysallow__",
  filename: "__stub_electron_alwaysallow__",
  loaded: true,
  exports: {
    app: {
      getPath: () => stubDir,
      getAppPath: () => stubDir,
      isPackaged: false,
      getVersion: () => "0.0.0",
    },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: function () {},
    shell: {},
    dialog: {},
  },
};

const botController = require("../controller/botController");
const grantStore = require("../mcp/grantedPermissions");

function fake(pending) {
  const audit = [];
  const resolved = [];
  return {
    audit,
    resolved,
    _approvals: {
      get: (id) => (pending[id] ? { request: pending[id] } : null),
      resolve: (id, d) => {
        resolved.push([id, d]);
        return true;
      },
      deny: () => true,
    },
    _logAudit: (e) => audit.push(e),
    _rememberUndo: botController._rememberUndo,
    _undoAlwaysAllow: botController._undoAlwaysAllow,
    listAlwaysAllowed: botController.listAlwaysAllowed,
  };
}
const approve = (ctl, id, d) => botController.approve.call(ctl, id, d);
const rows = (botId) => botController.listAlwaysAllowed.call(null, botId);

describe("Always allow — saving, Undo, Ask again", () => {
  it("a web fetch: the whole site by default, or only the page", () => {
    const ctl = fake({
      a1: {
        botId: "wb1",
        toolName: "WebFetch",
        input: { url: "https://news.example.com/today" },
      },
      a2: {
        botId: "wb1",
        toolName: "WebFetch",
        input: { url: "https://b.example/y" },
      },
    });
    assert.deepEqual(approve(ctl, "a1", { allow: true, remember: true }), {
      ok: true,
      remembered: true,
    });
    approve(ctl, "a2", { allow: true, remember: true, scope: "page" });
    assert.deepEqual(rows("wb1"), [
      { kind: "builtin", tool: "WebFetch", site: "https://news.example.com" },
      { kind: "builtin", tool: "WebFetch", page: "https://b.example/y" },
    ]);
    assert.ok(
      ctl.audit.some(
        (e) =>
          e.type === "grant-saved" &&
          e.tool === "WebFetch" &&
          e.provider === null,
      ),
    );
  });

  it("other built-in tools can't be remembered — allowed once only", () => {
    const ctl = fake({
      a1: { botId: "wb2", toolName: "Bash", input: { command: "ls" } },
    });
    assert.deepEqual(approve(ctl, "a1", { allow: true, remember: true }), {
      ok: true,
      remembered: false,
    });
    assert.deepEqual(rows("wb2"), []);
    // The run's record says allowed, not always allowed.
    assert.equal(ctl.resolved[0][1].remember, false);
  });

  it("Undo puts the grant back exactly as it was", () => {
    grantStore.setGrant("wb3", {
      servers: { Gmail: { tools: ["read"], readPaths: [], writePaths: [] } },
    });
    const before = grantStore.getGrant("wb3");
    const ctl = fake({
      a1: { botId: "wb3", serverName: "Gmail", toolName: "search", input: {} },
    });
    approve(ctl, "a1", { allow: true, remember: true });
    assert.equal(rows("wb3").length, 2);
    assert.deepEqual(approve(ctl, "a1", { undo: true }), { ok: true });
    assert.deepEqual(grantStore.getGrant("wb3"), before);
    // Twice does nothing more.
    assert.deepEqual(approve(ctl, "a1", { undo: true }), { ok: false });
  });

  it("Undo of a bot's first grant removes it entirely", () => {
    const ctl = fake({
      a1: {
        botId: "wb4",
        toolName: "WebFetch",
        input: { url: "https://a.example/" },
      },
    });
    approve(ctl, "a1", { allow: true, remember: true });
    approve(ctl, "a1", { undo: true });
    assert.equal(grantStore.getGrant("wb4"), null);
  });

  it("Undo after another change removes only what that answer added", () => {
    const ctl = fake({
      a1: {
        botId: "wb5",
        toolName: "WebFetch",
        input: { url: "https://a.example/" },
      },
      a2: {
        botId: "wb5",
        toolName: "WebFetch",
        input: { url: "https://b.example/" },
      },
    });
    approve(ctl, "a1", { allow: true, remember: true });
    approve(ctl, "a2", { allow: true, remember: true });
    approve(ctl, "a1", { undo: true });
    assert.deepEqual(rows("wb5"), [
      { kind: "builtin", tool: "WebFetch", site: "https://b.example" },
    ]);
  });

  it("Undo never removes a tool the bot was already allowed", () => {
    grantStore.setGrant("wb6", {
      servers: { Gmail: { tools: ["search"], readPaths: [], writePaths: [] } },
    });
    const ctl = fake({
      a1: { botId: "wb6", serverName: "Gmail", toolName: "search", input: {} },
      a2: {
        botId: "wb6",
        toolName: "WebFetch",
        input: { url: "https://a.example/" },
      },
    });
    approve(ctl, "a1", { allow: true, remember: true });
    approve(ctl, "a2", { allow: true, remember: true });
    approve(ctl, "a1", { undo: true });
    assert.ok(rows("wb6").some((r) => r.tool === "search"));
  });

  it("Ask again removes one row and says so in the log", () => {
    const ctl = fake({
      a1: {
        botId: "wb7",
        toolName: "WebFetch",
        input: { url: "https://a.example/" },
      },
      a2: { botId: "wb7", serverName: "Gmail", toolName: "search", input: {} },
    });
    approve(ctl, "a1", { allow: true, remember: true });
    approve(ctl, "a2", { allow: true, remember: true });
    const left = botController.forgetAlwaysAllowed.call(ctl, "wb7", {
      kind: "builtin",
      tool: "WebFetch",
      site: "https://a.example",
    });
    assert.deepEqual(left, [
      { kind: "tool", provider: "Gmail", tool: "search", folders: [] },
    ]);
    assert.ok(
      ctl.audit.some(
        (e) => e.type === "grant-revoked" && e.tool === "WebFetch",
      ),
    );
  });

  it("Undo after another change also takes back the folder that answer added", () => {
    const ctl = fake({
      a1: {
        botId: "wb8",
        serverName: "Files",
        toolName: "read_file",
        input: { path: "/secret/a.txt" },
      },
      a2: {
        botId: "wb8",
        serverName: "Files",
        toolName: "list_dir",
        input: { directory: "/notes" },
      },
    });
    approve(ctl, "a1", { allow: true, remember: true });
    approve(ctl, "a2", { allow: true, remember: true });
    assert.deepEqual(approve(ctl, "a1", { undo: true }), { ok: true });
    const g = grantStore.getGrant("wb8");
    assert.deepEqual(g.servers.Files.tools, ["list_dir"]);
    assert.ok(!g.servers.Files.readPaths.includes("/secret"));
    assert.ok(g.servers.Files.readPaths.includes("/notes"));
  });
});
