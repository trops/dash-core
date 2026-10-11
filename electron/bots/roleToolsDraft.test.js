/**
 * roleToolsDraft.test.js — the Builder drafts bots onto dashboards and the
 * Planner/Builder list dashboards (create-entry CRE-011, slice 3b-2).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  handleRoleTool,
  roleToolsFor,
  serverForTool,
  ROLE_SERVER,
} = require("./roleTools");
const { buildDraft } = require("./botDrafts");

const as = (role) => ({ botId: `b_${role}`, role });
const DASHBOARDS = [
  {
    id: "7",
    name: "Programmatic Test",
    bots: ["Programmatic Test Lead (lead)"],
  },
  { id: "9", name: "Mail", bots: [] },
];

function deps(over = {}) {
  return {
    installedWidgets: () => [],
    searchRegistry: async () => [],
    readWidget: async () => ({ success: false }),
    providerTools: () => [],
    askRole: async () => ({ text: "", isError: false }),
    listDashboards: () => DASHBOARDS,
    draftBot: ({ callerId, dashboard, proposal }) => {
      const ws = DASHBOARDS.find(
        (d) =>
          d.id === dashboard ||
          d.name.toLowerCase() === dashboard.toLowerCase(),
      );
      if (!ws) return { error: `No dashboard "${dashboard}".` };
      const res = buildDraft({
        proposal,
        sources: [],
        team: [],
        workspaceId: ws.id,
        leadId: callerId,
      });
      return res.draft ? { ...res, dashboardName: ws.name } : res;
    },
    ...over,
  };
}

describe("list_dashboards", () => {
  it("lists dashboards with their bots", async () => {
    const r = await handleRoleTool(deps(), as("planner"), "list_dashboards");
    assert.match(
      r.text,
      /- Programmatic Test \(id 7\) — bots: Programmatic Test Lead \(lead\)/,
    );
    assert.match(r.text, /- Mail \(id 9\) — bots: none/);
  });

  it("says when there are none; the Scout and Checker don't get it", async () => {
    const r = await handleRoleTool(
      deps({ listDashboards: () => [] }),
      as("builder"),
      "list_dashboards",
    );
    assert.match(r.text, /no dashboards yet/);
    assert.ok(!roleToolsFor("scout").some((t) => t.name === "list_dashboards"));
    assert.ok(
      !roleToolsFor("checker").some((t) => t.name === "list_dashboards"),
    );
  });
});

describe("draft_bot", () => {
  it("drafts onto the named dashboard with its schedule and results, never 'created'", async () => {
    const r = await handleRoleTool(deps(), as("builder"), "draft_bot", {
      dashboard: "programmatic test",
      name: "Daily quote",
      instructions: "Send an encouraging quote.",
      schedule: { cron: "0 8 * * 1-5" },
      publishes: [{ name: "quote", label: "Quote" }],
    });
    assert.equal(r.isError, false);
    assert.match(r.text, /Drafted "Daily quote"\. It is NOT created/);
    assert.match(r.text, /the "Programmatic Test" dashboard's Bots view/);
    assert.match(r.text, /Results it sends: quote/);
  });

  it("is auto-allowed (a draft runs nothing) and only the Builder has it", async () => {
    assert.equal(serverForTool("draft_bot"), ROLE_SERVER);
    const r = await handleRoleTool(deps(), as("planner"), "draft_bot", {
      dashboard: "Mail",
      name: "x",
      instructions: "y",
    });
    assert.equal(r.isError, true);
  });

  it("an unknown dashboard or a missing one is an error", async () => {
    let r = await handleRoleTool(deps(), as("builder"), "draft_bot", {
      dashboard: "Nope",
      name: "x",
      instructions: "y",
    });
    assert.match(r.text, /No dashboard "Nope"/);
    r = await handleRoleTool(deps(), as("builder"), "draft_bot", {
      name: "x",
      instructions: "y",
    });
    assert.match(r.text, /needs the dashboard/);
  });

  it("without the host, drafting isn't available", async () => {
    const r = await handleRoleTool(
      deps({ draftBot: undefined }),
      as("builder"),
      "draft_bot",
      { dashboard: "Mail", name: "x", instructions: "y" },
    );
    assert.match(r.text, /Drafting bots isn't available here/);
  });
});

describe("buildDraft — publishes (3b-2)", () => {
  it("keeps valid, unique results and drops bad names", () => {
    const { draft } = buildDraft({
      proposal: {
        name: "Digest",
        instructions: "Summarize PRs",
        publishes: [
          { name: "digest", label: "PR digest" },
          { name: "digest" },
          { name: "bad name" },
        ],
      },
      workspaceId: "7",
    });
    assert.deepEqual(draft.definition.publishes, [
      { name: "digest", label: "PR digest" },
    ]);
    assert.equal(draft.dropped.length, 1);
    assert.match(draft.dropped[0], /Result "bad name"/);
  });

  it("a lead's draft without publishes is unchanged", () => {
    const { draft } = buildDraft({
      proposal: { name: "A", instructions: "B" },
      workspaceId: "7",
    });
    assert.ok(
      !draft.definition.publishes || draft.definition.publishes.length === 0,
    );
  });
});

describe("buildDraft — author (3b-2)", () => {
  it("defaults to lead; the Dash team's drafts say so", () => {
    const base = {
      proposal: { name: "A", instructions: "B" },
      workspaceId: "7",
    };
    assert.equal(buildDraft(base).draft.author, "lead");
    assert.equal(
      buildDraft({ ...base, author: "dash-team" }).draft.author,
      "dash-team",
    );
  });
});
