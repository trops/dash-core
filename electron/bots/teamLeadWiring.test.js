/**
 * Static wiring pins for team leads (bot-teams TEAM-002 / TEAM-003). The
 * controller and host need Electron, so — like other controller pins — these
 * check the source for the load-bearing guarantees.
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
const host = fs.readFileSync(path.join(__dirname, "host.js"), "utf8");
const api = fs.readFileSync(
  path.join(__dirname, "..", "api", "botApi.js"),
  "utf8",
);

describe("botController — team lead wiring", () => {
  it("gives a lead ONLY its team tools (no providers, no memory)", () => {
    assert.match(
      ctrl,
      /if \(isLead\(bot\)\) \{[\s\S]{0,400}tools: \[\.\.\.TEAM_TOOLS\]/,
    );
  });

  it("serves team tools only to leads, scoped to the lead's dashboard", () => {
    assert.match(
      ctrl,
      /serverName === TEAM_SERVER[\s\S]{0,200}if \(!isLead\(caller\)\)/,
    );
    assert.match(ctrl, /workspaceId: caller\.workspaceId/);
  });

  it("find_providers is served to the lead (CAP-003; no drafts to remember it for since 2c-2)", () => {
    assert.match(
      ctrl,
      /findProviders: \(teamCtx, capability\) =>\s*this\._findProviders\(teamCtx, capability\)/,
    );
    assert.doesNotMatch(ctrl, /_knownProvidersFor|_foundProviders/);
  });

  it("auto-allows team tools at the gate (internal server)", () => {
    assert.match(ctrl, /internalServers: \[\s*MEMORY_SERVER,\s*TEAM_SERVER\b/);
  });

  it("deleting a lead turns it off for that dashboard", () => {
    assert.match(
      ctrl,
      /isLead\(bot\) && bot\.workspaceId[\s\S]{0,200}leadEnabled: false/,
    );
  });

  it("leads' answers never go on the event bus", () => {
    assert.match(ctrl, /!isLead\(this\._store\.get\(botId\)\)/);
  });

  it("Ask the lead continues the session only for follow-ups", () => {
    assert.match(
      ctrl,
      /trigger: "ask",\s*continueSession: !!continueConversation/,
    );
    assert.match(ctrl, /continueSession: !!opts\.continueSession/);
  });
});

describe("host — run answers sealed with the OS keychain", () => {
  it("passes a safeStorage-backed secretBox to the store", () => {
    assert.match(host, /secretBox: createSecretBox\(safeStorage\)/);
    assert.match(ctrl, /secretBox: host\.secretBox/);
  });
});

describe("botApi — lead IPC", () => {
  it("exposes the lead calls to the renderer", () => {
    for (const fn of [
      "ensureLead",
      "setLeadEnabled",
      "getTeamSettings",
      "dismissLeadIntro",
      "getSettings",
      "setSettings",
      "askLead",
    ]) {
      assert.match(api, new RegExp(`\\b${fn}: `), fn);
    }
  });
});

describe("AI Assistant recipient picker wiring (TEAM-013)", () => {
  it("listLeads builds the directory from saved dashboards via summarizeLeads", () => {
    assert.match(
      ctrl,
      /listLeads\(\) \{[\s\S]{0,600}listWorkspacesForApplication[\s\S]{0,400}summarizeLeads\(/,
    );
    assert.match(ctrl, /availability: \(id\) => this\.leadAvailability\(id\)/);
  });

  it("exposes bots.listLeads and passes via through askLead", () => {
    assert.match(
      api,
      /listLeads: \(\) => ipcRenderer\.invoke\(BOTS_LIST_LEADS\)/,
    );
    assert.match(
      api,
      /askLead: \(botId, question, continueConversation = false, via = null\)/,
    );
    assert.match(api, /continueConversation,\s*via,/);
  });
});

// Lead-workspace release 1: the controller side of team_ask_bot (its
// behaviour is tested in leadAsk.test.js).
describe("botController — a lead asks its bots (team_ask_bot)", () => {
  it("the team tools get a runner that asks through leadAsk.js", () => {
    assert.match(
      ctrl,
      /askBot: \(_teamCtx, member, request\) =>\s*this\._leadAskBot\(caller, member, request\)/,
    );
    assert.match(ctrl, /return askTeamBot\(\{/);
    assert.match(
      ctrl,
      /takeHandoff: \(\) => this\._handoffs\.take\(lead\.id, runKey\)/,
    );
    assert.match(ctrl, /run: \(opts\) => this\._run\(member\.id, opts\)/);
    // Who started the lead's own run (an outside caller can't run its bots).
    assert.match(
      ctrl,
      /leadVia: this\._runVia \? this\._runVia\.get\(lead\.id\) : null/,
    );
  });

  it("stopping the lead stops the bots it's waiting on", () => {
    assert.match(
      ctrl,
      /const asked = this\._leadAsked \? this\._leadAsked\.get\(botId\) : null;\s*for \(const id of asked \? \[\.\.\.asked\] : \[\]\) this\.stop\(id\);/,
    );
  });
});
