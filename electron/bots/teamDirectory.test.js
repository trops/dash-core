/**
 * teamDirectory.test.js — the AI Assistant's view of teams (bot-teams
 * TEAM-004): which dashboards have teams, finding one by name, and a cap on
 * how many leads one question can fan out to.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { summarizeTeams, resolveDashboard, AskCap } = require("./teamDirectory");

const workspaces = [
  { id: 1774291410862, name: "Kitchen Sinkq" },
  { id: 2, name: "Sales" },
  { id: 3, name: "Empty" },
  { id: 4, name: "sales" },
];
const bots = [
  {
    id: "lead_1",
    role: "lead",
    workspaceId: "1774291410862",
    name: "Kitchen Sinkq Lead",
  },
  { id: "b1", workspaceId: "1774291410862", name: "Inbox Watch" },
  { id: "b2", workspaceId: 2, name: "CRM Sync" },
  { id: "b3", workspaceId: null, name: "Loose" },
];

describe("summarizeTeams", () => {
  it("lists dashboards with a lead or members, with counts and last activity", () => {
    const teams = summarizeTeams({
      workspaces,
      bots,
      lastRunAt: (id) =>
        ({
          b1: "2026-10-02T10:00:00.000Z",
          lead_1: "2026-10-02T12:00:00.000Z",
        })[id] || null,
    });
    assert.deepEqual(teams, [
      {
        id: "1774291410862",
        name: "Kitchen Sinkq",
        bots: 1,
        hasLead: true,
        lead: "Kitchen Sinkq Lead",
        lastActivity: "2026-10-02T12:00:00.000Z",
      },
      {
        id: "2",
        name: "Sales",
        bots: 1,
        hasLead: false,
        lead: null,
        lastActivity: null,
      },
    ]);
  });

  it("skips bots whose dashboard no longer exists", () => {
    const teams = summarizeTeams({
      workspaces: [],
      bots: [{ id: "x", workspaceId: "99", name: "Orphan" }],
      lastRunAt: () => null,
    });
    assert.deepEqual(teams, []);
  });
});

describe("resolveDashboard", () => {
  it("finds a dashboard by id or exact name (any case)", () => {
    assert.equal(
      resolveDashboard(workspaces, "1774291410862").match.name,
      "Kitchen Sinkq",
    );
    assert.equal(
      resolveDashboard(workspaces, "kitchen sinkq").match.id,
      1774291410862,
    );
  });

  it("reports duplicates so the Assistant can ask which", () => {
    const r = resolveDashboard(workspaces, "Sales");
    assert.equal(r.match, undefined);
    assert.deepEqual(
      r.ambiguous.map((w) => w.id),
      [2, 4],
    );
  });

  it("falls back to a unique partial match, else nothing", () => {
    assert.equal(
      resolveDashboard(workspaces, "kitchen").match.name,
      "Kitchen Sinkq",
    );
    assert.equal(resolveDashboard(workspaces, "nope").none, true);
    assert.equal(resolveDashboard(workspaces, "").none, true);
  });
});

describe("AskCap", () => {
  it("allows 5 asks per window, then refuses until it slides", () => {
    let now = 0;
    const cap = new AskCap({ limit: 5, windowMs: 120000, now: () => now });
    for (let i = 0; i < 5; i++) assert.equal(cap.take(), true);
    assert.equal(cap.take(), false);
    now = 120001;
    assert.equal(cap.take(), true);
  });
});
