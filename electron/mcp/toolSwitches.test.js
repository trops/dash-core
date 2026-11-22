/**
 * toolSwitches.test.js — Settings › MCP Server › Tools (DASH-37): each
 * tool's switch, its default (the bot tools off, the rest on), the groups,
 * and the server: a tool that's off isn't offered to a client, and refuses
 * if it's called anyway.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const {
  isToolOn,
  listToolSwitches,
  withSwitch,
  groupOf,
  offMessage,
} = require("./toolSwitches");

const tools = [
  { name: "list_dashboards", description: "Dashboards" },
  { name: "list_bots", description: "Bots", defaultOff: true },
  { name: "create_bot", description: "New bot", defaultOff: true },
  { name: "update_bot", description: "Change bot", defaultOff: true },
  { name: "confirm_bot", onWith: ["create_bot", "update_bot"] },
  { name: "ha_call_service", description: "Something else" },
];

describe("tool switches", () => {
  it("bot tools are off by default, the others on", () => {
    assert.equal(isToolOn("list_dashboards", tools, {}), true);
    assert.equal(isToolOn("list_bots", tools, {}), false);
    assert.equal(isToolOn("create_bot", tools, {}), false);
    assert.equal(isToolOn("nope", tools, {}), false);
  });

  it("the user's choice wins over the default", () => {
    const s = { list_dashboards: false, list_bots: true };
    assert.equal(isToolOn("list_dashboards", tools, s), false);
    assert.equal(isToolOn("list_bots", tools, s), true);
  });

  it("confirm_bot is on while create_bot or update_bot is", () => {
    assert.equal(isToolOn("confirm_bot", tools, {}), false);
    assert.equal(isToolOn("confirm_bot", tools, { update_bot: true }), true);
  });

  it("lists every switch in group order, bots first, the rest in Other", () => {
    const list = listToolSwitches(tools, { create_bot: true });
    assert.deepEqual(
      list.map((t) => [t.name, t.group, t.on, t.defaultOff]),
      [
        ["list_bots", "bots", false, true],
        ["create_bot", "bots", true, true],
        ["update_bot", "bots", false, true],
        ["list_dashboards", "dashboards", true, false],
        ["ha_call_service", "other", true, false],
      ],
    );
    assert.equal(groupOf("give_task").label, "Teams and tasks");
  });

  it("only real switches can be set", () => {
    assert.deepEqual(withSwitch(tools, {}, "list_bots", true), {
      list_bots: true,
    });
    assert.equal(withSwitch(tools, {}, "confirm_bot", true), null);
    assert.equal(withSwitch(tools, {}, "nope", true), null);
  });
});

// ---- the server, with Electron and settings faked ----------------------

const CONTROLLER = require.resolve("../controller/mcpDashServerController");
const origRequire = Module.prototype.require;
let saved;

function loadController() {
  Module.prototype.require = function (id) {
    if (id === "electron") {
      return {
        BrowserWindow: { getAllWindows: () => [] },
        app: { getPath: () => "/nowhere" },
      };
    }
    if (id === "./settingsController") {
      return {
        getSettingsForApplication: () => ({ settings: saved }),
        saveSettingsForApplication: (_win, s) => {
          saved = s;
        },
      };
    }
    return origRequire.call(this, id);
  };
  delete require.cache[CONTROLLER];
  return require(CONTROLLER);
}

function fakeServer() {
  const offered = {};
  return {
    offered,
    tool: (name, _d, _shape, handler) => {
      offered[name] = handler;
    },
    resource: () => {},
    prompt: () => {},
  };
}

describe("the MCP server", () => {
  let ctrl;
  beforeEach(() => {
    saved = { mcpDashServer: {} };
    ctrl = loadController();
    for (const t of tools) {
      ctrl.registerTool({
        ...t,
        inputSchema: { type: "object", properties: {} },
        handler: async () => ({ content: [{ type: "text", text: "ran" }] }),
      });
    }
  });
  afterEach(() => {
    Module.prototype.require = origRequire;
    delete require.cache[CONTROLLER];
  });

  it("offers only the tools that are on", () => {
    const server = fakeServer();
    ctrl._applyRegistrations(server);
    assert.deepEqual(Object.keys(server.offered).sort(), [
      "ha_call_service",
      "list_dashboards",
    ]);
  });

  it("setToolOn saves the switch; listTools shows it", () => {
    const list = ctrl.setToolOn(null, "create_bot", true);
    assert.deepEqual(saved.mcpDashServer.tools, { create_bot: true });
    assert.equal(list.find((t) => t.name === "create_bot").on, true);
    const server = fakeServer();
    ctrl._applyRegistrations(server);
    assert.ok(server.offered.create_bot);
    assert.ok(server.offered.confirm_bot);
    assert.throws(() => ctrl.setToolOn(null, "confirm_bot", true));
  });

  it("a tool turned off after it was offered refuses", async () => {
    ctrl.setToolOn(null, "list_bots", true);
    const server = fakeServer();
    ctrl._applyRegistrations(server);
    assert.equal((await server.offered.list_bots({})).content[0].text, "ran");
    ctrl.setToolOn(null, "list_bots", false);
    const r = await server.offered.list_bots({});
    assert.equal(r.isError, true);
    assert.equal(r.content[0].text, offMessage("list_bots"));
  });

  it("keeps the other server settings when a switch changes", () => {
    saved = { mcpDashServer: { port: 4000, token: "t" } };
    ctrl.setToolOn(null, "list_dashboards", false);
    assert.deepEqual(saved.mcpDashServer, {
      port: 4000,
      token: "t",
      tools: { list_dashboards: false },
    });
  });
});
