/**
 * coalesce.test.js — collapse a burst of calls into one (the "bots changed"
 * broadcast after bulk edits, e.g. a deleted dashboard's team unassigned).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { coalesce } = require("./coalesce");

describe("coalesce", () => {
  it("runs once per burst, on the next tick", () => {
    let calls = 0;
    let tick = null;
    const trigger = coalesce(
      () => calls++,
      (fn) => (tick = fn),
    );
    trigger();
    trigger();
    trigger();
    assert.equal(calls, 0);
    tick();
    assert.equal(calls, 1);
  });

  it("a later burst runs again", () => {
    let calls = 0;
    const ticks = [];
    const trigger = coalesce(
      () => calls++,
      (fn) => ticks.push(fn),
    );
    trigger();
    ticks.shift()();
    trigger();
    trigger();
    assert.equal(ticks.length, 1);
    ticks.shift()();
    assert.equal(calls, 2);
  });

  it("defaults to setImmediate", async () => {
    let calls = 0;
    const trigger = coalesce(() => calls++);
    trigger();
    trigger();
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1);
  });
});
