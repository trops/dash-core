/**
 * BotMemory.test.js — scoped, versioned key-value store (P1: FR-010).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { BotMemory } = require("./BotMemory");

function memStore(initial = { scopes: {} }) {
  let blob = initial;
  return {
    read: () => blob,
    write: (o) => {
      blob = o;
    },
    _blob: () => blob,
  };
}

describe("BotMemory", () => {
  it("requires persistence", () => {
    assert.throws(() => new BotMemory({}), /persistence is required/);
  });

  it("set then get round-trips a value", () => {
    const m = new BotMemory({ persistence: memStore() });
    m.set("workspace", "w1", "lastPR", 482);
    assert.equal(m.get("workspace", "w1", "lastPR"), 482);
    assert.equal(m.get("workspace", "w1", "missing"), undefined);
  });

  it("bumps version on overwrite and stamps updatedAt", () => {
    let t = 0;
    const m = new BotMemory({
      persistence: memStore(),
      clock: { now: () => `t${++t}` },
    });
    const first = m.set("workspace", "w1", "k", "a");
    assert.equal(first.version, 1);
    assert.equal(first.updatedAt, "t1");
    const second = m.set("workspace", "w1", "k", "b");
    assert.equal(second.version, 2);
    assert.equal(m.get("workspace", "w1", "k"), "b");
  });

  it("isolates workspace scopes by id, and separates global", () => {
    const m = new BotMemory({ persistence: memStore() });
    m.set("workspace", "w1", "k", "one");
    m.set("workspace", "w2", "k", "two");
    m.set("global", null, "k", "shared");
    assert.equal(m.get("workspace", "w1", "k"), "one");
    assert.equal(m.get("workspace", "w2", "k"), "two");
    assert.equal(m.get("global", "anything", "k"), "shared");
  });

  it("lists keys sorted, filtered by prefix", () => {
    const m = new BotMemory({ persistence: memStore() });
    m.set("workspace", "w1", "pr:1", "a");
    m.set("workspace", "w1", "pr:2", "b");
    m.set("workspace", "w1", "note", "c");
    assert.deepEqual(
      m.list("workspace", "w1").map((e) => e.key),
      ["note", "pr:1", "pr:2"],
    );
    assert.deepEqual(
      m.list("workspace", "w1", "pr:").map((e) => e.key),
      ["pr:1", "pr:2"],
    );
  });

  it("deletes and reports whether anything was removed", () => {
    const m = new BotMemory({ persistence: memStore() });
    m.set("workspace", "w1", "k", "v");
    assert.equal(m.delete("workspace", "w1", "k"), true);
    assert.equal(m.get("workspace", "w1", "k"), undefined);
    assert.equal(m.delete("workspace", "w1", "k"), false);
  });

  it("persists through the injected blob (survives a new instance)", () => {
    const store = memStore();
    new BotMemory({ persistence: store }).set("global", null, "k", "v");
    const reopened = new BotMemory({ persistence: store });
    assert.equal(reopened.get("global", null, "k"), "v");
  });
});
