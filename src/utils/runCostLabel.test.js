import {
  formatMonthCost,
  formatTokens,
  modelLabel,
  runCostLabel,
  runCostShort,
  usageTokens,
} from "./runCostLabel";

describe("runCostLabel — a run's model, tokens and cost (CRE-012)", () => {
  const usage = {
    inputTokens: 12000,
    outputTokens: 2000,
    cacheReadTokens: 230,
  };

  test("API run: model · tokens · dollars", () => {
    const run = {
      model: "claude-sonnet-4-6",
      usage,
      cost: { usd: 0.0612, includedInPlan: false, estimated: false },
    };
    expect(runCostLabel(run)).toBe("Sonnet · 14.2k tokens · $0.06");
    expect(runCostShort(run)).toBe("$0.06");
  });

  test("Claude Code run: included in your plan, no dollars", () => {
    const run = {
      model: "claude-opus-4-8",
      usage,
      cost: {
        usd: 0,
        includedInPlan: true,
        estimated: false,
        equivalentUsd: 0.3,
      },
    };
    expect(runCostLabel(run)).toBe(
      "Opus · 14.2k tokens · included in your plan",
    );
    expect(runCostShort(run)).toBe("14.2k tok");
  });

  test("unknown price: tokens only", () => {
    const run = {
      model: "gpt-x",
      usage,
      cost: { usd: 0, includedInPlan: false, estimated: true },
    };
    expect(runCostLabel(run)).toBe("gpt-x · 14.2k tokens");
  });

  test("an older run with no cost or model shows tokens only", () => {
    expect(
      runCostLabel({ usage: { inputTokens: 900, outputTokens: 50 } }),
    ).toBe("950 tokens");
    expect(runCostShort({})).toBe("");
  });

  test("tiny costs read <$0.01", () => {
    expect(
      runCostShort({
        usage,
        cost: { usd: 0.004, includedInPlan: false, estimated: false },
      }),
    ).toBe("<$0.01");
  });

  test("helpers", () => {
    expect(modelLabel("claude-haiku-4-5")).toBe("Haiku");
    expect(modelLabel(null)).toBeNull();
    expect(formatTokens(2_400_000)).toBe("2.4M");
    expect(usageTokens({ inputTokens: 1, cacheWriteTokens: 2 })).toBe(3);
  });
});

describe("formatMonthCost", () => {
  test("dollars, plan tokens, both, tokens only, none", () => {
    expect(formatMonthCost({ "bot:b": { usd: 1.2 } }, "b")).toBe(
      "$1.20 this month",
    );
    expect(
      formatMonthCost({ "bot:b": { usd: 0, planTokens: 48000 } }, "b"),
    ).toBe("48.0k tokens · included in your plan");
    expect(
      formatMonthCost({ "bot:b": { usd: 1.2, planTokens: 48000 } }, "b"),
    ).toBe("$1.20 + 48.0k plan tokens this month");
    expect(
      formatMonthCost(
        { "bot:b": { usd: 0, inputTokens: 900, outputTokens: 100 } },
        "b",
      ),
    ).toBe("1.0k tokens this month");
    expect(formatMonthCost({}, "b")).toBe("No runs this month");
  });
});
