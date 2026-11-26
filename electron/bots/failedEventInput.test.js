/**
 * failedEventInput.test.js — a bot's `failed` event says what it was working
 * on (DASH-92): what the failed run was given (`input`) and the table rows
 * its job had picked (`picks`, e.g. { repo: "dash-core" }). Whatever reports
 * the failure (a factory's Reporter) reads the ticket from it and never has
 * to guess. Both ways a bot fails: a run that failed, and work that didn't
 * pass its checks.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const BotEventPublisher = require("./BotEventPublisher");
const { failedPayload, PAYLOAD_TEXT_LIMIT } = require("./botEvents");

const bot = { id: "bot_ws", name: "Workspace Bot", ref: "local/workspace-bot" };
const HAND_ON =
  'Ticket Bot completed.\n```json\n{"key": "DASH-90", "repo": "code-factory-sandbox-2"}\n```';

function setup() {
  const published = [];
  const pub = new BotEventPublisher({
    publish: (msg) => published.push(msg),
    providerType: () => null,
  });
  return { pub, published };
}

describe("failedPayload (DASH-92)", () => {
  it("carries the input and picks when there are some", () => {
    const p = failedPayload(bot, {
      trigger: "event",
      error: "boom",
      input: HAND_ON,
      picks: { repo: "code-factory-sandbox-2" },
    });
    assert.equal(p.input, HAND_ON);
    assert.deepEqual(p.picks, { repo: "code-factory-sandbox-2" });
    assert.equal(p.error, "boom");
  });

  it("leaves them out when there's none, as before", () => {
    const p = failedPayload(bot, { trigger: "manual", error: "boom" });
    assert.equal("input" in p, false);
    assert.equal("picks" in p, false);
    const empty = failedPayload(bot, { error: "x", input: "", picks: {} });
    assert.equal("input" in empty, false);
    assert.equal("picks" in empty, false);
  });

  it("cuts a long input like the error", () => {
    const long = "x".repeat(PAYLOAD_TEXT_LIMIT + 50) + HAND_ON;
    const p = failedPayload(bot, { error: "boom", input: long });
    assert.ok(p.input.startsWith("…[truncated]"));
    assert.ok(p.input.endsWith(HAND_ON), "keeps the tail, where the JSON is");
  });
});

describe("BotEventPublisher's failed events (DASH-92)", () => {
  it("a run that failed: its event has what it was given and its picks", () => {
    const { pub, published } = setup();
    pub.startRun(bot.id, undefined, {
      input: HAND_ON,
      picks: { repo: "code-factory-sandbox-2" },
    });
    pub.endRun(bot, { trigger: "event", status: "failed", error: "No row" });
    const m = published.find((x) => x.eventType.endsWith(".failed"));
    assert.equal(m.content.input, HAND_ON);
    assert.deepEqual(m.content.picks, { repo: "code-factory-sandbox-2" });
    assert.equal(m.content.error, "No row");
  });

  it("a completed run's event is unchanged", () => {
    const { pub, published } = setup();
    pub.startRun(bot.id, undefined, { input: HAND_ON, picks: { repo: "a" } });
    pub.onRunEvent(bot.id, { type: "text", text: "Done" });
    pub.endRun(bot, { trigger: "event", status: "completed" });
    assert.equal(published[0].content.output, "Done");
    assert.equal("input" in published[0].content, false);
  });

  it("held work keeps them, and fail() sends them", () => {
    const { pub, published } = setup();
    pub.startRun(bot.id, undefined, {
      hold: true,
      input: HAND_ON,
      picks: { repo: "code-factory-sandbox" },
    });
    const kept = pub.holdRun(bot.id);
    assert.equal(kept.input, HAND_ON);
    assert.deepEqual(kept.picks, { repo: "code-factory-sandbox" });
    pub.fail(bot, {
      cause: kept.cause,
      error: "Didn't pass",
      input: kept.input,
      picks: kept.picks,
    });
    assert.equal(published[0].content.input, HAND_ON);
    assert.deepEqual(published[0].content.picks, {
      repo: "code-factory-sandbox",
    });
  });
});
