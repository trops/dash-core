/**
 * BotEventPublisher.test.js — per-run bookkeeping that turns a bot's run into
 * bus events (completed / failed / tool.*), carrying the loop chain.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const BotEventPublisher = require("./BotEventPublisher");

const bot = {
  id: "bot_9",
  name: "Gmail Email Check",
  ref: "local/gmail-email-check",
};

function setup(opts = {}) {
  const published = [];
  const pub = new BotEventPublisher({
    publish: (msg) => published.push(msg),
    providerType: (name) =>
      opts.types ? opts.types[name] || null : { "Gmail New": "gmail" }[name],
  });
  return { pub, published };
}

describe("BotEventPublisher", () => {
  it("publishes completed with the run's final text when a run ends", () => {
    const { pub, published } = setup();
    pub.startRun(bot.id);
    pub.onRunEvent(bot.id, { type: "text", text: "Found " });
    pub.onRunEvent(bot.id, { type: "tool_call", name: "x" });
    pub.onRunEvent(bot.id, { type: "text", text: "3 important emails." });
    pub.endRun(bot, { trigger: "manual", status: "completed" });

    assert.equal(published.length, 1);
    const m = published[0];
    assert.equal(m.eventType, "bot:local/gmail-email-check[bot_9].completed");
    assert.equal(m.content.botId, "bot_9");
    assert.equal(m.content.trigger, "manual");
    assert.equal(m.content.output, "Found 3 important emails.");
    assert.deepEqual(m.chain, ["bot_9"]);
    assert.equal(m.depth, 1);
  });

  it("separates text written before and after a tool call", () => {
    const { pub, published } = setup();
    pub.startRun(bot.id);
    pub.onRunEvent(bot.id, { type: "text", text: "Checking." });
    pub.onRunEvent(bot.id, { type: "tool_call", name: "x" });
    pub.onRunEvent(bot.id, { type: "text", text: "Done" });
    pub.endRun(bot, { trigger: "manual", status: "completed" });
    assert.equal(published[0].content.output, "Checking.\n\nDone");
  });

  it("publishes failed with the error", () => {
    const { pub, published } = setup();
    pub.startRun(bot.id);
    pub.endRun(bot, { trigger: "event", status: "failed", error: "boom" });
    assert.equal(published[0].eventType.endsWith(".failed"), true);
    assert.equal(published[0].content.error, "boom");
  });

  it("publishes nothing for a skipped run", () => {
    const { pub, published } = setup();
    pub.endRun(bot, { skipped: true });
    assert.equal(published.length, 0);
  });

  it("carries the triggering chain into everything the run publishes", () => {
    const { pub, published } = setup();
    pub.startRun(bot.id, { chain: ["bot_1"], depth: 1 });
    pub.toolCalled(bot, {
      serverName: "Gmail New",
      toolName: "search_emails",
      args: { q: "x" },
      result: { text: "2 results" },
    });
    pub.endRun(bot, { trigger: "event", status: "completed" });
    for (const m of published) {
      assert.deepEqual(m.chain, ["bot_1", "bot_9"]);
      assert.equal(m.depth, 2);
    }
  });

  it("publishes tool.<providerType>.<tool> for a successful provider call", () => {
    const { pub, published } = setup();
    pub.startRun(bot.id);
    pub.toolCalled(bot, {
      serverName: "Gmail New",
      toolName: "search_emails",
      args: { q: "newer_than:1h" },
      result: { text: "2 results" },
    });
    const m = published[0];
    assert.equal(
      m.eventType,
      "bot:local/gmail-email-check[bot_9].tool.gmail.search_emails",
    );
    assert.equal(m.content.provider, "Gmail New");
    assert.equal(m.content.providerType, "gmail");
    assert.equal(m.content.result, "2 results");
  });

  it("skips failed tool calls and providers with no known type", () => {
    const { pub, published } = setup();
    pub.startRun(bot.id);
    pub.toolCalled(bot, {
      serverName: "Gmail New",
      toolName: "search_emails",
      result: { text: "nope", isError: true },
    });
    pub.toolCalled(bot, {
      serverName: "Mystery",
      toolName: "x",
      result: { text: "ok" },
    });
    assert.equal(published.length, 0);
  });

  it("a publish failure never breaks the run", () => {
    const pub = new BotEventPublisher({
      publish: () => {
        throw new Error("bus down");
      },
      providerType: () => "gmail",
    });
    pub.startRun(bot.id);
    assert.doesNotThrow(() =>
      pub.endRun(bot, { trigger: "manual", status: "completed" }),
    );
  });

  it("clears per-run state after the run ends", () => {
    const { pub, published } = setup();
    pub.startRun(bot.id, { chain: ["bot_1"], depth: 1 });
    pub.onRunEvent(bot.id, { type: "text", text: "first" });
    pub.endRun(bot, { trigger: "event", status: "completed" });
    pub.startRun(bot.id);
    pub.endRun(bot, { trigger: "manual", status: "completed" });
    assert.equal(published[1].content.output, "");
    assert.deepEqual(published[1].chain, ["bot_9"]);
  });
});
