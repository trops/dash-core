/**
 * stopRun.test.js — stopping a bot's run aborts it and clears that bot's
 * pending approvals (denied as "run stopped"), leaving other bots' alone.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { stopBotRun, whenIdle, interruptAllRuns } = require("./stopRun");

function fakes(pending) {
  const denied = [];
  const aborted = [];
  const reasons = [];
  return {
    denied,
    aborted,
    reasons,
    runner: {
      abort(id, reason) {
        aborted.push(id);
        reasons.push(reason);
        return id === "b1";
      },
    },
    approvals: {
      list: () => pending,
      deny: (id, reason) => (denied.push({ id, reason }), true),
    },
  };
}

describe("stopBotRun", () => {
  it("aborts the run and denies only that bot's pending approvals", () => {
    const f = fakes([
      { id: "a1", request: { botId: "b1", toolName: "get-current-time" } },
      { id: "a2", request: { botId: "b2", toolName: "write_file" } },
      { id: "a3", request: { botId: "b1", toolName: "list-events" } },
    ]);
    const r = stopBotRun({
      runner: f.runner,
      approvals: f.approvals,
      botId: "b1",
    });
    assert.deepEqual(r, { stopped: true, clearedApprovals: 2 });
    assert.deepEqual(f.aborted, ["b1"]);
    assert.deepEqual(f.denied, [
      { id: "a1", reason: "run stopped" },
      { id: "a3", reason: "run stopped" },
    ]);
  });

  it("still clears a stuck approval when no run is in flight", () => {
    const f = fakes([{ id: "a9", request: { botId: "b7" } }]);
    const r = stopBotRun({
      runner: f.runner,
      approvals: f.approvals,
      botId: "b7",
    });
    assert.deepEqual(r, { stopped: false, clearedApprovals: 1 });
  });

  it("passes the quit reason on and says Dash quit (US-018 AC6)", () => {
    const f = fakes([{ id: "a1", request: { botId: "b1" } }]);
    stopBotRun({
      runner: f.runner,
      approvals: f.approvals,
      botId: "b1",
      reason: "quit",
    });
    assert.deepEqual(f.reasons, ["quit"]);
    assert.deepEqual(f.denied, [{ id: "a1", reason: "Dash quit" }]);
  });

  it("works without an approvals registry", () => {
    const f = fakes([]);
    assert.deepEqual(
      stopBotRun({ runner: f.runner, approvals: null, botId: "b1" }),
      { stopped: true, clearedApprovals: 0 },
    );
  });
});

// A runner whose runs finish a few ms after they're aborted.
function slowRunner(ids, { finishes = true } = {}) {
  const active = new Set(ids);
  const reasons = {};
  return {
    reasons,
    listActive: () => [...active],
    abort(id, reason) {
      if (!active.has(id)) return false;
      reasons[id] = reason;
      if (finishes) setTimeout(() => active.delete(id), 15);
      return true;
    },
  };
}

describe("interruptAllRuns (US-018 AC6)", () => {
  it("stops every run as quit and waits for their records", async () => {
    const runner = slowRunner(["b1", "b2"]);
    const r = await interruptAllRuns({ runner, approvals: null, pollMs: 5 });
    assert.deepEqual(r, { interrupted: 2, unfinished: 0 });
    assert.deepEqual(runner.reasons, { b1: "quit", b2: "quit" });
  });

  it("gives up after the timeout when a run won't end", async () => {
    const runner = slowRunner(["b1"], { finishes: false });
    const r = await interruptAllRuns({
      runner,
      approvals: null,
      timeoutMs: 30,
      pollMs: 5,
    });
    assert.deepEqual(r, { interrupted: 1, unfinished: 1 });
  });

  it("does nothing when no bot is running", async () => {
    const r = await interruptAllRuns({
      runner: slowRunner([]),
      approvals: null,
    });
    assert.deepEqual(r, { interrupted: 0, unfinished: 0 });
  });
});

describe("whenIdle", () => {
  it("resolves true once the runs finish on their own", async () => {
    const active = new Set(["b1"]);
    setTimeout(() => active.delete("b1"), 20);
    const idle = await whenIdle({
      runner: { listActive: () => [...active] },
      pollMs: 5,
    });
    assert.equal(idle, true);
  });

  it("resolves false on timeout", async () => {
    const idle = await whenIdle({
      runner: { listActive: () => ["b1"] },
      timeoutMs: 20,
      pollMs: 5,
    });
    assert.equal(idle, false);
  });
});
