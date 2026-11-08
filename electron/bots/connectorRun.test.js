/**
 * connectorRun.test.js — a bot's Claude connectors in the real
 * botController: which it gets for a run, the warning for one that isn't
 * connected, a run that can't start when the account couldn't be read, and
 * how the Dash team sees them (bots only, never a widget's provider).
 * Electron is stubbed, like aiRunProfile.test.js.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-conn-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_conn__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_conn__"] = {
  id: "__stub_electron_conn__",
  filename: "__stub_electron_conn__",
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
const { describeProvider } = require("./roleTools");

const CALENDAR_PROVIDER = {
  name: "Google Calendar",
  type: "claude-connector",
  providerClass: "connector",
  credentials: {},
  mcpConfig: {
    transport: "claude-connector",
    server: "claude.ai Google Calendar",
  },
  allowedTools: ["list_events", "create_event"],
};
const CALENDAR = {
  server: "claude.ai Google Calendar",
  name: "Google Calendar",
  status: "connected",
  tools: [{ name: "list_events", readOnly: true }, { name: "create_event" }],
};
const SLACK = {
  server: "claude.ai Slack",
  name: "Slack",
  status: "connected",
  tools: [{ name: "send_message" }],
};

function fake(listing) {
  const sent = [];
  return {
    _appId: "app",
    _getMainWindow: () => null,
    _providers: {
      listProviders: () => ({ providers: [CALENDAR_PROVIDER] }),
    },
    _connectorLister: {
      list: async () => listing,
      cached: () => listing,
    },
    _claudeConnectors: botController._claudeConnectors,
    _connectedServers: () => [],
    _broadcast: (_ch, msg) => sent.push(msg),
    sent,
  };
}

const bot = { id: "bot_1", mcpServers: ["Google Calendar"] };

describe("a bot's Claude connectors for one run", () => {
  it("only the granted ones, their allowed tools, every server to hide the rest", async () => {
    const self = fake({ state: "ready", connectors: [CALENDAR, SLACK] });
    const r = await botController._resolveConnectors.call(self, bot);
    assert.deepEqual(r.connectors, [
      {
        provider: "Google Calendar",
        server: "claude.ai Google Calendar",
        allowed: ["list_events", "create_event"],
      },
    ]);
    assert.deepEqual(r.connectorServers, [
      "claude.ai Google Calendar",
      "claude.ai Slack",
    ]);
    assert.equal(
      r.toolServer["mcp__claude_ai_Google_Calendar__list_events"],
      "Google Calendar",
    );
    assert.deepEqual(r.readOnly, [
      "mcp__claude_ai_Google_Calendar__list_events",
    ]);
    assert.equal(self.sent.length, 0);
  });

  it("a bot with none: nothing, and the account isn't read", async () => {
    let read = 0;
    const self = fake(null);
    self._connectorLister.list = async () => {
      read++;
      return null;
    };
    const r = await botController._resolveConnectors.call(self, {
      id: "b2",
      mcpServers: [],
    });
    assert.deepEqual(r.connectors, []);
    assert.equal(read, 0);
  });

  it("not connected in the account right now: a warning on the run", async () => {
    const self = fake({
      state: "ready",
      connectors: [{ ...CALENDAR, status: "needs-auth", tools: [] }],
    });
    await botController._resolveConnectors.call(self, bot);
    assert.match(
      self.sent[0].event.message,
      /isn't connected in your Claude account/,
    );
  });

  it("the account couldn't be read: the run doesn't start, and says why", async () => {
    const self = fake({
      state: "not-signed-in",
      connectors: [],
      message: "Claude Code isn't signed in with a Claude account.",
    });
    await assert.rejects(
      () => botController._resolveConnectors.call(self, bot),
      /Google Calendar couldn't be used: Claude Code isn't signed in with a Claude account\./,
    );
  });
});

describe("the Dash team and Claude connectors", () => {
  it("lists one as bots-only, never as credentials a widget can use", () => {
    const self = fake({ state: "ready", connectors: [CALENDAR] });
    self.listToolSources = botController.listToolSources;
    const list = botController._providerToolsWithFlags.call(self);
    const calendar = list.filter((p) => p.name === "Google Calendar");
    assert.equal(calendar.length, 1);
    assert.equal(calendar[0].connector, true);
    assert.match(
      describeProvider(calendar[0]),
      /Claude connector: bots only.*Widgets can't use it/,
    );
  });
});
