/**
 * EventDispatcher.test.js — per-bot cooldown guard (P1: FR-009).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventDispatcher, DEFAULT_COOLDOWN_MS } = require("./EventDispatcher");

function fakeClock(start = 0) {
  let t = start;
  return { nowMs: () => t, advance: (ms) => (t += ms) };
}

describe("EventDispatcher", () => {
  it("allows the first dispatch, blocks within the cooldown window", () => {
    const clock = fakeClock();
    const d = new EventDispatcher({ cooldownMs: 1000, clock });
    assert.equal(d.shouldDispatch("a"), true);
    d.note("a");
    clock.advance(500);
    assert.equal(d.shouldDispatch("a"), false);
    clock.advance(500); // now exactly at the cooldown boundary
    assert.equal(d.shouldDispatch("a"), true);
  });

  it("tracks cooldown per bot independently", () => {
    const clock = fakeClock();
    const d = new EventDispatcher({ cooldownMs: 1000, clock });
    d.note("a");
    assert.equal(d.shouldDispatch("a"), false);
    assert.equal(d.shouldDispatch("b"), true);
  });

  it("defaults to a sane cooldown", () => {
    assert.equal(typeof DEFAULT_COOLDOWN_MS, "number");
    assert.ok(DEFAULT_COOLDOWN_MS > 0);
  });
});
