/**
 * spending.test.js — this month's spending for the Spending view and budget
 * fields (bot-factory US-019 AC2/AC5).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { summarizeSpending, stateOf } = require("./spending");

const spend = {
  "bot:a": { usd: 4.5, inputTokens: 1000, outputTokens: 500 },
  "bot:b": {
    usd: 0,
    inputTokens: 20000,
    outputTokens: 1000,
    planTokens: 21000,
  },
  "workspace:7": { usd: 4.5, inputTokens: 1000, outputTokens: 500 },
  global: {
    usd: 4.5,
    inputTokens: 21000,
    outputTokens: 1500,
    planTokens: 21000,
  },
  "provider:anthropic": { usd: 4.5, inputTokens: 1000, outputTokens: 500 },
  "provider:claude-code": {
    usd: 0,
    inputTokens: 20000,
    outputTokens: 1000,
    planTokens: 21000,
  },
};
const bots = [
  { id: "a", name: "Inbox Sorter", workspaceId: 7 },
  { id: "b", name: "Digest", workspaceId: null },
  { id: "c", name: "Quiet", workspaceId: 9 },
];
const workspaces = [
  { id: 7, name: "Morning Brief" },
  { id: 9, name: "Slack Pack" },
  { id: 11, name: "Empty" },
];

describe("summarizeSpending", () => {
  it("bots, dashboards with spending or a limit, providers, overall", () => {
    const s = summarizeSpending({
      month: "2026-10",
      spend,
      budgets: { "bot:a": 5, "workspace:9": 20, global: 50 },
      bots,
      workspaces,
      isOver: (id) => id === "zzz",
    });
    assert.equal(s.month, "2026-10");
    assert.deepEqual(
      s.bots.map((b) => [b.name, b.usd, b.budget, b.state]),
      [
        ["Inbox Sorter", 4.5, 5, "warn"],
        ["Digest", 0, null, "ok"],
        ["Quiet", 0, null, "ok"],
      ],
    );
    assert.equal(s.bots[1].planTokens, 21000);
    assert.equal(s.bots[0].tokens, 1500);
    assert.equal(s.bots[0].workspaceId, "7");
    // Slack Pack has a limit (no spending yet); Empty has neither.
    assert.deepEqual(
      s.dashboards.map((d) => [d.name, d.usd, d.budget]),
      [
        ["Morning Brief", 4.5, null],
        ["Slack Pack", 0, 20],
      ],
    );
    assert.deepEqual(
      s.providers.map((p) => [p.id, p.usd, p.planTokens]),
      [
        ["anthropic", 4.5, 0],
        ["claude-code", 0, 21000],
      ],
    );
    assert.deepEqual(
      [s.overall.usd, s.overall.budget, s.overall.state],
      [4.5, 50, "ok"],
    );
  });

  it("nothing spent: empty rows, no limits", () => {
    const s = summarizeSpending({ month: "2026-10", bots: [], workspaces: [] });
    assert.deepEqual(s.bots, []);
    assert.deepEqual(s.dashboards, []);
    assert.deepEqual(s.providers, []);
    assert.equal(s.overall.budget, null);
  });

  it("stateOf: ok under 80%, warn at 80%, exceeded at 100%, ok with no limit", () => {
    assert.equal(stateOf(1, 5), "ok");
    assert.equal(stateOf(4, 5), "warn");
    assert.equal(stateOf(5, 5), "exceeded");
    assert.equal(stateOf(99, null), "ok");
  });
});
