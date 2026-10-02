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
      /run\(botId, prompt, \{ continueConversation = false \} = \{\}\)/,
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
      /run: \(botId, prompt, continueConversation = false\) =>[\s\S]{0,120}continueConversation/,
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
