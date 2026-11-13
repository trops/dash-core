/**
 * mcpScreenHolds.test.js — a server two screens use (a widget preview being
 * replaced by the next one, a dashboard and a preview) stops only when the
 * last one lets it go. Found live: the old preview's cleanup stopped the
 * Google Calendar server the new preview had just started, so every call
 * failed with "Server not connected". Electron is stubbed like
 * connectorRun.test.js; the real start/stop are replaced by recorders.
 */
"use strict";

const { describe, it, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-holds-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_holds__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_holds__"] = {
  id: "__stub_electron_holds__",
  filename: "__stub_electron_holds__",
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
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
  },
};

const mcpController = require("./mcpController");

describe("a server two screens use stops only when the last lets it go", () => {
  let stops;
  const DELAY = () => mcpController._screenStopDelay();
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
    stops = [];
    mcpController.startServer = async () => ({ success: true });
    mcpController.stopServer = async (_win, name, ws) => {
      stops.push(`${ws || "-"}::${name}`);
      return { success: true };
    };
  });

  it("an old preview letting go doesn't stop the new preview's server", async () => {
    // The old preview, then the new one, start it (same no-dashboard bucket).
    await mcpController.startServerForScreen(
      null,
      "Google Calendar",
      {},
      {},
      null,
    );
    await mcpController.startServerForScreen(
      null,
      "Google Calendar",
      {},
      {},
      null,
    );
    const first = await mcpController.stopServerForScreen(
      null,
      "Google Calendar",
      null,
    );
    assert.equal(first.stillInUse, true);
    assert.deepEqual(stops, []);
    // The new one closes too: it stops a moment later.
    await mcpController.stopServerForScreen(null, "Google Calendar", null);
    assert.deepEqual(stops, []);
    mock.timers.tick(DELAY());
    await Promise.resolve();
    assert.deepEqual(stops, ["-::Google Calendar"]);
    mock.timers.reset();
  });

  it("a screen mounted twice (let go, then taken back at once) never stops it", async () => {
    await mcpController.startServerForScreen(null, "Calendar 2", {}, {}, null);
    await mcpController.stopServerForScreen(null, "Calendar 2", null);
    await mcpController.startServerForScreen(null, "Calendar 2", {}, {}, null);
    mock.timers.tick(DELAY());
    await Promise.resolve();
    assert.deepEqual(stops, []);
    mock.timers.reset();
  });

  it("dashboards are counted apart", async () => {
    await mcpController.startServerForScreen(null, "Gmail", {}, {}, "ws1");
    await mcpController.startServerForScreen(null, "Gmail", {}, {}, "ws2");
    await mcpController.stopServerForScreen(null, "Gmail", "ws1");
    mock.timers.tick(DELAY());
    await Promise.resolve();
    assert.deepEqual(stops, ["ws1::Gmail"]);
    mock.timers.reset();
  });
});
