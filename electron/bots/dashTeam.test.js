/**
 * dashTeam.test.js — the Dash team's roles, models and upkeep (CRE-011).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  ROLES,
  ROLE_IDS,
  isDashTeam,
  dashTeamBot,
  dashTeamDefinition,
  planEnsureDashTeam,
  tierModel,
  modelForRole,
  builtinToolsFor,
  mergeDashTeamSettings,
} = require("./dashTeam");

const teamBot = (role, over = {}) => ({
  id: `b_${role}`,
  ...dashTeamDefinition(role),
  ...over,
});

describe("Dash team roles", () => {
  it("has the Planner, Scout, Builder and Checker", () => {
    assert.deepEqual(ROLE_IDS, ["planner", "scout", "builder", "checker"]);
    for (const r of ROLES) {
      assert.ok(r.instructions.length > 50, r.role);
      assert.ok(r.summary, r.role);
    }
  });

  it("a definition is off every dashboard, idle, on Claude Code", () => {
    const def = dashTeamDefinition("scout");
    assert.equal(def.system, "dash-team");
    assert.equal(def.role, "scout");
    assert.equal(def.ref, "dash/scout");
    assert.equal(def.workspaceId, null);
    assert.equal(def.provider, "claude-code");
    assert.equal(def.model, null);
    assert.deepEqual(def.schedules, []);
    assert.deepEqual(def.subscriptions, []);
    assert.throws(() => dashTeamDefinition("boss"));
  });

  it("isDashTeam / dashTeamBot", () => {
    const bots = [{ id: "x", role: "lead" }, teamBot("planner")];
    assert.equal(isDashTeam(bots[0]), false);
    assert.equal(isDashTeam(bots[1]), true);
    assert.equal(dashTeamBot(bots, "planner").id, "b_planner");
    assert.equal(dashTeamBot(bots, "scout"), null);
  });
});

describe("planEnsureDashTeam", () => {
  it("creates every missing role", () => {
    const plan = planEnsureDashTeam([teamBot("planner")]);
    assert.deepEqual(
      plan.map((p) => [p.action, p.role]),
      [
        ["create", "scout"],
        ["create", "builder"],
        ["create", "checker"],
      ],
    );
  });

  it("leaves a complete team alone, including edited instructions", () => {
    const bots = ROLE_IDS.map((r) => teamBot(r));
    bots[0].instructions = "My own words.";
    assert.deepEqual(planEnsureDashTeam(bots), []);
  });

  it("upgrades instructions still on an earlier generated version", () => {
    const spec = ROLES.find((r) => r.role === "scout");
    spec.history.push("old scout text");
    try {
      const bots = ROLE_IDS.map((r) => teamBot(r));
      bots[1].instructions = "old scout text";
      const plan = planEnsureDashTeam(bots);
      assert.equal(plan.length, 1);
      assert.equal(plan[0].action, "upgrade");
      assert.equal(plan[0].instructions, spec.instructions);
    } finally {
      spec.history.pop();
    }
  });
});

describe("modelForRole", () => {
  it("each role's tier on Claude models", () => {
    assert.equal(tierModel("claude-code", "fast"), "claude-haiku-4-5");
    assert.equal(
      modelForRole(teamBot("planner"), "claude-code", {}),
      "claude-opus-4-8",
    );
    assert.equal(
      modelForRole(teamBot("scout"), "anthropic", {}),
      "claude-haiku-4-5",
    );
    assert.equal(
      modelForRole(teamBot("builder"), "claude-code", {}),
      "claude-sonnet-4-6",
    );
  });

  it("the user's pick for the role and provider wins over the tier", () => {
    const settings = {
      dashTeam: { models: { "claude-code": { scout: "claude-sonnet-4-6" } } },
    };
    assert.equal(
      modelForRole(teamBot("scout"), "claude-code", settings),
      "claude-sonnet-4-6",
    );
    // …only on that provider.
    assert.equal(
      modelForRole(teamBot("scout"), "anthropic", settings),
      "claude-haiku-4-5",
    );
  });

  it("the bot's own model wins over everything", () => {
    assert.equal(
      modelForRole(
        teamBot("scout", { model: "claude-opus-4-7" }),
        "anthropic",
        {},
      ),
      "claude-opus-4-7",
    );
  });

  it("providers with no tier list fall back to their default", () => {
    assert.equal(modelForRole(teamBot("scout"), "openai", {}), null);
  });
});

describe("builtinToolsFor", () => {
  it("only the Builder reads files; the rest get none", () => {
    assert.equal(builtinToolsFor(teamBot("builder")), "read-only");
    assert.equal(builtinToolsFor(teamBot("planner")), "none");
    assert.equal(builtinToolsFor(teamBot("scout")), "none");
    assert.equal(builtinToolsFor(teamBot("checker")), "none");
  });
});

describe("mergeDashTeamSettings", () => {
  it("sets and clears picks, ignoring unknown roles", () => {
    let s = mergeDashTeamSettings(undefined, {
      models: { anthropic: { scout: "claude-sonnet-4-6", boss: "x" } },
    });
    assert.deepEqual(s, {
      models: { anthropic: { scout: "claude-sonnet-4-6" } },
    });
    s = mergeDashTeamSettings(s, {
      models: { "claude-code": { planner: "claude-sonnet-4-6" } },
    });
    assert.equal(s.models.anthropic.scout, "claude-sonnet-4-6");
    s = mergeDashTeamSettings(s, { models: { anthropic: { scout: null } } });
    assert.deepEqual(s.models.anthropic, {});
    assert.equal(s.models["claude-code"].planner, "claude-sonnet-4-6");
  });
});

describe("Dash team instructions (slice 3a)", () => {
  it("the Planner knows its tools and the plan format; the slice 2 text upgrades", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(planner.instructions, /search_library/);
    assert.match(planner.instructions, /ask_role/);
    assert.match(planner.instructions, /<plan><\/plan>/);
    assert.ok(planner.history.length >= 1);
    const bots = ROLE_IDS.map((r) => teamBot(r));
    bots[0].instructions = planner.history[0];
    const plan = planEnsureDashTeam(bots);
    assert.equal(plan[0].action, "upgrade");
    assert.equal(plan[0].role, "planner");
  });
});

describe("Dash team instructions (slice 3b-1)", () => {
  it("the Builder and Checker know their tools; earlier text upgrades", () => {
    const builder = ROLES.find((r) => r.role === "builder");
    const checker = ROLES.find((r) => r.role === "checker");
    assert.match(builder.instructions, /widget_guide/);
    assert.match(builder.instructions, /build_widget/);
    assert.match(builder.instructions, /at most twice/);
    assert.match(checker.instructions, /check_widget/);
    assert.match(checker.instructions, /VERDICT: PASSED/);
    const bots = ROLE_IDS.map((r) => teamBot(r));
    bots[2].instructions = builder.history[0];
    bots[3].instructions = checker.history[0];
    const plan = planEnsureDashTeam(bots);
    assert.deepEqual(
      plan.map((p) => [p.action, p.role]),
      [
        ["upgrade", "builder"],
        ["upgrade", "checker"],
      ],
    );
  });
});

describe("Dash team instructions (slice 3b-2)", () => {
  it("the Builder drafts bots and never says they're created", () => {
    const builder = ROLES.find((r) => r.role === "builder");
    assert.match(builder.instructions, /draft_bot/);
    assert.match(builder.instructions, /never that it's created/);
    assert.ok(builder.history.length >= 2);
  });
});

describe("Dash team instructions (slice 3c)", () => {
  it("the Builder places widgets only after the Checker passes them", () => {
    const builder = ROLES.find((r) => r.role === "builder");
    assert.match(
      builder.instructions,
      /place_widget only after the Checker passed it/,
    );
    assert.equal(builder.history.length, 3);
  });
});

describe("Dash team instructions (slice 4)", () => {
  it("the Scout ends with its matches for Create; earlier text upgrades", () => {
    const scout = ROLES.find((r) => r.role === "scout");
    assert.match(scout.instructions, /<matches><\/matches>/);
    assert.equal(scout.history.length, 2);
    const bots = ROLE_IDS.map((r) => teamBot(r));
    bots[1].instructions = scout.history[0];
    const plan = planEnsureDashTeam(bots);
    assert.deepEqual(
      plan.map((p) => [p.action, p.role]),
      [["upgrade", "scout"]],
    );
  });
});

describe("Dash team instructions (phase 4a)", () => {
  it("the Planner's plan says what bots can and can't do, with tappable questions", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(planner.instructions, /"access": \[string\]/);
    assert.match(planner.instructions, /short tappable options/);
    assert.equal(planner.history.length, 5);
  });
});

describe("Dash team instructions (phase 4d-2)", () => {
  it("the Planner plans bots in full and wires them through widget events", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(
      planner.instructions,
      /"on": \[\{"widget": string, "event": string\}\]/,
    );
    assert.match(planner.instructions, /saved exactly as you plan it/);
    assert.match(
      planner.instructions,
      /Widgets start bots only by publishing an event/,
    );
    assert.match(planner.instructions, /"showResults": boolean/);
    // The 4a text is kept so an unedited Planner upgrades.
    assert.match(planner.history[2], /short tappable options/);
    assert.doesNotMatch(planner.history[2], /showResults/);
  });
});

describe("Dash team instructions (phase 5d)", () => {
  it("the Planner adds made-up sample data for the preview", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(planner.instructions, /"sample": \[string\]/);
    assert.match(planner.instructions, /never the user's real data/);
    // The 4d-2 text is kept so an unedited Planner upgrades.
    assert.match(planner.history[1], /"showResults": boolean/);
    assert.doesNotMatch(planner.history[1], /"sample"/);
  });
});

describe("Dash team instructions (phase 5e)", () => {
  it("the Planner answers questions from bot results, without a plan", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(planner.instructions, /bot_results/);
    assert.match(planner.instructions, /A question gets no plan/);
    assert.match(
      planner.instructions,
      /When the user asks to make or change something, end every answer with the plan/,
    );
    // The 5d text is kept so an unedited Planner upgrades.
    assert.match(planner.history[0], /"sample": \[string\]/);
    assert.doesNotMatch(planner.history[0], /bot_results/);
  });
});
