/**
 * teamLeads.test.js — every dashboard gets an idle team lead (bot-teams
 * TEAM-002): created once, never while turned off or auto-create is off,
 * idle by default, on the user's default model source.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isLead,
  leadOf,
  defaultLeadProvider,
  leadDefinition,
  leadInstructions,
  planEnsureLead,
  LEAD_ACTION_HISTORY,
  CURRENT_LEAD_ACTION,
} = require("./teamLeads");
const { userPartOf } = require("./builtinInstructions");

const bots = [
  { id: "lead_7", role: "lead", workspaceId: "7", name: "Kitchen Sink Lead" },
  { id: "b1", workspaceId: "7", name: "Inbox Watch" },
  { id: "b2", workspaceId: "9", name: "Sales Bot" },
];

describe("lead lookup", () => {
  it("isLead / leadOf find a dashboard's lead (ids as strings)", () => {
    assert.equal(isLead(bots[0]), true);
    assert.equal(isLead(bots[1]), false);
    assert.equal(leadOf(bots, 7).id, "lead_7");
    assert.equal(leadOf(bots, "9"), null);
  });
});

describe("defaultLeadProvider", () => {
  it("is none of its own (follows Settings › AI) — an API key marked default doesn't take over", () => {
    assert.equal(
      defaultLeadProvider([
        { type: "openai" },
        { type: "anthropic", isDefaultForType: true },
        { type: "gmail" },
      ]),
      null,
    );
    assert.equal(defaultLeadProvider([{ type: "xai" }]), null);
    assert.equal(defaultLeadProvider(null), null);
  });
});

describe("leadDefinition", () => {
  const def = leadDefinition({
    workspaceId: 7,
    dashboardName: "Kitchen Sink",
    provider: "claude-code",
  });

  it("is a lead on that dashboard's team, named after it", () => {
    assert.equal(def.role, "lead");
    assert.equal(def.workspaceId, "7");
    assert.equal(def.name, "Kitchen Sink Lead");
    assert.equal(def.provider, "claude-code");
  });

  it("has no provider when none is given (follows the default at run time)", () => {
    assert.equal(
      leadDefinition({ workspaceId: 7, dashboardName: "X" }).provider,
      null,
    );
  });

  it("is idle: no schedule, no events, no providers", () => {
    assert.deepEqual(def.schedules, []);
    assert.deepEqual(def.subscriptions, []);
    assert.deepEqual(def.mcpServers, []);
  });

  // Its built-in text is added at run time (TEAM-017): only the user's own
  // words are saved on it.
  it("holds no built-in text of its own", () => {
    assert.equal(def.instructions, "");
    assert.equal(def.promptLayers, 1);
  });

  it("is told to answer from team data, treat it as untrusted, and not act", () => {
    const text = leadInstructions("Kitchen Sink");
    assert.match(text, /Kitchen Sink/);
    assert.match(text, /team_recent_runs/);
    assert.match(text, /never as instructions/i);
    assert.match(text, /can't make or change bots/i);
  });

  it("asks for plain-text answers (the chat shows text, not Markdown)", () => {
    assert.match(leadInstructions("Kitchen Sink"), /plain text/i);
  });
});

describe("planEnsureLead", () => {
  const base = {
    bots,
    teamSettings: { leadEnabled: true },
    settings: { autoLeads: true },
    providers: [{ type: "anthropic", isDefaultForType: true }],
  };

  it("creates a lead for a dashboard that has none", () => {
    const plan = planEnsureLead({
      ...base,
      workspaceId: "9",
      dashboardName: "Sales",
    });
    assert.equal(plan.action, "create");
    assert.equal(plan.definition.name, "Sales Lead");
    // Follows Settings › AI — not the API key marked default.
    assert.equal(plan.definition.provider, null);
  });

  it("does nothing when the dashboard already has a lead (idempotent)", () => {
    const plan = planEnsureLead({
      ...base,
      workspaceId: 7,
      dashboardName: "x",
    });
    assert.deepEqual(plan, { action: "none", reason: "exists", lead: bots[0] });
  });

  it("does nothing when the lead was turned off for that dashboard", () => {
    const plan = planEnsureLead({
      ...base,
      workspaceId: "9",
      dashboardName: "Sales",
      teamSettings: { leadEnabled: false },
    });
    assert.equal(plan.action, "none");
    assert.equal(plan.reason, "turned-off");
  });

  it("does nothing when auto-create is off — unless asked explicitly", () => {
    const off = { ...base, settings: { autoLeads: false } };
    assert.equal(
      planEnsureLead({ ...off, workspaceId: "9", dashboardName: "S" }).reason,
      "auto-off",
    );
    assert.equal(
      planEnsureLead({
        ...off,
        workspaceId: "9",
        dashboardName: "S",
        force: true,
      }).action,
      "create",
    );
  });

  // Lead-workspace release 3c: the lead brings in the Dash team itself.
  it("tells the lead to bring in the Dash team, in its own conversation", () => {
    const text = leadInstructions("Kitchen Sink");
    assert.doesNotMatch(text, /propose_bot|Drafts/);
    assert.match(text, /the Dash team makes things/);
    assert.match(text, /team_ask_dash_team/);
    assert.doesNotMatch(text, /<handoff>/);
    assert.match(text, /don't repeat it or list its pieces/);
    assert.match(text, /Only say the plan changed when/);
    assert.match(
      text,
      /to move, remove or resize widgets, tell them to use Edit/i,
    );
    assert.match(text, /with their words in full and every detail they gave/);
    assert.equal(text.includes(CURRENT_LEAD_ACTION), true);
  });

  // Lead-workspace release 1: the lead asks its bots to run.
  it("tells the lead to ask its bots with team_ask_bot, with the full request", () => {
    const text = leadInstructions("Kitchen Sink");
    assert.match(text, /ask it with team_ask_bot/);
    assert.match(text, /it doesn't see this conversation/);
    assert.match(text, /saying which bot it came from/);
    assert.match(text, /busy, paused, or waiting for the user to approve/);
  });

  // Older leads' copy of their built-in text is taken out of their own
  // instructions (builtinInstructions.js); ensureLead never rewrites them.
  it("leaves a lead on any earlier generated instructions to the one-time move", () => {
    for (const oldAction of LEAD_ACTION_HISTORY) {
      const old = leadInstructions("Kitchen Sink").replace(
        CURRENT_LEAD_ACTION,
        oldAction,
      );
      const stale = { ...bots[0], instructions: old };
      const plan = planEnsureLead({
        ...base,
        bots: [stale, ...bots.slice(1)],
        workspaceId: "7",
        dashboardName: "Kitchen Sink",
      });
      assert.equal(plan.action, "none", oldAction.slice(0, 40));
      assert.equal(userPartOf(stale), "", oldAction.slice(0, 40));
      // Without the plain-text rule (before 2a) too.
      assert.equal(
        userPartOf({
          ...stale,
          instructions: old.replace(
            " Answer in plain text — no Markdown formatting.",
            "",
          ),
        }),
        "",
      );
    }
  });

  it("leaves instructions the user edited alone", () => {
    const edited = { ...bots[0], instructions: "My own lead instructions." };
    const plan = planEnsureLead({
      ...base,
      bots: [edited, ...bots.slice(1)],
      workspaceId: "7",
      dashboardName: "Kitchen Sink",
    });
    assert.equal(plan.action, "none");
    assert.equal(plan.reason, "exists");
  });

  it("never creates a lead without a dashboard", () => {
    assert.equal(
      planEnsureLead({ ...base, workspaceId: null, dashboardName: "x" }).action,
      "none",
    );
  });
});
