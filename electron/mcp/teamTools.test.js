/**
 * teamTools.test.js — the AI Assistant's team tools (bot-teams TEAM-004):
 * list_teams and ask_team_lead, with injected dependencies.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { makeTeamToolHandlers } = require("./teamTools");
const { AskCap } = require("../bots/teamDirectory");

const KS = 1774291410862;
const workspaces = [
  { id: KS, name: "Kitchen Sinkq" },
  { id: 2, name: "Sales" },
  { id: 3, name: "Sales" },
  { id: 4, name: "No Lead Here" },
];
const bots = [
  {
    id: "lead_ks",
    role: "lead",
    workspaceId: String(KS),
    name: "Kitchen Sinkq Lead",
  },
  { id: "b1", workspaceId: String(KS), name: "Inbox Watch" },
  { id: "b4", workspaceId: "4", name: "Lonely" },
];

function setup(over = {}) {
  const calls = [];
  const botApi = {
    list: () => bots,
    getRuns: (id) =>
      id === "lead_ks" ? [{ endedAt: "2026-10-02T12:00:00.000Z" }] : [],
    leadAvailability: () => ({ paused: false, overBudget: false }),
    askLead: async (id, q, opts) => {
      calls.push({ id, q, opts });
      return {
        status: "completed",
        output: "Inbox Watch found 2 urgent emails.",
      };
    },
    ...over,
  };
  const handlers = makeTeamToolHandlers({
    getWorkspaces: () => workspaces,
    bots: botApi,
    cap: over.cap || new AskCap({ limit: 5 }),
  });
  return { handlers, calls };
}
const text = (r) => r.content[0].text;

describe("list_teams", () => {
  it("lists dashboards with teams", async () => {
    const { handlers } = setup();
    const r = await handlers.list_teams({});
    const body = JSON.parse(text(r));
    assert.deepEqual(
      body.teams.map((t) => [t.name, t.bots, t.hasLead]),
      [
        ["Kitchen Sinkq", 1, true],
        ["No Lead Here", 1, false],
      ],
    );
    assert.equal(body.teams[0].lastActivity, "2026-10-02T12:00:00.000Z");
  });
});

describe("ask_team_lead", () => {
  it("asks the dashboard's lead (via the Assistant) and names the team", async () => {
    const { handlers, calls } = setup();
    const r = await handlers.ask_team_lead({
      dashboard: "kitchen sinkq",
      question: "Anything urgent?",
    });
    assert.deepEqual(calls, [
      { id: "lead_ks", q: "Anything urgent?", opts: { via: "assistant" } },
    ]);
    assert.match(text(r), /^Team: Kitchen Sinkq \(lead: Kitchen Sinkq Lead\)/);
    assert.match(text(r), /2 urgent emails/);
    assert.ok(!r.isError);
  });

  it("asks which dashboard when the name is ambiguous", async () => {
    const { handlers, calls } = setup();
    const r = await handlers.ask_team_lead({
      dashboard: "Sales",
      question: "x",
    });
    assert.match(text(r), /Several dashboards match "Sales"/);
    assert.match(text(r), /id 2/);
    assert.match(text(r), /id 3/);
    assert.equal(calls.length, 0);
  });

  it("says when nothing matches", async () => {
    const { handlers } = setup();
    const r = await handlers.ask_team_lead({
      dashboard: "Nope",
      question: "x",
    });
    assert.match(text(r), /No dashboard matches "Nope"/);
  });

  it("says when the dashboard has no team lead, and how to turn one on", async () => {
    const { handlers, calls } = setup();
    const r = await handlers.ask_team_lead({
      dashboard: "No Lead Here",
      question: "x",
    });
    assert.match(text(r), /has no team lead/);
    assert.match(text(r), /Bots view/);
    assert.equal(calls.length, 0);
  });

  it("reports a paused or over-budget lead instead of asking", async () => {
    for (const [avail, re] of [
      [{ paused: true, overBudget: false }, /paused/],
      [{ paused: false, overBudget: true }, /over its budget/],
    ]) {
      const { handlers, calls } = setup({ leadAvailability: () => avail });
      const r = await handlers.ask_team_lead({
        dashboard: String(KS),
        question: "x",
      });
      assert.match(text(r), re);
      assert.equal(calls.length, 0);
    }
  });

  it("stops after 5 leads in a short window", async () => {
    const { handlers, calls } = setup({ cap: new AskCap({ limit: 2 }) });
    await handlers.ask_team_lead({ dashboard: String(KS), question: "1" });
    await handlers.ask_team_lead({ dashboard: String(KS), question: "2" });
    const r = await handlers.ask_team_lead({
      dashboard: String(KS),
      question: "3",
    });
    assert.match(text(r), /asked 2 team leads/i);
    assert.equal(calls.length, 2);
  });

  it("relays a failed answer, and a busy lead", async () => {
    const failed = setup({
      askLead: async () => ({
        status: "failed",
        error: "credit balance is too low",
      }),
    });
    assert.match(
      text(
        await failed.handlers.ask_team_lead({
          dashboard: String(KS),
          question: "x",
        }),
      ),
      /couldn't answer: credit balance is too low/,
    );
    const busy = setup({
      askLead: async () => ({
        skipped: true,
        reason: "a run is already in progress",
      }),
    });
    assert.match(
      text(
        await busy.handlers.ask_team_lead({
          dashboard: String(KS),
          question: "x",
        }),
      ),
      /busy/,
    );
  });

  it("needs a question", async () => {
    const { handlers } = setup();
    const r = await handlers.ask_team_lead({ dashboard: "Kitchen Sinkq" });
    assert.equal(r.isError, true);
  });
});

describe("registration (static pin)", () => {
  it("electron/index.js registers the team tools at startup", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "index.js"),
      "utf8",
    );
    assert.match(
      src,
      /const \{ registerTeamTools \} = require\("\.\/mcp\/teamTools"\)/,
    );
    assert.match(src, /\nregisterTeamTools\(\);/);
  });
});

describe("ask_team_lead — drafts made during the ask (TEAM-005 AC5)", () => {
  it("tells the Assistant a draft is waiting for review", async () => {
    let drafts = [];
    const { handlers } = setup({
      askLead: async () => {
        drafts = [
          {
            id: "d1",
            leadId: "lead_ks",
            createdAt: new Date().toISOString(),
            definition: { name: "Morning Digest" },
          },
        ];
        return { status: "completed", output: "I've drafted Morning Digest." };
      },
      listDrafts: () => drafts,
    });
    const r = await handlers.ask_team_lead({
      dashboard: "Kitchen Sinkq",
      question: "add a bot that…",
    });
    assert.match(
      r.content[0].text,
      /Draft "Morning Digest" is waiting for the user's review in Kitchen Sinkq's Bots view/,
    );
  });

  it("doesn't mention drafts that existed before the ask", async () => {
    const { handlers } = setup({
      listDrafts: () => [
        {
          id: "old",
          leadId: "lead_ks",
          createdAt: "2020-01-01T00:00:00.000Z",
          definition: { name: "Old" },
        },
      ],
    });
    const r = await handlers.ask_team_lead({
      dashboard: "Kitchen Sinkq",
      question: "x",
    });
    assert.doesNotMatch(r.content[0].text, /Draft "Old"/);
  });
});
