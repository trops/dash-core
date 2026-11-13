/**
 * providerSummaries.test.js — "which of my providers can do this" reads
 * providers.json as it is: name, kind, the tools approved at setup —
 * nothing decrypted, so a sign-in that can't be read here never hides a
 * provider (found live: the list came back empty and the app offered to
 * connect a Google Calendar the user already had).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-summaries-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_summaries__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_summaries__"] = {
  id: "__stub_electron_summaries__",
  filename: "__stub_electron_summaries__",
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
    shell: {},
    dialog: {},
    // Nothing can be decrypted here.
    safeStorage: {
      isEncryptionAvailable: () => false,
      decryptString: () => {
        throw new Error("can't decrypt");
      },
    },
  },
};

const providerController = require("./providerController");

describe("the user's providers, from providers.json — nothing decrypted", () => {
  const appId = "@trops/dash-electron";
  const dir = path.join(stubDir, "Dashboard", appId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "providers.json"),
    JSON.stringify({
      "Google Calendar": {
        type: "google-calendar",
        providerClass: "mcp",
        credentials: "ENCRYPTED",
        mcpConfig: { transport: "stdio", command: "npx" },
        allowedTools: ["list-events", "create-event"],
      },
      "Home Assistant MCP": {
        type: "home-assistant-mcp",
        providerClass: "mcp",
        credentials: "ENCRYPTED",
        isDefaultForType: true,
        allowedTools: ["ha_config_get_calendar_events"],
      },
      "Google Calendar (Claude connector)": {
        type: "claude-connector",
        providerClass: "connector",
        credentials: "ENCRYPTED",
        mcpConfig: { server: "claude.ai Google Calendar" },
        allowedTools: ["list_events"],
      },
      __test__probe: { type: "x", providerClass: "mcp" },
    }),
  );

  it("lists every provider with its approved tools, even when sign-ins can't be read", () => {
    const { providers } = providerController.listProviderSummaries(null, appId);
    assert.deepEqual(
      providers.map((p) => p.name),
      [
        "Google Calendar",
        "Home Assistant MCP",
        "Google Calendar (Claude connector)",
      ],
    );
    const ha = providers.find((p) => p.name === "Home Assistant MCP");
    assert.deepEqual(ha.allowedTools, ["ha_config_get_calendar_events"]);
    assert.equal(ha.isDefaultForType, true);
    const conn = providers.find((p) => p.providerClass === "connector");
    assert.deepEqual(conn.mcpConfig, { server: "claude.ai Google Calendar" });
  });

  it("never returns sign-ins or how to start a server", () => {
    const { providers } = providerController.listProviderSummaries(null, appId);
    for (const p of providers) {
      assert.equal(p.credentials, undefined);
      assert.ok(!(p.mcpConfig && p.mcpConfig.command));
    }
  });
});
