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
  it("has the Planner, Scout, Builder, Checker and their lead", () => {
    assert.deepEqual(ROLE_IDS, [
      "planner",
      "scout",
      "builder",
      "checker",
      "dashlead",
    ]);
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
        ["create", "dashlead"],
      ],
    );
  });

  it("the Dash Lead (lead-workspace release 1): the team's contact, on the fast tier", () => {
    const def = dashTeamDefinition("dashlead");
    assert.equal(def.name, "Dash Lead");
    assert.equal(def.ref, "dash/dashlead");
    // Never a dashboard lead: those are role "lead" on a dashboard.
    assert.notEqual(def.role, "lead");
    assert.equal(def.workspaceId, null);
    assert.equal(
      modelForRole(teamBot("dashlead"), "claude-code", {}),
      "claude-haiku-5-5",
    );
    assert.match(def.instructions, /ask_role/);
    // Release 3a: the plan shows beside its answer, to approve or change —
    // no more sending the user to Create.
    assert.match(def.instructions, /approve it or change it right there/);
    assert.doesNotMatch(def.instructions, /open Create in the left menu/);
  });

  it("a Dash Lead still on release 1's or 3a's words upgrades; edited ones stay", () => {
    const spec = ROLES.find((r) => r.role === "dashlead");
    assert.equal(spec.history.length, 3);
    assert.match(spec.history[2], /open Create in the left menu/);
    // 3a's could say it updated the plan when the Planner sent none.
    assert.doesNotMatch(spec.history[1], /still as it was/);
    assert.match(spec.instructions, /the plan is still as it was/);
    const was3a = { ...teamBot("dashlead"), instructions: spec.history[1] };
    assert.equal(
      planEnsureDashTeam([
        ...ROLE_IDS.filter((r) => r !== "dashlead").map((r) => teamBot(r)),
        was3a,
      ]).length,
      1,
    );
    const old = { ...teamBot("dashlead"), instructions: spec.history[2] };
    const plan = planEnsureDashTeam([
      ...ROLE_IDS.filter((r) => r !== "dashlead").map((r) => teamBot(r)),
      old,
    ]);
    assert.equal(plan.length, 1);
    assert.match(
      JSON.stringify(plan[0]),
      /approve it or change it right there/,
    );
    const edited = { ...old, instructions: "My own words." };
    assert.deepEqual(
      planEnsureDashTeam([
        ...ROLE_IDS.filter((r) => r !== "dashlead").map((r) => teamBot(r)),
        edited,
      ]),
      [],
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
    assert.equal(tierModel("claude-code", "fast"), "claude-haiku-5-5");
    assert.equal(
      modelForRole(teamBot("planner"), "claude-code", {}),
      "claude-opus-5-5",
    );
    assert.equal(
      modelForRole(teamBot("scout"), "anthropic", {}),
      "claude-haiku-5-5",
    );
    assert.equal(
      modelForRole(teamBot("builder"), "claude-code", {}),
      "claude-sonnet-5-5",
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
      "claude-haiku-5-5",
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
    bots[0].instructions = planner.history[5];
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
    bots[2].instructions = builder.history[1];
    bots[3].instructions = checker.history[1];
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
  it("the Builder builds widgets; Dash saves the plan's bots (2c-2)", () => {
    const builder = ROLES.find((r) => r.role === "builder");
    assert.doesNotMatch(builder.instructions, /draft_bot/);
    assert.match(
      builder.instructions,
      /Bots in a plan are saved by Dash itself/,
    );
    assert.ok(builder.history.length >= 2);
  });
});

describe("Dash team instructions (slice 3c)", () => {
  it("the Builder places widgets only after the Checker passes them", () => {
    const builder = ROLES.find((r) => r.role === "builder");
    // Phase 1b: build_widget writes a draft; place_widget installs a draft
    // the Checker passed.
    assert.match(
      builder.instructions,
      /place_widget once the Checker passed it/,
    );
    assert.match(
      builder.instructions,
      /nothing is installed until the Checker passes it/,
    );
    assert.equal(builder.history.length, 6);
  });
});

describe("Dash team instructions (slice 4)", () => {
  it("the Scout ends with its matches for Create; earlier text upgrades", () => {
    const scout = ROLES.find((r) => r.role === "scout");
    assert.match(scout.instructions, /<matches><\/matches>/);
    assert.equal(scout.history.length, 3);
    const bots = ROLE_IDS.map((r) => teamBot(r));
    bots[1].instructions = scout.history[1];
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
    assert.equal(planner.history.length, 19);
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
    assert.match(planner.history[10], /short tappable options/);
    assert.doesNotMatch(planner.history[10], /showResults/);
  });
});

describe("Dash team instructions (phase 5d)", () => {
  it("the Planner adds made-up sample data for the preview", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(planner.instructions, /"sample": \[string\]/);
    assert.match(planner.instructions, /never the user's real data/);
    // The 4d-2 text is kept so an unedited Planner upgrades.
    assert.match(planner.history[9], /"showResults": boolean/);
    assert.doesNotMatch(planner.history[9], /"sample"/);
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
    assert.match(planner.history[8], /"sample": \[string\]/);
    assert.doesNotMatch(planner.history[8], /bot_results/);
  });
});

describe("Dash team instructions (screen audit: typed answers)", () => {
  it("a question only the user can type gets no options, never an 'I'll type it' option", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(planner.instructions, /give that question no options/);
    assert.match(
      planner.instructions,
      /never offer options like "I'll type it"/,
    );
    // The 5e-1 text is kept so an unedited Planner upgrades.
    assert.match(planner.history[7], /bot_results/);
    assert.doesNotMatch(planner.history[7], /give that question no options/);
  });
});

describe("Dash team instructions (5e-2b: changing a dashboard you have)", () => {
  it("the Planner targets a dashboard by id, applies saved themes, and leaves edits to Edit", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(
      planner.instructions,
      /"dashboard": \{"id": string, "name": string\}/,
    );
    assert.match(
      planner.instructions,
      /"widget" \| "bot" \| "layout" \| "theme"/,
    );
    assert.match(planner.instructions, /a name from list_themes/);
    assert.match(planner.instructions, /has no layout piece/);
    assert.match(planner.instructions, /Removing, moving or resizing widgets/);
    assert.match(planner.instructions, /ask which/);
    // The text before this is upgraded.
    assert.match(planner.history[6], /give that question no options/);
    assert.doesNotMatch(planner.history[6], /list_themes/);
  });
});

describe("Dash team instructions — which widget of a package (Create build fixes)", () => {
  const { ROLES } = require("./dashTeam");
  const planner = ROLES.find((r) => r.role === "planner");
  it("the Planner names the component for a package with several widgets", () => {
    assert.match(planner.instructions, /"component": string/);
    assert.match(
      planner.instructions,
      /when its package has several widgets, component — the component name as search_library gave it/,
    );
  });
  it("the earlier Planner text upgrades", () => {
    assert.ok(
      planner.history.some(
        (h) =>
          h.includes("Reusing beats building") &&
          !h.includes('"component": string'),
      ),
    );
  });
});

describe("Dash team instructions — pages, connections and answers (Create build fixes 2)", () => {
  const { ROLES } = require("./dashTeam");
  const planner = ROLES.find((r) => r.role === "planner");
  it("the plan can carry pages, a widget's connection and its settings", () => {
    assert.match(
      planner.instructions,
      /"pages": \[\{"name": string, "widgets": \[string\], "grid": \{/,
    );
    assert.match(planner.instructions, /"provider": \{"<type>": string\}/);
    assert.match(
      planner.instructions,
      /"settings": \{"<setting>": string \| number \| boolean\}/,
    );
  });
  it("answers go into the pieces and answered questions are dropped", () => {
    assert.match(
      planner.instructions,
      /the connection name list_providers gives/,
    );
    assert.match(
      planner.instructions,
      /setting names in the widget's \.dash\.js userConfig \(read_widget\)/,
    );
    assert.match(
      planner.instructions,
      /Once a question is answered, leave it out of questions/,
    );
  });
  it("the layout is named like the dashboard", () => {
    assert.match(planner.instructions, /never "… layout"/);
  });
  it("the earlier Planner text upgrades", () => {
    assert.match(planner.history[4], /"component": string/);
    assert.doesNotMatch(planner.history[4], /"pages"/);
  });
});

describe("Dash team instructions (Create build fixes 3)", () => {
  it("the Checker judges against the plan and fails a widget that asks for keys", () => {
    const checker = ROLES.find((r) => r.role === "checker");
    assert.match(checker.instructions, /the plan's checks/);
    assert.match(
      checker.instructions,
      /asks the user for API keys or calls the service with fetch/,
    );
    assert.match(checker.instructions, /must-fix/);
    assert.match(checker.instructions, /installed only if you pass it/);
    assert.equal(checker.history.length, 5);
    const bots = ROLE_IDS.map((r) => teamBot(r));
    bots[3].instructions = checker.history[1];
    const plan = planEnsureDashTeam(bots);
    assert.deepEqual(
      plan.map((p) => [p.action, p.role]),
      [["upgrade", "checker"]],
    );
  });
});

describe("Dash team instructions (plan grids)", () => {
  it("the Planner puts positions in the page's grid, not in notes", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(planner.instructions, /"grid": \{"cols": number/);
    assert.match(planner.instructions, /colSpan/);
    assert.match(planner.instructions, /never only in notes/);
    assert.match(planner.instructions, /one filter per row/);
    const bots = ROLE_IDS.map((r) => teamBot(r));
    bots[0].instructions = planner.history[2];
    const plan = planEnsureDashTeam(bots);
    assert.deepEqual(
      plan.map((p) => [p.action, p.role]),
      [["upgrade", "planner"]],
    );
  });
});

describe("Dash team instructions (dashboards can be apps)", () => {
  it("the Planner reuses what fits the experience and offers one new widget for an app-like request", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(planner.instructions, /A dashboard can be a whole small app/);
    assert.match(
      planner.instructions,
      /reuse a widget when it fits the experience the user described, not because it exists/,
    );
    assert.match(planner.instructions, /one new widget that does it all/);
    assert.match(planner.instructions, /assemble existing widgets/);
    assert.doesNotMatch(
      planner.instructions,
      /Before planning anything new, find what exists/,
    );
    // The grid-only text a dev build ran upgrades, as does the text before
    // plan grids.
    assert.match(planner.history[2], /"grid": \{"cols"/);
    assert.doesNotMatch(
      planner.history[2],
      /A dashboard can be a whole small app/,
    );
    assert.doesNotMatch(planner.history[3], /"grid"/);
    for (const old of [planner.history[2], planner.history[3]]) {
      const bots = ROLE_IDS.map((r) => teamBot(r));
      bots[0].instructions = old;
      assert.deepEqual(
        planEnsureDashTeam(bots).map((p) => [p.action, p.role]),
        [["upgrade", "planner"]],
      );
    }
  });
});

describe("Dash team instructions (bot results cards are the user's call)", () => {
  it("the Planner asks whether to show bot results on the dashboard, unless the user said", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(
      planner.instructions,
      /ask whether to show each bot's results on the dashboard/,
    );
    assert.match(planner.instructions, /a results card per bot/);
    assert.match(planner.instructions, /keep the dashboard empty/);
    assert.match(planner.instructions, /unless the user already said/);
    assert.match(planner.instructions, /a team of bots needs no widgets/i);
    assert.doesNotMatch(
      planner.history[1],
      /ask whether to show each bot's results/,
    );
    assert.match(planner.history[1], /A dashboard can be a whole small app/);
    const bots = ROLE_IDS.map((r) => teamBot(r));
    bots[0].instructions = planner.history[1];
    assert.deepEqual(
      planEnsureDashTeam(bots).map((p) => [p.action, p.role]),
      [["upgrade", "planner"]],
    );
  });
});

describe("Dash team instructions (consolidation Phase 3: a change to one widget)", () => {
  const role = (r) => ROLES.find((x) => x.role === r);
  it("the Planner plans that one widget, saying what it adds and keeps", () => {
    const planner = role("planner");
    assert.match(planner.instructions, /a change to one widget the user has/);
    assert.match(
      planner.instructions,
      /plan exactly that one widget and nothing else/,
    );
    assert.match(planner.instructions, /"adds": string, "keeps": \[string\]/);
    assert.match(
      planner.instructions,
      /ask first: other dashboards may use it/,
    );
    assert.doesNotMatch(
      planner.history[0],
      /a change to one widget the user has/,
    );
  });
  it("the Scout says what a widget does now, without matches", () => {
    const scout = role("scout");
    assert.match(scout.instructions, /what one widget does now/);
    assert.match(scout.instructions, /Don't search or list matches then/);
    assert.doesNotMatch(scout.history[0], /what one widget does now/);
  });
  it("the Builder changes any widget the user has, held to that widget", () => {
    const builder = role("builder");
    assert.match(builder.instructions, /To change a widget the user has/);
    assert.match(builder.instructions, /build_widget builds only that widget/);
    assert.doesNotMatch(builder.instructions, /the AI built earlier/);
    assert.match(builder.history[0], /the AI built earlier/);
  });
  it("the Checker fails a change that lost a setting, provider or event", () => {
    const checker = role("checker");
    assert.match(checker.instructions, /lost a setting, provider or event/);
    assert.doesNotMatch(checker.history[0], /lost a setting/);
  });
  it("the text before Phase 3 upgrades, for every role", () => {
    // The working roles (the Dash Lead came after Phase 3).
    const roles = ROLE_IDS.filter((r) => r !== "dashlead");
    const bots = roles.map((r) =>
      teamBot(r, { instructions: role(r).history[0] }),
    );
    bots.push(
      teamBot("dashlead", { instructions: role("dashlead").instructions }),
    );
    assert.deepEqual(
      planEnsureDashTeam(bots).map((p) => [p.action, p.role]),
      roles.map((r) => ["upgrade", r]),
    );
  });
});

describe("Dash team instructions (design guide)", () => {
  const role = (r) => ROLES.find((x) => x.role === r);
  it("the Planner lays dashboards out by the guide's layout rules", () => {
    const planner = role("planner");
    assert.match(planner.instructions, /one main area/);
    assert.match(planner.instructions, /each widget is its own panel/);
    // (the latest three are release 6c's and the theme round's, which
    // already had the rules)
    const before = planner.history[planner.history.length - 6];
    assert.doesNotMatch(before, /one main area/);
    assert.match(before, /<plan><\/plan>/);
  });
  it("the Checker fails hard-coded colors", () => {
    const checker = role("checker");
    assert.match(checker.instructions, /hard-coded color/);
    assert.match(checker.instructions, /useDashTokens/);
    assert.doesNotMatch(
      checker.history[checker.history.length - 1],
      /hard-coded color/,
    );
  });
  it("teams on the text before the guide upgrade", () => {
    const bots = ROLE_IDS.map((r) => {
      const h = role(r).history;
      return teamBot(r, { instructions: h[h.length - 1] });
    });
    const plan = planEnsureDashTeam(bots);
    for (const r of ["planner", "checker"]) {
      const p = plan.find((x) => x.role === r);
      assert.equal(p && p.action, "upgrade", r);
      assert.equal(p.instructions, role(r).instructions);
    }
  });
});

describe("Dash team instructions (lead-workspace 6c: no Create window)", () => {
  it("no Create in the text; the text before upgrades", () => {
    const planner = ROLES.find((x) => x.role === "planner");
    assert.doesNotMatch(planner.instructions, /in Create/);
    const before = planner.history[planner.history.length - 5];
    assert.match(before, /choose Theme in Create/);
  });
});

describe("Dash team instructions (lead-workspace theme round)", () => {
  it("the Planner plans a new theme from four colors; the text before upgrades", () => {
    const planner = ROLES.find((x) => x.role === "planner");
    assert.match(
      planner.instructions,
      /"source": "new", "colors": \{"primary"/,
    );
    assert.match(planner.instructions, /neutral is a low-saturation/);
    assert.match(planner.instructions, /theme editor on the Themes page/);
    assert.doesNotMatch(
      planner.instructions,
      /use New Theme on the Themes page/,
    );
    const before = planner.history[planner.history.length - 4];
    assert.match(before, /use New Theme on the Themes page/);
    assert.notEqual(before, planner.instructions);
  });
});

describe("Dash team instructions (theme round: color names)", () => {
  it("the Planner names each color; the text before upgrades", () => {
    const planner = ROLES.find((x) => x.role === "planner");
    assert.match(
      planner.instructions,
      /"colorNames": \{"primary": a one- or two-word name/,
    );
    const before = planner.history[planner.history.length - 3];
    assert.match(before, /"source": "new", "colors"/);
    assert.doesNotMatch(before, /colorNames/);
  });
});

describe("Dash team instructions (theme change round)", () => {
  it("the Planner plans a change to a saved theme; the text before upgrades", () => {
    const planner = ROLES.find((x) => x.role === "planner");
    assert.match(planner.instructions, /"source": "update"/);
    assert.match(
      planner.instructions,
      /saves the change as a remix that credits its author/,
    );
    assert.doesNotMatch(
      planner.instructions,
      /Changing a saved theme isn't something a plan does/,
    );
    const before = planner.history[planner.history.length - 2];
    assert.match(before, /Changing a saved theme isn't something a plan does/);
    assert.match(before, /colorNames/);
  });
});

describe("Dash team instructions (plan → build: never stuck)", () => {
  it("the Lead sends answers to the Planner and never asks the Builder to build a plan", () => {
    const lead = ROLES.find((r) => r.role === "dashlead");
    assert.match(
      lead.instructions,
      /When the user answers the Planner's questions, send their answers and the plan as it stands to the Planner/,
    );
    assert.match(
      lead.instructions,
      /neither can you ask the Builder to build a plan/,
    );
    // The Lead on the words before upgrades.
    assert.doesNotMatch(lead.history[0], /neither can you ask the Builder/);
    const was = { ...teamBot("dashlead"), instructions: lead.history[0] };
    const plan = planEnsureDashTeam([
      ...ROLE_IDS.filter((r) => r !== "dashlead").map((r) => teamBot(r)),
      was,
    ]);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].action, "upgrade");
  });

  it("a new theme doesn't ask where it goes; the Planner before it upgrades", () => {
    const planner = ROLES.find((r) => r.role === "planner");
    assert.match(planner.instructions, /don't ask where it goes/);
    const before = planner.history[planner.history.length - 1];
    assert.doesNotMatch(before, /don't ask where it goes/);
    const bots = ROLE_IDS.map((r) => teamBot(r));
    bots[0].instructions = before;
    const plan = planEnsureDashTeam(bots);
    assert.equal(plan[0].action, "upgrade");
    assert.equal(plan[0].role, "planner");
  });
});
