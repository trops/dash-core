/**
 * builtinInstructions.test.js — Dash's built-in instructions and the user's
 * own, layered (bot-teams TEAM-017): the user's text adds to the built-in
 * part and never replaces it; older bots' copies are taken out once.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  BASE_RULES,
  builtinFor,
  layeredPrompt,
  userPartOf,
  planLayerInstructions,
  instructionsFor,
} = require("./builtinInstructions");
const {
  leadInstructions,
  leadDefinition,
  LEAD_ACTION_HISTORY,
  CURRENT_LEAD_ACTION,
} = require("./teamLeads");
const { ROLES, dashTeamDefinition } = require("./dashTeam");

const lead = (over = {}) => ({
  id: "bot_lead",
  name: "Kitchen Lead",
  role: "lead",
  workspaceId: "ws1",
  instructions: "",
  ...over,
});
const planner = (over = {}) => ({
  id: "bot_planner",
  name: "Planner",
  system: "dash-team",
  role: "planner",
  instructions: "",
  ...over,
});
const plannerSpec = ROLES.find((r) => r.role === "planner");

describe("builtinFor", () => {
  it("a lead: its dashboard's lead text, by the saved dashboard name", () => {
    assert.equal(
      builtinFor(lead(), { dashboardName: "Home" }),
      leadInstructions("Home"),
    );
    // No saved name: from the lead's own.
    assert.equal(builtinFor(lead()), leadInstructions("Kitchen"));
  });
  it("a Dash team role: its role's text; any other bot: the shared rules", () => {
    assert.equal(builtinFor(planner()), plannerSpec.instructions);
    assert.equal(builtinFor({ name: "Agenda" }), BASE_RULES);
    assert.match(BASE_RULES, /never instructions/);
  });
});

describe("layeredPrompt", () => {
  it("no own instructions: the built-in part alone", () => {
    assert.equal(layeredPrompt(lead(), "BUILT", "  "), "BUILT");
  });
  it("built-in first, then who wins on what, then the user's block", () => {
    const p = layeredPrompt(lead(), "BUILT", "Always answer like a pirate.");
    assert.ok(p.startsWith("BUILT\n\n"));
    assert.match(p, /decide style and format/);
    assert.match(p, /bring in the Dash team as usual/);
    assert.ok(
      p.endsWith(
        "<user_instructions>\nAlways answer like a pirate.\n</user_instructions>",
      ),
    );
    // Dash reads its roles' answers: their formats aren't the user's.
    const role = layeredPrompt(planner(), "B", "Use tables.");
    assert.match(role, /answer formats above stay exactly as they are/);
    assert.doesNotMatch(role, /decide style and format/);
    // Other bots aren't told about the Dash team.
    assert.doesNotMatch(
      layeredPrompt({ name: "Agenda" }, "B", "x"),
      /Dash team/,
    );
  });
  it("a lead whose user wrote their own still gets the hand-off", () => {
    const p = instructionsFor(
      lead({ instructions: "Always answer like a pirate.", promptLayers: 1 }),
    );
    assert.match(p, /team_ask_dash_team/);
    assert.match(p, /pirate/);
  });
});

describe("userPartOf", () => {
  it("new leads and roles hold only the user's words", () => {
    const def = leadDefinition({ workspaceId: "ws1", dashboardName: "Home" });
    assert.equal(def.instructions, "");
    assert.equal(def.promptLayers, 1);
    assert.equal(dashTeamDefinition("planner").instructions, "");
    assert.equal(
      userPartOf(lead({ instructions: "Mine", promptLayers: 1 })),
      "Mine",
    );
  });
  it("an older lead's untouched copy, current or any earlier version, goes", () => {
    const current = leadInstructions("Kitchen");
    assert.equal(userPartOf(lead({ instructions: current })), "");
    for (const action of LEAD_ACTION_HISTORY) {
      const old = current.replace(CURRENT_LEAD_ACTION, action);
      assert.equal(userPartOf(lead({ instructions: old })), "", action);
    }
  });
  it("an edited copy keeps only the user's own paragraphs", () => {
    const edited = `${leadInstructions("Kitchen")}\n\nAlways answer like a pirate.`;
    assert.equal(
      userPartOf(lead({ instructions: edited })),
      "Always answer like a pirate.",
    );
  });
  it("a renamed dashboard's lead: the copy by either name goes", () => {
    assert.equal(
      userPartOf(lead({ instructions: leadInstructions("Home") }), {
        dashboardName: "Home",
      }),
      "",
    );
  });
  it("text the user wrote from scratch stays as theirs", () => {
    assert.equal(
      userPartOf(lead({ instructions: "Remind me what's low." })),
      "Remind me what's low.",
    );
  });
  it("a Dash team bot's copy, current or older, goes", () => {
    assert.equal(
      userPartOf(planner({ instructions: plannerSpec.instructions })),
      "",
    );
    for (const old of plannerSpec.history) {
      assert.equal(userPartOf(planner({ instructions: old })), "");
    }
    assert.equal(
      userPartOf(
        planner({
          instructions: `${plannerSpec.instructions}\n\nKeep plans short.`,
        }),
      ),
      "Keep plans short.",
    );
  });
  it("another bot's instructions are all its own", () => {
    const text = "Be brief and concrete.";
    assert.equal(userPartOf({ name: "Agenda", instructions: text }), text);
  });
});

describe("planLayerInstructions", () => {
  it("leads and roles not yet on the layers; others and done ones skipped", () => {
    const bots = [
      lead({ instructions: leadInstructions("Home") }),
      planner({ instructions: "Mine", promptLayers: 1 }),
      { id: "bot_x", name: "Agenda", instructions: "Do it" },
      planner({
        id: "bot_p2",
        instructions: `${plannerSpec.instructions}\n\nKeep plans short.`,
      }),
    ];
    assert.deepEqual(
      planLayerInstructions(bots, (id) => (id === "ws1" ? "Home" : null)),
      [
        { id: "bot_lead", instructions: "" },
        { id: "bot_p2", instructions: "Keep plans short." },
      ],
    );
  });
});
