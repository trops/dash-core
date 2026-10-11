/**
 * dashTeamWiring.test.js — the controller applies the Dash team rules
 * (create-entry CRE-011). Source checks: botController needs Electron.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ctrl = fs.readFileSync(
  path.join(__dirname, "..", "controller", "botController.js"),
  "utf8",
);
const api = fs.readFileSync(
  path.join(__dirname, "..", "api", "botApi.js"),
  "utf8",
);

describe("botController — Dash team (CRE-011)", () => {
  it("creates the team at startup, before it's ready", () => {
    assert.match(ctrl, /this\.ensureDashTeam\(\);\s*this\._ready = true;/);
  });

  it("refuses to delete a team bot", () => {
    assert.match(
      ctrl,
      /delete\(botId\) \{\s*const bot = this\._store\.get\(botId\);\s*if \(isDashTeam\(bot\)\) \{\s*throw new Error/,
    );
  });

  it("list() leaves the team out; listDashTeam() is its own channel", () => {
    assert.match(
      ctrl,
      /list\(\) \{\s*return this\._store\.list\(\)\.filter\(\(b\) => !isDashTeam\(b\)\);/,
    );
    assert.match(ctrl, /listDashTeam\(\) \{/);
    assert.match(
      api,
      /listDashTeam: \(\) => ipcRenderer\.invoke\(BOTS_LIST_DASH_TEAM\)/,
    );
  });

  it("pause is saved and a paused bot doesn't start", () => {
    assert.match(ctrl, /new PauseController\(\{\s*persistence: \{/);
    assert.match(
      ctrl,
      /startBlocker: \(botId\) =>\s*this\._pause\.isPaused\(botId\) \? "this bot is paused" : null/,
    );
  });

  it("team bots run on their role's model; leads default to the fast tier", () => {
    assert.match(
      ctrl,
      /modelForRole\(bot, providerId, this\._store\.getSettings\(\)\)/,
    );
    assert.match(
      ctrl,
      /else if \(isLead\(bot\)\) \{\s*model = tierModel\(providerId, "fast"\) \|\| getDefaultModel\(providerId\);/,
    );
  });

  it("built-ins per role come from the run profile", () => {
    assert.match(ctrl, /isDashTeam\(bot\)\s*\? builtinToolsFor\(bot\)/);
  });

  it("settings take dashTeam model picks", () => {
    assert.match(ctrl, /next\.dashTeam = mergeDashTeamSettings\(/);
  });

  it("a saved team bot keeps its identity and no triggers", () => {
    assert.match(
      ctrl,
      /system: existing\.system,\s*role: existing\.role,\s*workspaceId: null,[\s\S]{0,80}schedules: \[\],\s*subscriptions: \[\],/,
    );
  });
});

describe("botController — role tools (CRE-011, slice 3a)", () => {
  it("team bots get only their role's tools, on an auto-allowed server", () => {
    assert.match(
      ctrl,
      /if \(isDashTeam\(bot\)\) \{\s*const tools = roleToolsFor\(bot\.role\);/,
    );
    assert.match(ctrl, /RESULTS_SERVER,\s*ROLE_SERVER,\s*\]/);
  });

  it("role tool calls re-check that the caller is on the team", () => {
    assert.match(
      ctrl,
      /if \(serverName === ROLE_SERVER \|\| serverName === ROLE_BUILD_SERVER\) \{\s*const caller = this\._store\.get\(opts\.botId\);\s*if \(!isDashTeam\(caller\)\)/,
    );
    assert.match(ctrl, /\{ botId: caller\.id, role: caller\.role \}/);
  });

  it("ask_role is capped per run, refuses a busy role and runs it as an ask", () => {
    assert.match(ctrl, /this\._handoffs = new HandoffCap\(\)/);
    assert.match(ctrl, /if \(!this\._handoffs\.take\(callerId, runKey\)\)/);
    assert.match(ctrl, /if \(this\._runner\.isRunning\(target\.id\)\)/);
    assert.match(ctrl, /trigger: "ask",\s*via: \`dash-team:/);
  });

  it("team runs stay off the event bus", () => {
    assert.match(
      ctrl,
      /!isLead\(this\._store\.get\(botId\)\) &&\s*!isDashTeam\(this\._store\.get\(botId\)\)/,
    );
  });
});

describe("botController — list_providers covers every provider (3a)", () => {
  it("credential providers are included, marked", () => {
    assert.match(ctrl, /p\.providerClass !== "mcp"/);
    assert.match(ctrl, /return \[\.\.\.mcp, \.\.\.credentials\];/);
  });
});

describe("botController — build and check (CRE-011, slice 3b-1)", () => {
  it("takes the host's widget tools at init", () => {
    assert.match(
      ctrl,
      /widgetTools = null,\s*\} = deps;\s*this\._widgetTools = widgetTools;/,
    );
  });

  it("build_widget is served from the server the gate asks about, never the auto-allowed one", () => {
    assert.match(ctrl, /if \(serverForTool\(toolName\) !== serverName\)/);
    assert.match(ctrl, /\? serverForTool\(toolName\)/);
    // ROLE_BUILD_SERVER is not in internalServers.
    const internal = /internalServers: \[([\s\S]*?)\]/.exec(ctrl)[1];
    assert.ok(!internal.includes("ROLE_BUILD_SERVER"));
  });

  it("the Builder's provider type becomes the user's { type, providerClass }", () => {
    assert.match(ctrl, /provider: this\._providerPick\(req\.provider\)/);
  });
});

describe("botController — the build server is configured for the Builder's runs (3b-1)", () => {
  it("_resolveTools lists it so the gate asks instead of refusing", () => {
    assert.match(
      ctrl,
      /servers: tools\.some\(\(t\) => serverForTool\(t\.name\) === ROLE_BUILD_SERVER\)/,
    );
  });
});
