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
