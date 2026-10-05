/**
 * stopRun.test.js — stopping a bot's run aborts it and clears that bot's
 * pending approvals (denied as "run stopped"), leaving other bots' alone.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { stopBotRun } = require("./stopRun");

function fakes(pending) {
  const denied = [];
  const aborted = [];
  return {
    denied,
    aborted,
    runner: { abort: (id) => (aborted.push(id), id === "b1") },
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

  it("works without an approvals registry", () => {
    const f = fakes([]);
    assert.deepEqual(
      stopBotRun({ runner: f.runner, approvals: null, botId: "b1" }),
      { stopped: true, clearedApprovals: 0 },
    );
  });
});
