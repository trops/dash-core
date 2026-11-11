/**
 * lastAnswers — a bot's finished answers for widgets that show them (TD-009).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseCompletedEventType,
  lastAnswers,
  latestCompleted,
  describeAnswers,
} = require("./lastAnswers");

const bot = { id: "bot_shop1", name: "Shopping Helper" };
const runs = [
  {
    at: "2026-11-08T08:00:00Z",
    status: "completed",
    output: "| Item | Link |",
    trigger: "schedule",
  },
  {
    at: "2026-11-09T08:00:00Z",
    status: "completed",
    output: "- Bananas https://x.test/b",
  },
  { at: "2026-11-09T12:00:00Z", status: "failed", output: "", error: "boom" },
  { at: "2026-11-10T07:00:00Z", skipped: true, output: "skip" },
  {
    at: "2026-11-10T08:02:00Z",
    status: "completed",
    output: "- ![](https://x.test/m.jpg) Oat milk",
  },
  { at: "2026-11-10T09:00:00Z", status: "stopped", output: "half" },
];
const store = {
  get: (id) => (id === bot.id ? bot : null),
  getRuns: () => runs,
};

describe("parseCompletedEventType", () => {
  it("reads the bot id of a completed event", () => {
    assert.deepEqual(
      parseCompletedEventType("bot:local/shopping-helper[bot_shop1].completed"),
      { botId: "bot_shop1" },
    );
  });
  it("is null for other events", () => {
    assert.equal(parseCompletedEventType("bot:x[bot_a].failed"), null);
    assert.equal(parseCompletedEventType("bot:x[bot_a].result.list"), null);
    assert.equal(parseCompletedEventType("Clock[3].tick"), null);
    assert.equal(parseCompletedEventType(null), null);
  });
});

describe("lastAnswers", () => {
  it("keeps finished answers, newest first, at most 3", () => {
    const a = lastAnswers(runs);
    assert.equal(a.length, 3);
    assert.match(a[0].output, /Oat milk/);
    assert.match(a[1].output, /Bananas/);
    assert.match(a[2].output, /Item/);
    assert.equal(a[2].trigger, "schedule");
    assert.equal(a[0].at, "2026-11-10T08:02:00.000Z");
  });
  it("leaves out failed, stopped, skipped and empty runs", () => {
    const outs = lastAnswers(runs).map((a) => a.output);
    assert.ok(!outs.includes("half"));
    assert.ok(!outs.includes("skip"));
  });
  it("takes a smaller count and copes with no runs", () => {
    assert.equal(lastAnswers(runs, 1).length, 1);
    assert.deepEqual(lastAnswers(null), []);
  });
});

describe("latestCompleted", () => {
  it("is the completed payload of the last answer", () => {
    const p = latestCompleted(
      store,
      "bot:local/shopping-helper[bot_shop1].completed",
    );
    assert.equal(p.botId, "bot_shop1");
    assert.equal(p.botName, "Shopping Helper");
    assert.match(p.output, /Oat milk/);
    assert.equal(p.at, "2026-11-10T08:02:00.000Z");
  });
  it("is null for a gone bot, another event, or no answer", () => {
    assert.equal(latestCompleted(store, "bot:x[bot_gone].completed"), null);
    assert.equal(latestCompleted(store, "bot:x[bot_shop1].failed"), null);
    const empty = { get: () => bot, getRuns: () => [] };
    assert.equal(latestCompleted(empty, "bot:x[bot_shop1].completed"), null);
  });
});

describe("describeAnswers", () => {
  it("gives each answer whole, newest first", () => {
    const text = describeAnswers("Shopping Helper", lastAnswers(runs));
    assert.match(text, /last 3 answers, newest first/);
    assert.match(text, /Answer 1 of 3 · 2026-11-10T08:02:00.000Z/);
    assert.ok(text.indexOf("Oat milk") < text.indexOf("Bananas"));
  });
  it("says to run it once when there's nothing yet", () => {
    assert.match(describeAnswers("Shopping Helper", []), /Run it now/);
  });
});
