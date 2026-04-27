/**
 * Tests for installExternalMcpTool.
 *
 * The tool is the AI's gateway into installing a known-external MCP
 * server. The renderer's confirmation modal in dash-electron drives
 * the user-facing flow; this file tests the main-process tool's
 * decision logic — specifically that:
 *
 *   1. An id NOT in the curated allow-list returns isError (rejected
 *      before any prompt fires).
 *   2. When the user declines, the tool returns isError so the
 *      `dash-mcp:state-changed` broadcast wrapper in
 *      mcpDashServerController skips the renderer's onStateChanged
 *      handler — otherwise the running Widget Builder modal gets torn
 *      down and the user loses their generated widget.
 *   3. A successful install returns no isError so the broadcast fires
 *      (the renderer needs to refresh its providers list).
 *
 * The tool's runtime deps (electron, mcpDashServerController, toolHandlers,
 * mcpController) are mocked via Module._cache injection so the test can
 * exercise the real `handleInstallKnownMcpServer` without booting Electron.
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// ── Test harness: install fakes for the tool's dependencies before
// requiring the module under test. We intercept Module.prototype.require
// rather than mutating require.cache so the fakes apply to the in-module
// require() calls inside installExternalMcpTool.js itself.

const Module = require("module");
const origRequire = Module.prototype.require;

// Mutable knobs the tests flip per scenario:
let mockServersInCatalog = [];
let mockUserDecision = null; // injected via the awaitUserConfirmation override
let mockAddProviderResult = { content: [{ type: "text", text: "ok" }] };
let registeredTools = [];

// Track whether the renderer-side ipcMain listener was installed.
let ipcOnListeners = [];

const fakeBrowserWindow = { getAllWindows: () => [] };
const fakeIpcMain = {
  on: (event, listener) => {
    ipcOnListeners.push({ event, listener });
  },
};

const fakeMcpController = {
  getKnownExternalCatalog: () => ({
    success: true,
    servers: mockServersInCatalog,
  }),
};
const fakeMcpDashServerController = {
  registerTool: (def) => registeredTools.push(def),
};
const fakeToolHandlers = {
  handleAddProvider: async () => mockAddProviderResult,
};

// Path to the real source module — required AFTER the require shim is in place.
const TOOL_PATH = require.resolve("./installExternalMcpTool.js");

function installRequireShim() {
  Module.prototype.require = function (id) {
    if (id === "electron") {
      return { BrowserWindow: fakeBrowserWindow, ipcMain: fakeIpcMain };
    }
    if (id === "../controller/mcpDashServerController") {
      return fakeMcpDashServerController;
    }
    if (id === "../controller/mcpController") {
      return fakeMcpController;
    }
    if (id === "./toolHandlers") {
      return fakeToolHandlers;
    }
    return origRequire.call(this, id);
  };
}

function uninstallRequireShim() {
  Module.prototype.require = origRequire;
  // Drop the cached module so the next test re-requires fresh and re-runs
  // its top-level setup.
  delete require.cache[TOOL_PATH];
}

// Override the tool's wait-for-confirmation so the test can synchronously
// inject the user's decision without an actual IPC round-trip. The tool
// emits a confirmation request on the main window's webContents and waits
// for a result IPC. We short-circuit by replacing the awaitUserConfirmation
// internal function via runtime monkey-patch on the loaded module.
function loadToolWithMockedConfirmation() {
  installRequireShim();
  const tool = require(TOOL_PATH);

  // Monkey-patch by re-evaluating the relevant section: read the source,
  // replace awaitUserConfirmation with a stub. Easiest: hijack the test
  // by rebinding handleInstallKnownMcpServer through a wrapper that pre-
  // empts the awaitUserConfirmation call. Since we can't easily do that
  // without changing the source, we instead drive the IPC listener
  // directly: the tool installs an ipcMain.on handler at first use; once
  // installed, calling that listener with the requestId resolves the
  // pending promise. We simulate that by:
  //   1. Calling handleInstallKnownMcpServer (it kicks off the wait),
  //   2. Pulling the stored requestId from the BrowserWindow.send mock,
  //   3. Firing the ipcMain listener with our canned decision.

  // For the simpler tests (allow-list rejection) the wait never starts,
  // so this whole dance is unnecessary.
  return tool;
}

describe("installExternalMcpTool.handleInstallKnownMcpServer", () => {
  beforeEach(() => {
    mockServersInCatalog = [];
    mockUserDecision = null;
    mockAddProviderResult = { content: [{ type: "text", text: "ok" }] };
    registeredTools = [];
    ipcOnListeners = [];
  });

  afterEach(() => {
    uninstallRequireShim();
  });

  it("rejects an id missing from the allow-list with isError", async () => {
    mockServersInCatalog = [
      {
        id: "atlassian",
        name: "Atlassian",
        mcpConfig: {},
        credentialSchema: {},
      },
    ];
    const { handleInstallKnownMcpServer } = loadToolWithMockedConfirmation();

    const result = await handleInstallKnownMcpServer({ id: "evil-package" });

    assert.equal(
      result.isError,
      true,
      "rejected ids must surface as isError so the AI knows the install never happened",
    );
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.success, false);
    assert.match(payload.error, /not in the known-external MCP allow-list/);
  });

  it("rejects an empty / non-string id with isError", async () => {
    const { handleInstallKnownMcpServer } = loadToolWithMockedConfirmation();
    const noArg = await handleInstallKnownMcpServer({});
    assert.equal(noArg.isError, true);
    const numId = await handleInstallKnownMcpServer({ id: 42 });
    assert.equal(numId.isError, true);
  });

  it("resolves with isError when the user declines so the broadcast wrapper skips remount", async () => {
    // Inject a curated entry the AI is requesting.
    mockServersInCatalog = [
      {
        id: "atlassian",
        name: "Atlassian",
        mcpConfig: { transport: "stdio", command: "uvx", args: ["x"] },
        credentialSchema: {},
      },
    ];

    // Capture the requestId the tool sends to the (mocked) renderer so
    // we can drive the ipcMain listener with a matching decline.
    let sentRequest = null;
    fakeBrowserWindow.getAllWindows = () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (_channel, payload) => {
            sentRequest = payload;
          },
        },
      },
    ];

    const { handleInstallKnownMcpServer } = loadToolWithMockedConfirmation();
    const promise = handleInstallKnownMcpServer({ id: "atlassian" });

    // Yield so the tool can install the ipcMain.on listener and call send.
    await new Promise((r) => setImmediate(r));

    assert.ok(sentRequest, "tool should have emitted a confirm-IPC payload");
    assert.equal(sentRequest.id, "atlassian");
    assert.equal(typeof sentRequest.requestId, "string");

    // Find the listener the tool installed and fire it with a decline.
    const resultListener = ipcOnListeners.find(
      (l) => l.event === "mcp-install-known-external-result",
    );
    assert.ok(resultListener, "tool should listen on the result IPC channel");

    resultListener.listener(null, {
      requestId: sentRequest.requestId,
      result: { confirmed: false },
    });

    const result = await promise;

    // CRITICAL: declines must carry isError so the
    // mcpDashServerController wrapper SKIPS broadcastStateChanged. If
    // this regresses, the WidgetBuilder modal will tear down on cancel
    // and the user loses their generated widget.
    assert.equal(
      result.isError,
      true,
      "declined installs must mark isError so the broadcast wrapper skips state-changed and the WidgetBuilder modal stays mounted",
    );
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.success, false);
    assert.equal(payload.declined, true);

    fakeBrowserWindow.getAllWindows = () => [];
  });

  it("returns success without isError on a confirmed install so the broadcast fires", async () => {
    mockServersInCatalog = [
      {
        id: "atlassian",
        name: "Atlassian",
        mcpConfig: { transport: "stdio", command: "uvx", args: ["x"] },
        credentialSchema: {
          token: { type: "text", required: true, secret: true },
        },
      },
    ];

    let sentRequest = null;
    fakeBrowserWindow.getAllWindows = () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (_channel, payload) => {
            sentRequest = payload;
          },
        },
      },
    ];

    const { handleInstallKnownMcpServer } = loadToolWithMockedConfirmation();
    const promise = handleInstallKnownMcpServer({ id: "atlassian" });
    await new Promise((r) => setImmediate(r));

    const resultListener = ipcOnListeners.find(
      (l) => l.event === "mcp-install-known-external-result",
    );
    resultListener.listener(null, {
      requestId: sentRequest.requestId,
      result: { confirmed: true, credentials: { token: "abc" } },
    });

    const result = await promise;

    // Successful install: no isError so the broadcast fires and the
    // renderer's providers list refreshes.
    assert.equal(
      result.isError,
      undefined,
      "successful installs must not set isError or the providers list won't refresh",
    );
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.success, true);
    assert.equal(payload.type, "atlassian");

    fakeBrowserWindow.getAllWindows = () => [];
  });
});
