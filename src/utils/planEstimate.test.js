import { estimatePlan, describeEstimate, STEP_TOKENS } from "./planEstimate";
import * as rendererPlan from "./teamPlan";

const team = [
  { role: "builder", runsOn: "claude-sonnet-4-6", providerId: "claude-code" },
  { role: "checker", runsOn: "claude-sonnet-4-6", providerId: "claude-code" },
];

describe("estimatePlan (phase 4a, CRE-012 AC1)", () => {
  test("adds the per-step figures by role, plus planning so far", () => {
    const est = estimatePlan(
      {
        pieces: [
          { kind: "widget", source: "new" },
          { kind: "widget", source: "yours" },
          { kind: "layout", source: "new" },
        ],
      },
      { team, planningTokens: 6300 },
    );
    expect(est.roles).toEqual([
      { role: "builder", model: "Sonnet", tokens: 23000 },
      { role: "checker", model: "Sonnet", tokens: 6000 },
    ]);
    expect(est.total).toBe(23000 + 6000 + 6300);
    expect(est.includedInPlan).toBe(true);
    expect(est.usd).toBeNull();
    expect(describeEstimate(est)).toBe(
      "~35.3k tokens — Builder (Sonnet) ~23.0k · Checker (Sonnet) ~6.0k · planning so far 6.3k · included in your plan",
    );
  });

  test("on an API key it gives dollars", () => {
    const est = estimatePlan(
      { pieces: [{ kind: "widget", source: "new" }] },
      { team: team.map((t) => ({ ...t, providerId: "anthropic" })) },
    );
    expect(est.includedInPlan).toBe(false);
    expect(est.usd).toBeCloseTo(26000 * 5.4e-6, 6);
    expect(describeEstimate(est)).toMatch(/about \$0\.14$/);
  });

  test("nothing to build", () => {
    const est = estimatePlan(
      { pieces: [{ kind: "widget", source: "yours" }] },
      { team },
    );
    expect(describeEstimate(est)).toBe(
      "Nothing to build · included in your plan",
    );
    expect(STEP_TOKENS.widget.registry.checker).toBeGreaterThan(0);
  });
});

describe("the renderer's plan checker matches the main process's", () => {
  // eslint-disable-next-line global-require
  const mainPlan = require("../../electron/bots/teamPlan");
  const samples = [
    null,
    { summary: "x", estimate: { build: "?" } },
    {
      summary: "Brief",
      questions: [{ question: "Which calendar?", options: ["Work"] }],
      pieces: [
        {
          kind: "widget",
          name: "Cal",
          source: "registry",
          package: "@a/cal",
          providers: ["google-calendar"],
        },
        { kind: "bot", name: "Digest", source: "new" },
      ],
      beforeBuilding: [{ kind: "install", what: "@a/cal" }],
      access: ["Bots can read Gmail"],
      estimate: { build: "~$1" },
    },
    { summary: "x", pieces: [{ kind: "gadget" }], access: "no", estimate: {} },
    {
      summary: "Ask",
      pieces: [
        {
          kind: "widget",
          name: "Ask",
          source: "new",
          events: ["askClicked"],
          listens: [{ bot: "Ghost", result: "r", handler: "h" }],
        },
        {
          kind: "bot",
          name: "Greeter",
          source: "new",
          on: [
            { widget: "Ask", event: "other" },
            { widget: "Nope", event: "x" },
          ],
        },
      ],
      estimate: { build: "?" },
    },
    // Preview samples (5d): good, and not a list of lines.
    {
      summary: "S",
      pieces: [
        {
          kind: "widget",
          name: "A",
          source: "new",
          sample: ["9:30 Standup", "Unread: 4"],
        },
        { kind: "widget", name: "B", source: "new", sample: "oops" },
        { kind: "widget", name: "C", source: "new", sample: [1, 2] },
      ],
      estimate: { build: "?" },
    },
  ];
  test.each(samples.map((s, i) => [i, s]))("sample %i", (_i, plan) => {
    expect(rendererPlan.validatePlan(plan, { providers: ["gmail"] })).toEqual(
      mainPlan.validatePlan(plan, { providers: ["gmail"] }),
    );
  });
  test("extractPlan", () => {
    const t = 'a <plan>{"summary":"s"}</plan>';
    expect(rendererPlan.extractPlan(t)).toEqual(mainPlan.extractPlan(t));
  });
});
