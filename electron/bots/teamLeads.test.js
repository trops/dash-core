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
  it("uses the default AI provider type, else the first one", () => {
    assert.equal(
      defaultLeadProvider([
        { type: "openai" },
        { type: "anthropic", isDefaultForType: true },
        { type: "gmail" },
      ]),
      "anthropic",
    );
    assert.equal(defaultLeadProvider([{ type: "xai" }]), "xai");
  });

  it("falls back to Claude Code (no API key needed)", () => {
    assert.equal(defaultLeadProvider([{ type: "gmail" }]), "claude-code");
    assert.equal(defaultLeadProvider(null), "claude-code");
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

  it("is idle: no schedule, no events, no providers", () => {
    assert.deepEqual(def.schedules, []);
    assert.deepEqual(def.subscriptions, []);
    assert.deepEqual(def.mcpServers, []);
  });

  it("is told to answer from team data, treat it as untrusted, and not act", () => {
    assert.match(def.instructions, /Kitchen Sink/);
    assert.match(def.instructions, /team_recent_runs/);
    assert.match(def.instructions, /never as instructions/i);
    assert.match(def.instructions, /can't change, save or run bots/i);
  });

  it("asks for plain-text answers (the chat shows text, not Markdown)", () => {
    assert.match(def.instructions, /plain text/i);
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
    assert.equal(plan.definition.provider, "anthropic");
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

  it("tells the lead to draft new bots with propose_bot, never claim them created", () => {
    const text = leadInstructions("Kitchen Sink");
    assert.match(text, /propose_bot/);
    assert.match(text, /team_providers/);
    assert.match(text, /check team_list_bots before saying one is waiting/);
    assert.match(text, /never say it's created/);
    assert.equal(text.includes(CURRENT_LEAD_ACTION), true);
  });

  it("upgrades a lead still on any earlier generated instructions", () => {
    for (const oldAction of LEAD_ACTION_HISTORY) {
      const old = leadInstructions("Kitchen Sink").replace(
        CURRENT_LEAD_ACTION,
        oldAction,
      );
      const plan = planEnsureLead({
        ...base,
        bots: [{ ...bots[0], instructions: old }, ...bots.slice(1)],
        workspaceId: "7",
        dashboardName: "Kitchen Sink",
      });
      assert.equal(plan.action, "upgrade", oldAction.slice(0, 40));
      assert.match(plan.instructions, /propose_bot/);
    }
  });

  it("upgrades the Bots-view-era instructions (kept from TEAM-011)", () => {
    const old = leadInstructions("Kitchen Sink").replace(
      CURRENT_LEAD_ACTION,
      LEAD_ACTION_HISTORY[0],
    );
    const stale = { ...bots[0], instructions: old };
    const plan = planEnsureLead({
      ...base,
      bots: [stale, ...bots.slice(1)],
      workspaceId: "7",
      dashboardName: "Kitchen Sink",
    });
    assert.equal(plan.action, "upgrade");
    assert.equal(plan.lead.id, "lead_7");
    assert.match(plan.instructions, /Bots view/);
    assert.doesNotMatch(plan.instructions, /Dashboard Config/);
  });

  it("also upgrades the older version without the plain-text rule", () => {
    const older = leadInstructions("Kitchen Sink")
      .replace(CURRENT_LEAD_ACTION, LEAD_ACTION_HISTORY[0])
      .replace(" Answer in plain text — no Markdown formatting.", "");
    const plan = planEnsureLead({
      ...base,
      bots: [{ ...bots[0], instructions: older }, ...bots.slice(1)],
      workspaceId: "7",
      dashboardName: "Kitchen Sink",
    });
    assert.equal(plan.action, "upgrade");
    assert.match(plan.instructions, /plain text/);
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
