/**
 * pausedQueue.test.js — events kept for a paused bot (US-011 AC8).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { PausedQueue, MAX_PER_BOT, drainBot } = require("./pausedQueue");

function clock() {
  let t = 0;
  return () => new Date(Date.UTC(2026, 9, 14, 0, 0, t++)).toISOString();
}

describe("PausedQueue", () => {
  it("keeps the latest event per trigger and counts what arrived", () => {
    const q = new PausedQueue({ now: clock() });
    q.add("b1", "Clock.tick", { event: { n: 1 }, label: "Clock · tick" });
    q.add("b1", "Clock.tick", { event: { n: 2 } });
    assert.equal(q.count("b1"), 1);
    const [item] = q.take("b1");
    assert.deepEqual(item.event, { n: 2 });
    assert.equal(item.label, "Clock · tick");
    assert.equal(item.received, 2);
    assert.equal(q.count("b1"), 0);
  });

  it("hands triggers back oldest first", () => {
    const q = new PausedQueue({ now: clock() });
    q.add("b1", "A", { event: { a: 1 } });
    q.add("b1", "B", { event: { b: 1 } });
    q.add("b1", "A", { event: { a: 2 } }); // newer data, same place in line
    assert.deepEqual(
      q.take("b1").map((i) => [i.key, i.event]),
      [
        ["A", { a: 2 }],
        ["B", { b: 1 }],
      ],
    );
  });

  it("counts per bot, and clears one bot", () => {
    const q = new PausedQueue({ now: clock() });
    q.add("b1", "A", { event: {} });
    q.add("b2", "A", { event: {} });
    q.add("b2", "B", { event: {} });
    assert.deepEqual(q.counts(), { b1: 1, b2: 2 });
    assert.deepEqual(q.botIds().sort(), ["b1", "b2"]);
    q.clear("b2");
    assert.deepEqual(q.counts(), { b1: 1 });
  });

  it("putBack restores what didn't run, without overwriting newer events", () => {
    const q = new PausedQueue({ now: clock() });
    q.add("b1", "A", { event: { a: 1 } });
    q.add("b1", "B", { event: { b: 1 } });
    const items = q.take("b1");
    q.add("b1", "B", { event: { b: 2 } }); // arrived meanwhile
    q.putBack("b1", items);
    const back = Object.fromEntries(q.take("b1").map((i) => [i.key, i.event]));
    assert.deepEqual(back, { A: { a: 1 }, B: { b: 2 } });
  });

  it("survives a restart through its persistence pair", () => {
    let blob = null;
    const persistence = {
      load: () => blob,
      save: (o) => (blob = JSON.parse(JSON.stringify(o))),
    };
    const q1 = new PausedQueue({ persistence, now: clock() });
    q1.add("b1", "A", { event: { a: 1 } });
    const q2 = new PausedQueue({ persistence, now: clock() });
    assert.equal(q2.count("b1"), 1);
    q2.take("b1");
    assert.deepEqual(new PausedQueue({ persistence }).counts(), {});
  });

  it("caps the number of distinct triggers a bot can pile up", () => {
    const q = new PausedQueue({ now: clock() });
    for (let i = 0; i < MAX_PER_BOT + 5; i++)
      q.add("b1", `E${i}`, { event: {} });
    assert.equal(q.count("b1"), MAX_PER_BOT);
    // A trigger already waiting still updates.
    q.add("b1", "E0", { event: { fresh: true } });
    assert.deepEqual(q.take("b1")[0].event, { fresh: true });
  });

  it("a broken saved file starts empty", () => {
    const q = new PausedQueue({
      persistence: {
        load: () => {
          throw new Error("bad json");
        },
        save: () => {},
      },
    });
    assert.deepEqual(q.counts(), {});
  });
});

describe("drainBot — a resumed bot runs what waited", () => {
  it("runs each waiting event in order and empties the queue", async () => {
    const q = new PausedQueue({ now: clock() });
    q.add("b1", "A", { event: { a: 1 } });
    q.add("b1", "B", { event: { b: 1 } });
    const ran = [];
    const n = await drainBot({
      queue: q,
      botId: "b1",
      isHeld: () => false,
      runOne: async (item) => ran.push(item.key),
    });
    assert.equal(n, 2);
    assert.deepEqual(ran, ["A", "B"]);
    assert.equal(q.count("b1"), 0);
  });

  it("does nothing while the bot is still held", async () => {
    const q = new PausedQueue({ now: clock() });
    q.add("b1", "A", { event: {} });
    const n = await drainBot({
      queue: q,
      botId: "b1",
      isHeld: () => true,
      runOne: async () => {},
    });
    assert.equal(n, 0);
    assert.equal(q.count("b1"), 1);
  });

  it("puts the rest back when the bot is paused again partway", async () => {
    const q = new PausedQueue({ now: clock() });
    q.add("b1", "A", { event: {} });
    q.add("b1", "B", { event: {} });
    let held = false;
    const n = await drainBot({
      queue: q,
      botId: "b1",
      isHeld: () => held,
      runOne: async () => {
        held = true;
      },
    });
    assert.equal(n, 1);
    assert.deepEqual(
      q.take("b1").map((i) => i.key),
      ["B"],
    );
  });

  it("one failing run doesn't stop the others", async () => {
    const q = new PausedQueue({ now: clock() });
    q.add("b1", "A", { event: {} });
    q.add("b1", "B", { event: {} });
    const ran = [];
    await drainBot({
      queue: q,
      botId: "b1",
      isHeld: () => false,
      runOne: async (item) => {
        ran.push(item.key);
        if (item.key === "A") throw new Error("boom");
      },
    });
    assert.deepEqual(ran, ["A", "B"]);
  });
});
