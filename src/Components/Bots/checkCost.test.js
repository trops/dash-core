import {
  checkCost,
  checkStats,
  reviewerIds,
  roughTime,
  roughUsd,
} from "./checkCost";

// A check's rough cost and time (DASH-127).

describe("roughTime / roughUsd", () => {
  it("rounds to what a person reads at a glance", () => {
    expect(roughTime(500)).toBe("~1 s");
    expect(roughTime(40000)).toBe("~40 s");
    expect(roughTime(125000)).toBe("~2 min");
    expect(roughTime(65 * 60000)).toBe("~1 h 5 min");
    expect(roughTime(120 * 60000)).toBe("~2 h");
    expect(roughTime(NaN)).toBe(null);
    expect(roughUsd(0.049)).toBe("~$0.05");
    expect(roughUsd(0.001)).toBe("<$0.01");
    expect(roughUsd(-1)).toBe(null);
  });
});

describe("checkCost", () => {
  const rule = { kind: "check", check: { kind: "rules" } };
  const builtIn = { kind: "check", check: { kind: "handoff-has" } };
  const command = { kind: "check", check: { kind: "command" } };
  const repo = { kind: "check", check: { kind: "repo" } };
  const ci = { kind: "check", check: { kind: "pr-ci" } };
  const review = { kind: "reviewer", botId: "r" };

  it("rules and built-in checks are free and instant", () => {
    expect(checkCost(rule)).toBe("Free · instant rule");
    expect(checkCost(builtIn)).toBe("Free · instant rule");
  });

  it("a command or repo check has no AI cost, with its last run's time", () => {
    expect(checkCost(command, { ms: 120000 })).toBe("No AI cost · ~2 min");
    expect(checkCost(repo)).toBe("No AI cost · time not known yet");
  });

  it("a bot review costs AI: its recent average, else not known yet", () => {
    expect(checkCost(review, { usd: 0.05 })).toBe("AI · ~$0.05 a run");
    expect(checkCost(review, { usd: 0.05, ms: 60000 })).toBe(
      "AI · ~$0.05 a run, ~1 min",
    );
    expect(checkCost(review)).toBe("AI · cost not known yet");
  });

  it("the PR's CI is free but waits; you approve waits for you", () => {
    expect(checkCost(ci)).toBe("Free · waits for CI");
    expect(checkCost({ kind: "you" })).toBe("Free · waits for you");
  });
});

describe("checkStats", () => {
  const job = (id, createdAt, history) => ({
    id,
    createdAt,
    flow: {
      botId: "w",
      steps: [
        { id: "work", kind: "bot", botId: "w" },
        { id: "c1", kind: "check" },
        { id: "rv", kind: "bot", botId: "r", judgment: true },
      ],
    },
    tasks: [{ history }],
  });
  const goals = [
    job("g1", 1000, [
      { stepId: "work", status: "passed", at: 0 },
      { stepId: "c1", status: "passed", at: 300000 },
    ]),
    job("g2", 2000, [
      { stepId: "work", status: "passed", at: 10000 },
      { stepId: "c1", status: "failed", at: 130000 },
      { by: "you", status: "close", at: 140000 },
    ]),
    // Another bot's job: not counted.
    { ...job("g3", 3000, []), flow: { botId: "x", steps: [] } },
  ];
  const runs = {
    r: [
      { checks: { goalId: "g1", state: "review" }, cost: { usd: 0.04 } },
      {
        checks: { goalId: "g2", state: "review" },
        cost: { usd: 0, equivalentUsd: 0.06 },
      },
      // Its own work, or another bot's job: not counted.
      { checks: { goalId: "g1", state: "checking" }, cost: { usd: 9 } },
      { checks: { goalId: "g3", state: "review" }, cost: { usd: 9 } },
    ],
  };

  it("a step's time is from its last run; a reviewer's cost is its average", () => {
    const s = checkStats(goals, "w", runs);
    expect(s.c1.ms).toBe(120000);
    expect(s.rv.usd).toBeCloseTo(0.05);
  });

  it("nothing known without jobs or runs", () => {
    expect(checkStats([], "w")).toEqual({});
    expect(checkStats(null, "w", null)).toEqual({});
  });

  it("reviewerIds: the bots a bot's checks ask to review", () => {
    expect(
      reviewerIds({
        steps: [
          { kind: "reviewer", botId: "r" },
          { kind: "reviewer", botId: "r" },
          { kind: "you" },
        ],
      }),
    ).toEqual(["r"]);
    expect(reviewerIds(null)).toEqual([]);
  });
});
