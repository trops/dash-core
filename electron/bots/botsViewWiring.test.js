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
});

describe("botApi / events — Bots view IPC", () => {
  it("defines the run-history channel", () => {
    assert.equal(events.BOTS_GET_RUNS, "bots-get-runs");
  });

  it("exposes getRuns and run(…, { continueConversation })", () => {
    assert.match(api, /getRuns: \(botId, limit\) =>/);
    assert.match(
      api,
      /run: \(botId, prompt, continueConversation = false\) =>[\s\S]{0,120}continueConversation/,
    );
  });
});
