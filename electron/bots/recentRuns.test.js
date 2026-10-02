/**
 * recentRuns.test.js — the Bot monitor's "Recent" list (bot-teams TEAM-011
 * AC9): the latest runs across every bot, newest first.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { recentRuns } = require("./recentRuns");

const bots = [
  { id: "a", name: "Inbox Watch", workspaceId: "7" },
  { id: "b", name: "CRM Sync", workspaceId: 9 },
  { id: "c", name: "Loose", workspaceId: null },
];
const runsByBot = {
  a: [
    { status: "completed", endedAt: "2026-10-02T09:00:00.000Z", output: "a1" },
    { status: "failed", endedAt: "2026-10-02T12:00:00.000Z", error: "x" },
  ],
  b: [
    { status: "completed", endedAt: "2026-10-02T11:00:00.000Z", output: "b1" },
  ],
  c: [{ status: "completed", at: "2026-10-02T10:00:00.000Z", output: "c1" }],
};
const getRuns = (id) => runsByBot[id] || [];

describe("recentRuns", () => {
  it("merges every bot's runs, newest first, with bot name and dashboard", () => {
    const list = recentRuns({ bots, getRuns, limit: 10 });
    assert.deepEqual(
      list.map((r) => [r.botId, r.run.status]),
      [
        ["a", "failed"],
        ["b", "completed"],
        ["c", "completed"],
        ["a", "completed"],
      ],
    );
    assert.equal(list[0].botName, "Inbox Watch");
    assert.equal(list[0].workspaceId, "7");
    assert.equal(list[1].workspaceId, "9"); // normalized to a string
    assert.equal(list[2].workspaceId, null);
  });

  it("respects the limit (clamped to 1–50)", () => {
    assert.equal(recentRuns({ bots, getRuns, limit: 2 }).length, 2);
    assert.equal(recentRuns({ bots, getRuns, limit: 0 }).length, 1);
    assert.equal(recentRuns({ bots, getRuns, limit: 999 }).length, 4);
  });

  it("skips skip markers and runs without a time", () => {
    const list = recentRuns({
      bots: [{ id: "z", name: "Z" }],
      getRuns: () => [{ skipped: true }, { status: "completed" }],
      limit: 10,
    });
    assert.deepEqual(list, []);
  });

  it("tolerates a bot whose runs can't be read", () => {
    const list = recentRuns({
      bots,
      getRuns: (id) => {
        if (id === "b") throw new Error("boom");
        return runsByBot[id];
      },
      limit: 10,
    });
    assert.equal(list.length, 3);
  });
});
