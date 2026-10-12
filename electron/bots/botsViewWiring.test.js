/**
 * Static wiring pins for the Bots view backend (bot-teams TEAM-011 / B1): run
 * history over IPC, and replies that continue a bot's conversation. The
 * controller needs Electron, so — like other controller pins — these check
 * the source for the load-bearing guarantees.
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
const events = require("../events/botEvents");

describe("botController — Bots view backend", () => {
  it("run() can continue the bot's conversation (reply to continue)", () => {
    assert.match(
      ctrl,
      /run\(botId, prompt, \{ continueConversation = false, planId = null \} = \{\}\)/,
    );
    assert.match(
      ctrl,
      /trigger: continueConversation \? "reply" : "manual",\s*continueSession: !!continueConversation/,
    );
  });

  it("getRuns() returns the bot's latest runs (decrypted by the store)", () => {
    assert.match(ctrl, /getRuns\(botId, \{ limit = 50 \} = \{\}\)/);
    assert.match(ctrl, /this\._store\.getRuns\(botId\)/);
  });

  it("listRecentRuns() merges every bot's runs via the decrypting store (B3)", () => {
    assert.match(ctrl, /require\("\.\.\/bots\/recentRuns"\)/);
    assert.match(ctrl, /listRecentRuns\(\{ limit = 10 \} = \{\}\)/);
    assert.match(
      ctrl,
      /recentRuns\(\{\s*bots: this\._store\.list\(\),\s*getRuns: \(id\) => this\._store\.getRuns\(id\),/,
    );
  });

  it("listRunning() reports each run's start and dashboard (B3)", () => {
    assert.match(ctrl, /startedAt: this\._runner\.startedAt\(id\)/);
    assert.match(ctrl, /workspaceId:/);
  });
});

describe("botController — run sources (TEAM-011 gaps)", () => {
  it("event runs pass what triggered them through to the runner", () => {
    assert.match(ctrl, /source: sourceFromEvent\(bot, event\)/);
    assert.match(
      ctrl,
      /this\._runner\.run\(botId, \{[\s\S]{0,200}source: opts\.source \|\| null,/,
    );
  });
});

describe("botApi / events — Bots view IPC", () => {
  it("defines the run-history channel", () => {
    assert.equal(events.BOTS_GET_RUNS, "bots-get-runs");
  });

  it("defines and exposes the recent-runs channel (B3 monitor)", () => {
    assert.equal(events.BOTS_LIST_RECENT_RUNS, "bots-list-recent-runs");
    assert.match(
      api,
      /listRecentRuns: \(limit\) =>\s*ipcRenderer\.invoke\(BOTS_LIST_RECENT_RUNS, \{ limit \}\)/,
    );
  });

  it("exposes getRuns and run(…, { continueConversation })", () => {
    assert.match(api, /getRuns: \(botId, limit\) =>/);
    assert.match(
      api,
      /run: \(botId, prompt, continueConversation = false, opts = \{\}\) =>[\s\S]{0,120}continueConversation/,
    );
  });
});

describe("Bots changed broadcast (TEAM-011 refresh)", () => {
  it("defines the event and exposes onListChanged", () => {
    assert.equal(events.BOT_LIST_CHANGED, "bot-list-changed");
    assert.match(
      api,
      /onListChanged: \(callback\) => _addListener\(BOT_LIST_CHANGED, callback\)/,
    );
  });

  it("the controller broadcasts (coalesced) when bot definitions change", () => {
    assert.match(ctrl, /require\("\.\.\/bots\/coalesce"\)/);
    assert.match(
      ctrl,
      /this\._notifyListChanged = coalesce\(\(\) =>\s*this\._broadcast\(BOT_LIST_CHANGED, \{\}\),?\s*\)/,
    );
    assert.match(
      ctrl,
      /this\._offStoreChange = this\._store\.onChange\(\(\) =>\s*this\._notifyListChanged\(\),?\s*\)/,
    );
  });
});

describe("botController — memory context (private memory)", () => {
  it("passes the calling bot's id to the memory tools", () => {
    assert.match(
      ctrl,
      /handleMemoryTool\(\s*this\._memory,\s*\{\s*workspaceId: opts\.workspaceId,\s*botId: opts\.botId,\s*planId: opts\.planId \|\| null,\s*\},/,
    );
  });
});

describe("botController — delete clears private memory", () => {
  it("forgets the deleted bot's private memory", () => {
    assert.match(
      ctrl,
      /delete\(botId\) \{[\s\S]{0,1000}this\._memory\.forgetBot\(botId\)[\s\S]{0,200}return this\._store\.delete\(botId\);/,
    );
  });
});

describe("botController — asking a lead from the Assistant (TEAM-004)", () => {
  it("askLead takes `via` and _run forwards it to the runner", () => {
    assert.match(
      ctrl,
      /askLead\(botId, question, \{ continueConversation = false, via = null \} = \{\}\)/,
    );
    assert.match(ctrl, /continueSession: !!continueConversation,\s*via,/);
    assert.match(ctrl, /via: opts\.via \|\| null,/);
  });

  it("leadAvailability reports paused and over budget", () => {
    assert.match(
      ctrl,
      /leadAvailability\(botId\) \{[\s\S]{0,300}paused: this\._pause\.isPaused\(botId\)[\s\S]{0,200}overBudget: this\._budgets\.isOverBudget\(/,
    );
  });
});

describe("Lead drafts (TEAM-005)", () => {
  it("the controller keeps drafts and hands the lead a drafting hook", () => {
    assert.match(ctrl, /require\("\.\.\/bots\/botDrafts"\)/);
    assert.match(ctrl, /this\._drafts = new DraftStore\(\)/);
    assert.match(
      ctrl,
      /proposeBot: \(teamCtx, proposal\) =>\s*this\._proposeBot\(teamCtx, proposal\),/,
    );
    assert.match(
      ctrl,
      /_proposeBot\(\{ workspaceId, botId \}, proposal, \{ author = "lead" \} = \{\}\) \{/,
    );
    assert.match(ctrl, /sources: this\.listToolSources\(workspaceId\)/);
  });

  it("lists and dismisses drafts, and broadcasts changes", () => {
    assert.match(ctrl, /listDrafts\(workspaceId\) \{/);
    assert.match(ctrl, /dismissDraft\(draftId\) \{/);
    assert.match(
      ctrl,
      /this\._drafts\.onChange\(\(\) =>\s*this\._notifyDraftsChanged\(\),?\s*\)/,
    );
    assert.match(ctrl, /this\._broadcast\(BOT_DRAFTS_CHANGED, \{\}\)/);
  });

  it("events + api", () => {
    assert.equal(events.BOTS_LIST_DRAFTS, "bots-list-drafts");
    assert.equal(events.BOTS_DISMISS_DRAFT, "bots-dismiss-draft");
    assert.equal(events.BOT_DRAFTS_CHANGED, "bot-drafts-changed");
    assert.match(
      api,
      /listDrafts: \(workspaceId\) =>\s*ipcRenderer\.invoke\(BOTS_LIST_DRAFTS, \{ workspaceId \}\)/,
    );
    assert.match(
      api,
      /dismissDraft: \(draftId\) =>\s*ipcRenderer\.invoke\(BOTS_DISMISS_DRAFT, \{ draftId \}\)/,
    );
    assert.match(
      api,
      /onDraftsChanged: \(callback\) => _addListener\(BOT_DRAFTS_CHANGED, callback\)/,
    );
  });
});

describe("botController — results (team-dashboards TD-001/TD-002)", () => {
  it("gives declared-result bots send_result, auto-allowed like memory", () => {
    assert.match(
      ctrl,
      /internalServers: \[\s*MEMORY_SERVER,\s*TEAM_SERVER,\s*RESULTS_SERVER,/,
    );
    assert.match(
      ctrl,
      /for \(const tool of resultToolsFor\(bot\)\) \{\s*tools\.push\(tool\);\s*toolServer\[tool\.name\] = RESULTS_SERVER;/,
    );
  });

  it("routes send_result to sendResult with the store and the bus", () => {
    assert.match(
      ctrl,
      /if \(serverName === RESULTS_SERVER\) \{[\s\S]{0,120}return sendResult\(\s*\{ store: this\._store, publisher: this\._events \},\s*opts\.botId,\s*args,/,
    );
  });

  it("serves the latest result by event type", () => {
    assert.match(
      ctrl,
      /getLatestResult\(eventType\) \{\s*return latestResult\(this\._store, eventType\);/,
    );
  });
});

describe("botApi / events — latest result IPC (TD-002)", () => {
  it("defines and exposes the latest-result channel", () => {
    assert.equal(events.BOTS_GET_LATEST_RESULT, "bots-get-latest-result");
    assert.match(
      api,
      /getLatestResult: \(eventType\) =>\s*ipcRenderer\.invoke\(BOTS_GET_LATEST_RESULT, \{ eventType \}\)/,
    );
  });
});
