/**
 * approvals.test.js
 *
 * Pins the pending-approval registry: create/resolve/deny lifecycle, the
 * public list view, idempotent settling, and auto-deny on timeout (driven
 * through injected timer hooks so the test is deterministic).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const ApprovalRegistry = require("./approvals");

// A controllable timer: create() registers a callback; fire(id) invokes it.
function fakeTimers() {
  const timers = new Map();
  let n = 0;
  return {
    setTimer: (fn) => {
      const h = ++n;
      timers.set(h, fn);
      return h;
    },
    clearTimer: (h) => timers.delete(h),
    fireAll: () => {
      for (const fn of [...timers.values()]) fn();
    },
    pending: () => timers.size,
  };
}

describe("ApprovalRegistry", () => {
  it("create returns an id + promise and lists the pending approval", () => {
    const reg = new ApprovalRegistry();
    const { id, promise } = reg.create({ botId: "bot_1", toolName: "t" });
    assert.ok(id.startsWith("appr_"));
    assert.ok(promise instanceof Promise);
    assert.equal(reg.size, 1);
    const listed = reg.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, id);
    assert.equal(listed[0].request.toolName, "t");
    reg.resolve(id); // settle so the default 24h timer doesn't keep the event loop alive
  });

  it("resolve settles the promise as allowed and clears it from the queue", async () => {
    const reg = new ApprovalRegistry();
    const { id, promise } = reg.create({ botId: "b", toolName: "t" });
    assert.equal(reg.resolve(id), true);
    assert.deepEqual(await promise, { allow: true });
    assert.equal(reg.size, 0);
    assert.equal(reg.get(id), null);
  });

  it("deny settles the promise as denied with a reason", async () => {
    const reg = new ApprovalRegistry();
    const { id, promise } = reg.create({ botId: "b", toolName: "t" });
    reg.deny(id, "user said no");
    assert.deepEqual(await promise, { allow: false, reason: "user said no" });
    assert.equal(reg.size, 0);
  });

  it("resolve/deny on an unknown or already-settled id is a no-op", async () => {
    const reg = new ApprovalRegistry();
    const { id, promise } = reg.create({ botId: "b", toolName: "t" });
    assert.equal(reg.resolve(id), true);
    assert.equal(reg.resolve(id), false); // already settled
    assert.equal(reg.deny("appr_nope"), false); // unknown
    assert.deepEqual(await promise, { allow: true }); // first decision stands
  });

  it("auto-denies on timeout and drops the approval from the queue", async () => {
    const timers = fakeTimers();
    const reg = new ApprovalRegistry({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const { id, promise } = reg.create({ botId: "b", toolName: "t" });
    assert.equal(reg.size, 1);
    timers.fireAll(); // simulate the timeout elapsing
    const decision = await promise;
    assert.equal(decision.allow, false);
    assert.equal(decision.timedOut, true);
    assert.equal(reg.size, 0);
    // A late resolve after timeout does nothing.
    assert.equal(reg.resolve(id), false);
  });

  it("clears the timeout timer when settled early", async () => {
    const timers = fakeTimers();
    const reg = new ApprovalRegistry({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const { id, promise } = reg.create({ botId: "b", toolName: "t" });
    assert.equal(timers.pending(), 1);
    reg.resolve(id);
    await promise;
    assert.equal(timers.pending(), 0); // timer cleared, no leak
  });
});
