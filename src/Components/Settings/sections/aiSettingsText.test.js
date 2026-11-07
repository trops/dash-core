import {
  anyOnMostExpensive,
  cheaperDefaults,
  effectiveJobModel,
  monthText,
  perRunText,
  runsText,
  shortModel,
} from "./aiSettingsText";

const MODELS = [
  {
    value: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    tier: "deep",
    pricing: { input: 4, output: 20 },
  },
  {
    value: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    tier: "balanced",
    pricing: { input: 2, output: 10 },
  },
  {
    value: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    tier: "fast",
    pricing: { input: 0.1, output: 0.5 },
  },
  { value: "claude-x", label: "Claude X" },
];

const ai = (defaults = {}) => ({ defaults });

test("a job runs on its default, else what it ran on before", () => {
  expect(effectiveJobModel("bots", ai(), MODELS)).toBe("claude-opus-5-5");
  expect(effectiveJobModel("leads", ai(), MODELS)).toBe("claude-haiku-5-5");
  expect(effectiveJobModel("planner", ai(), MODELS)).toBe("claude-opus-5-5");
  expect(effectiveJobModel("builder", ai(), MODELS)).toBe("claude-sonnet-5-5");
  expect(
    effectiveJobModel(
      "bots",
      ai({ bots: { model: "claude-haiku-5-5" } }),
      MODELS,
    ),
  ).toBe("claude-haiku-5-5");
});

test("cost per run: an estimate from the price list, or nothing", () => {
  expect(perRunText(MODELS, "claude-haiku-5-5")).toBe("≈ $0.0007 a run");
  expect(perRunText(MODELS, "claude-sonnet-5-5")).toBe("≈ $0.014 a run");
  expect(perRunText(MODELS, "claude-opus-5-5", "")).toBe("≈ $0.028");
  expect(perRunText(MODELS, "claude-x")).toBe("");
});

test("cheaper defaults: Haiku for bots and leads, Sonnet for Create", () => {
  const d = cheaperDefaults(MODELS);
  expect(d.bots).toEqual({ model: "claude-haiku-5-5", style: "brief" });
  expect(d.planner).toEqual({ model: "claude-sonnet-5-5", style: "thorough" });
  expect(d.builder).toEqual({ model: "claude-sonnet-5-5", style: "normal" });
  expect(anyOnMostExpensive(ai(), MODELS)).toBe(true);
  expect(anyOnMostExpensive(ai(d), MODELS)).toBe(false);
});

test("labels", () => {
  expect(shortModel(MODELS, "claude-haiku-5-5")).toBe("Haiku 5.5");
  expect(shortModel(MODELS, "unknown-id")).toBe("unknown-id");
  expect(runsText({ schedules: [{ cron: "30 7 * * 0" }] })).toBe(
    "Every Sunday at 7:30 AM",
  );
  expect(runsText({ subscriptions: [{}] })).toBe("When an event arrives");
  expect(runsText({})).toBe("When asked");
  expect(monthText(0.3, 10)).toBe("$0.30 of $10.00");
  expect(monthText(0.3, null)).toBe("$0.30");
});
