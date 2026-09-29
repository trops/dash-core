/**
 * BudgetController.test.js
 *
 * Cost math, multi-scope monthly accrual, warn/exceeded thresholds, most-
 * restrictive status, budget override, and monthly keying — all with injected
 * persistence, pricing, and clock (no Electron, deterministic).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const BudgetController = require("./BudgetController");

function memPersistence(initial) {
  let blob = initial
    ? JSON.parse(JSON.stringify(initial))
    : { budgets: {}, spend: {}, overrides: {} };
  return {
    read: () => blob,
    write: (o) => {
      blob = JSON.parse(JSON.stringify(o));
    },
  };
}

const OPUS = { input: 5, output: 25 }; // USD / 1M tokens

function make(overrides = {}) {
  let nowMs = Date.UTC(2026, 8, 15); // 2026-09 (Sept)
  const audits = [];
  const bc = new BudgetController({
    persistence: memPersistence(),
    getPricing:
      overrides.getPricing || ((p, m) => (m === "opus" ? OPUS : null)),
    clock: () => nowMs,
    audit: (e) => audits.push(e),
  });
  return {
    bc,
    audits,
    setNow: (ms) => {
      nowMs = ms;
    },
  };
}

const usage = (i, o) => ({ inputTokens: i, outputTokens: o });

describe("BudgetController.recordUsage — cost", () => {
  it("computes cost from per-model pricing", () => {
    const { bc } = make();
    const r = bc.recordUsage({
      botId: "b1",
      providerId: "anthropic",
      model: "opus",
      usage: usage(1_000_000, 100_000),
    });
    // 1M in * $5/M + 0.1M out * $25/M = 5 + 2.5
    assert.equal(r.cost, 7.5);
    assert.equal(r.estimated, false);
  });

  it("flags estimated (tokens only) when pricing is unknown", () => {
    const { bc } = make();
    const r = bc.recordUsage({
      botId: "b1",
      providerId: "xai",
      model: "grok-unknown",
      usage: usage(1_000_000, 0),
    });
    assert.equal(r.cost, 0);
    assert.equal(r.estimated, true);
    const spend = bc.getSpend();
    assert.equal(spend["bot:b1"].inputTokens, 1_000_000);
  });

  it("accrues to bot, workspace, and global buckets", () => {
    const { bc } = make();
    bc.recordUsage({
      botId: "b1",
      workspaceId: "w1",
      providerId: "anthropic",
      model: "opus",
      usage: usage(1_000_000, 0),
    });
    const spend = bc.getSpend();
    assert.equal(spend["bot:b1"].usd, 5);
    assert.equal(spend["workspace:w1"].usd, 5);
    assert.equal(spend["global"].usd, 5);
  });

  it("accumulates across runs in the same month", () => {
    const { bc } = make();
    const u = {
      botId: "b1",
      providerId: "anthropic",
      model: "opus",
      usage: usage(1_000_000, 0),
    };
    bc.recordUsage(u);
    bc.recordUsage(u);
    assert.equal(bc.getSpend()["bot:b1"].usd, 10);
  });
});

describe("BudgetController.status / thresholds", () => {
  it("reports ok / warn (≥80%) / exceeded (≥100%)", () => {
    const { bc } = make();
    bc.setBudget("bot", "b1", 10);
    const u1 = {
      botId: "b1",
      providerId: "anthropic",
      model: "opus",
      usage: usage(1_000_000, 0),
    };
    // $5 → 50% ok
    bc.recordUsage(u1);
    assert.equal(bc.status("b1").overall, "ok");
    // +$3 → $8 = 80% warn
    bc.recordUsage({ ...u1, usage: usage(600_000, 0) });
    assert.equal(bc.status("b1").overall, "warn");
    // +$2 → $10 = 100% exceeded
    bc.recordUsage({ ...u1, usage: usage(400_000, 0) });
    assert.equal(bc.status("b1").overall, "exceeded");
  });

  it("takes the most-restrictive scope (bot exceeded, global ok → exceeded)", () => {
    const { bc } = make();
    bc.setBudget("bot", "b1", 5);
    bc.setBudget("global", null, 1000);
    bc.recordUsage({
      botId: "b1",
      workspaceId: "w1",
      providerId: "anthropic",
      model: "opus",
      usage: usage(1_000_000, 0),
    });
    const s = bc.status("b1", "w1");
    assert.equal(s.overall, "exceeded");
    assert.ok(s.scopes.find((x) => x.scope === "global").state === "ok");
  });

  it("scopes without a budget are ignored", () => {
    const { bc } = make();
    bc.recordUsage({
      botId: "b1",
      providerId: "anthropic",
      model: "opus",
      usage: usage(9_000_000, 0),
    });
    assert.equal(bc.status("b1").overall, "ok"); // no budget set anywhere
    assert.equal(bc.isOverBudget("b1"), false);
  });
});

describe("BudgetController.isOverBudget + override", () => {
  it("is over budget when a budget is exceeded", () => {
    const { bc } = make();
    bc.setBudget("bot", "b1", 5);
    bc.recordUsage({
      botId: "b1",
      providerId: "anthropic",
      model: "opus",
      usage: usage(2_000_000, 0),
    });
    assert.equal(bc.isOverBudget("b1"), true);
  });

  it("an audited override lets the bot run despite exceeding", () => {
    const { bc, audits } = make();
    bc.setBudget("bot", "b1", 5);
    bc.recordUsage({
      botId: "b1",
      providerId: "anthropic",
      model: "opus",
      usage: usage(2_000_000, 0),
    });
    assert.equal(bc.isOverBudget("b1"), true);
    bc.resumeOverBudget("b1");
    assert.equal(bc.isOverBudget("b1"), false);
    assert.ok(audits.some((a) => a.type === "budget-override"));
  });
});

describe("BudgetController monthly keying", () => {
  it("spend and overrides reset the next month", () => {
    const ctx = make();
    ctx.bc.setBudget("bot", "b1", 5);
    ctx.bc.recordUsage({
      botId: "b1",
      providerId: "anthropic",
      model: "opus",
      usage: usage(2_000_000, 0),
    });
    ctx.bc.resumeOverBudget("b1");
    assert.equal(ctx.bc.isOverBudget("b1"), false); // overridden this month

    ctx.setNow(Date.UTC(2026, 9, 1)); // next month (Oct)
    // Fresh month: no spend → not over budget; override doesn't carry over.
    assert.equal(ctx.bc.getSpend()["bot:b1"], undefined);
    assert.equal(ctx.bc.isOverBudget("b1"), false);
    assert.equal(ctx.bc.status("b1").overall, "ok");
  });
});

describe("BudgetController.setBudget/getBudgets", () => {
  it("sets and clears budgets", () => {
    const { bc } = make();
    bc.setBudget("global", null, 200);
    bc.setBudget("bot", "b1", 10);
    assert.deepEqual(bc.getBudgets(), { global: 200, "bot:b1": 10 });
    bc.setBudget("bot", "b1", null); // clear
    assert.deepEqual(bc.getBudgets(), { global: 200 });
  });
});
