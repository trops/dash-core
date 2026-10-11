/**
 * runCost.test.js — one cost rule for bot runs (create-entry PRD CRE-012):
 * API runs in dollars (cache at 0.1× / 1.25× input), Claude Code included in
 * the plan, unknown prices as tokens only.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { runCost, addUsage, totalTokens, normalizeUsage } = require("./runCost");

const SONNET = { input: 3, output: 15 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

describe("runCost", () => {
  it("API key run: input + output at the model's price", () => {
    const c = runCost({
      providerId: "anthropic",
      usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
      pricing: SONNET,
    });
    near(c.usd, 4.5);
    near(c.equivalentUsd, 4.5);
    assert.equal(c.includedInPlan, false);
    assert.equal(c.estimated, false);
  });

  it("cache reads at 0.1× and cache writes at 1.25× the input price", () => {
    const c = runCost({
      providerId: "anthropic",
      usage: { cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 },
      pricing: SONNET,
    });
    near(c.usd, 0.3 + 3.75);
  });

  it("Claude Code: included in the plan — $0, with the API equivalent", () => {
    const c = runCost({
      providerId: "claude-code",
      usage: { inputTokens: 1_000_000 },
      pricing: SONNET,
    });
    assert.deepEqual(c, {
      usd: 0,
      includedInPlan: true,
      estimated: false,
      equivalentUsd: 3,
    });
  });

  it("Claude Code: the SDK's own figure wins as the equivalent", () => {
    const c = runCost({
      providerId: "claude-code",
      usage: { inputTokens: 10, outputTokens: 10, reportedUsd: 0.42 },
      pricing: SONNET,
    });
    assert.equal(c.equivalentUsd, 0.42);
    assert.equal(c.usd, 0);
  });

  it("unknown price: tokens only, estimated", () => {
    assert.deepEqual(
      runCost({ providerId: "openai", usage: { inputTokens: 5 } }),
      { usd: 0, includedInPlan: false, estimated: true, equivalentUsd: null },
    );
  });
});

describe("usage helpers", () => {
  it("addUsage sums every count and is null-safe", () => {
    assert.equal(addUsage(null, null), null);
    assert.deepEqual(
      addUsage(
        { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 },
        { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 4 },
      ),
      {
        inputTokens: 11,
        outputTokens: 22,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
      },
    );
  });

  it("totalTokens counts cache too; normalizeUsage fills gaps", () => {
    assert.equal(
      totalTokens({
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
      }),
      10,
    );
    assert.deepEqual(normalizeUsage({ inputTokens: -5, outputTokens: "x" }), {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });
});
