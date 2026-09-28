/**
 * BotScheduler.test.js
 *
 * Pins schedule registration/firing and catch-up, using a fake Cron so no
 * real timers run.
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const BotScheduler = require("./BotScheduler");

class FakeCron {
  constructor(expr, fn) {
    this.expr = expr;
    this.fn = fn;
    this.stopped = false;
    FakeCron.created.push(this);
  }
  stop() {
    this.stopped = true;
  }
  previousRun() {
    return FakeCron.prev;
  }
  fire() {
    if (this.fn) this.fn();
  }
}
FakeCron.created = [];
FakeCron.prev = null;

beforeEach(() => {
  FakeCron.created = [];
  FakeCron.prev = null;
});

function makeScheduler(runCalls, now = 1000) {
  return new BotScheduler({
    Cron: FakeCron,
    runBot: (botId, opts) => runCalls.push({ botId, ...opts }),
    now: () => now,
  });
}

const bot = (over = {}) => ({
  id: "bot_1",
  schedules: [{ cron: "0 7 * * *", prompt: "digest", catchUp: "once" }],
  ...over,
});

describe("BotScheduler register/fire", () => {
  it("creates one cron job per schedule; firing calls runBot with trigger 'schedule'", () => {
    const calls = [];
    const s = makeScheduler(calls);
    s.register(bot());
    assert.equal(FakeCron.created.length, 1);
    assert.deepEqual(s.list(), ["bot_1"]);

    FakeCron.created[0].fire();
    assert.deepEqual(calls, [
      { botId: "bot_1", prompt: "digest", trigger: "schedule" },
    ]);
  });

  it("register replaces prior jobs (stops the old ones)", () => {
    const s = makeScheduler([]);
    s.register(bot());
    const first = FakeCron.created[0];
    s.register(bot()); // re-register
    assert.equal(first.stopped, true);
    assert.equal(s.list().length, 1);
  });

  it("unregister stops jobs and drops the bot", () => {
    const s = makeScheduler([]);
    s.register(bot());
    s.unregister("bot_1");
    assert.equal(FakeCron.created[0].stopped, true);
    assert.deepEqual(s.list(), []);
  });

  it("skips malformed schedules (no cron string)", () => {
    const s = makeScheduler([]);
    s.register(
      bot({ schedules: [{ prompt: "x" }, { cron: "", prompt: "y" }] }),
    );
    assert.equal(FakeCron.created.length, 0);
    assert.deepEqual(s.list(), []);
  });
});

describe("BotScheduler catch-up", () => {
  it("runs a missed schedule once when its previous fire is after lastRunAt", () => {
    const calls = [];
    const s = makeScheduler(calls, 10_000);
    FakeCron.prev = new Date(5_000); // previous scheduled time
    s.catchUp(bot(), 1_000); // last run before the missed occurrence
    assert.equal(calls.length, 1);
    assert.equal(calls[0].trigger, "catch-up");
    assert.equal(calls[0].prompt, "digest");
  });

  it("does not run when the last run is newer than the previous fire", () => {
    const calls = [];
    const s = makeScheduler(calls, 10_000);
    FakeCron.prev = new Date(5_000);
    s.catchUp(bot(), 8_000); // already ran after the occurrence
    assert.equal(calls.length, 0);
  });

  it("honors the 'skip' catch-up policy", () => {
    const calls = [];
    const s = makeScheduler(calls, 10_000);
    FakeCron.prev = new Date(5_000);
    s.catchUp(
      bot({ schedules: [{ cron: "0 7 * * *", prompt: "d", catchUp: "skip" }] }),
      0,
    );
    assert.equal(calls.length, 0);
  });
});
