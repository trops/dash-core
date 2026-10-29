/**
 * needsYou / activityLog (lead-workspace release 4, frames 22, 27–29): what
 * needs the user from every dashboard, and what the bots did.
 */
import { needsYou, whenText } from "./needsYou";
import { activityLog } from "./activityLog";

const NOW = new Date(2026, 9, 29, 10, 0).getTime();
const at = (h, m = 0, dayOffset = 0) =>
  new Date(2026, 9, 29 + dayOffset, h, m).toISOString();

const BOTS = [
  { id: "inbox", name: "Inbox Watch", workspaceId: 7, mcpServers: ["Gmail"] },
  {
    id: "brief",
    name: "Morning Briefer",
    workspaceId: 7,
    mcpServers: ["Gmail", "Calendar"],
  },
  { id: "index", name: "Index Watch", workspaceId: 9 },
  { id: "lead_7", name: "Kitchen Sink Lead", role: "lead", workspaceId: 7 },
  { id: "keeper", name: "Word Keeper", workspaceId: null },
  { id: "d_b", name: "Builder", role: "builder", dashTeam: true },
];
const LEADS = [
  {
    botId: "lead_7",
    leadName: "Kitchen Sink Lead",
    dashboardId: 7,
    dashboardName: "Kitchen Sink",
  },
  {
    botId: "lead_9",
    leadName: "Algolia Search Lead",
    dashboardId: 9,
    dashboardName: "Algolia Search",
  },
];
const DASHBOARDS = { 7: "Kitchen Sink", 9: "Algolia Search" };
const base = {
  bots: BOTS,
  leads: LEADS,
  dashboards: DASHBOARDS,
  current: "7",
  now: NOW,
};

test("an approval: who asks, where, and Allow once opens nothing but answers", () => {
  const [item] = needsYou({
    ...base,
    approvals: [
      {
        id: "a1",
        createdAt: at(9, 12),
        request: { botId: "inbox", toolName: "gmail_send", input: {} },
      },
    ],
  });
  expect(item).toMatchObject({
    kind: "approval",
    approvalId: "a1",
    who: "Inbox Watch · Kitchen Sink",
    where: "",
    // What it wants to do (frame 22).
    title: "Inbox Watch wants to use gmail_send",
    text: "It waits for your answer.",
    open: { key: "lead:lead_7" },
  });
});

test("a failed run: Retry, or Reconnect for a connection problem; another dashboard is tagged", () => {
  const items = needsYou({
    ...base,
    lastRuns: {
      index: {
        at: at(7, 30),
        status: "failed",
        error: "Request failed: 401 Unauthorized",
      },
      inbox: {
        at: at(8),
        status: "failed",
        error: "The model ran out of time.",
      },
      brief: { at: at(8), status: "completed" },
      // Leads and the Dash team answer in their conversations.
      lead_7: { at: at(8), status: "failed", error: "x" },
      d_b: { at: at(8), status: "failed", error: "x" },
      // Too old to be news.
      keeper: { at: at(8, 0, -9), status: "failed", error: "x" },
    },
  });
  expect(items.map((i) => i.id)).toEqual([
    `failed:inbox:${Date.parse(at(8))}`,
    `failed:index:${Date.parse(at(7, 30))}`,
  ]);
  expect(items[0]).toMatchObject({
    title: "Inbox Watch failed",
    reconnect: false,
    where: "",
  });
  expect(items[1]).toMatchObject({
    title: "Index Watch couldn't run",
    reconnect: true,
    where: "Algolia Search",
    // Fixed on the bot's own page.
    open: { botId: "index" },
  });
  // Running again: not listed.
  expect(
    needsYou({
      ...base,
      // listRunning's shape.
      running: [{ id: "inbox", name: "Inbox Watch", workspaceId: 7 }],
      lastRuns: { inbox: { at: at(8), status: "failed", error: "x" } },
    }),
  ).toEqual([]);
});

test("a plan waiting for a yes opens its conversation, and says which", () => {
  const items = needsYou({
    ...base,
    recents: [
      {
        id: "q1",
        kind: "question",
        planned: true,
        built: null,
        with: "lead:lead_9",
        title: "Add an AWS bill widget",
        updatedAt: at(8, 40),
      },
      {
        id: "q2",
        kind: "question",
        planned: true,
        built: "built",
        with: "role:dashlead",
        title: "Done",
        updatedAt: at(8),
      },
      {
        id: "q3",
        kind: "question",
        planned: false,
        with: "role:dashlead",
        title: "Just a question",
        updatedAt: at(8),
      },
    ],
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    kind: "plan",
    who: "Planner · Dash team, for Algolia Search Lead",
    where: "Algolia Search",
    title: "A plan is ready: Add an AWS bill widget",
    convo:
      "In your conversation with Algolia Search Lead · “Add an AWS bill widget”",
    open: { key: "lead:lead_9", recentId: "q1" },
  });
});

test("NEW is what came since the user last looked; newest first", () => {
  const items = needsYou({
    ...base,
    seenAt: Date.parse(at(9)),
    approvals: [
      { id: "old", createdAt: at(8), request: { botId: "inbox" } },
      { id: "new", createdAt: at(9, 30), request: { botId: "inbox" } },
    ],
  });
  expect(items.map((i) => [i.approvalId, i.isNew])).toEqual([
    ["new", true],
    ["old", false],
  ]);
  expect(whenText(at(9, 12), NOW)).toMatch(/9:12/);
  expect(whenText(at(9, 12, -1), NOW)).toBe("Yesterday");
});

describe("activityLog", () => {
  const RUNS = [
    {
      botId: "inbox",
      botName: "Inbox Watch",
      workspaceId: 7,
      run: {
        status: "completed",
        endedAt: at(9),
        output: "Checked 41 emails · flagged 2\nmore",
      },
    },
    {
      botId: "index",
      botName: "Index Watch",
      workspaceId: 9,
      run: {
        status: "failed",
        endedAt: at(7, 30),
        error: "Request failed: 401",
      },
    },
    {
      botId: "lead_7",
      botName: "Kitchen Sink Lead",
      workspaceId: 7,
      run: {
        status: "completed",
        endedAt: at(8, 40),
        output: "I brought in the Dash team.",
      },
    },
  ];
  test("this dashboard by default; a lead's run opens its conversation", () => {
    const log = activityLog({ ...base, runs: RUNS });
    expect(log.map((l) => [l.who, l.text, l.tone, l.where])).toEqual([
      ["Inbox Watch", "Checked 41 emails · flagged 2", "ok", ""],
      ["Kitchen Sink Lead", "I brought in the Dash team.", "ok", ""],
    ]);
    expect(log[1].open).toEqual({ key: "lead:lead_7" });
  });
  test("All: every dashboard, each tagged", () => {
    const log = activityLog({ ...base, runs: RUNS, scope: "all" });
    // Only another dashboard's runs are tagged (frame 29).
    expect(log.map((l) => [l.who, l.where])).toEqual([
      ["Inbox Watch", ""],
      ["Kitchen Sink Lead", ""],
      ["Index Watch", "Algolia Search"],
    ]);
    expect(log[2].text).toMatch(/^failed — /);
    expect(log[2].tone).toBe("bad");
  });
});

test("a failure reads as a person would: no engine wrapper, kept short", () => {
  const { errorLine } = require("./needsYou");
  expect(
    errorLine(
      "Claude Code returned an error result: There's an issue with the selected model.",
    ),
  ).toBe("There's an issue with the selected model.");
  expect(errorLine("x".repeat(300), 20)).toHaveLength(20);
});

test("a plan's time is when it came in, not the conversation's last change; its title is the plan's name", () => {
  const [item] = needsYou({
    ...base,
    recents: [
      {
        id: "q1",
        kind: "question",
        planned: true,
        with: "role:dashlead",
        title: "Plan me one new widget that shows the time in big digits",
        planName: "Big Clock",
        plannedAt: at(8),
        updatedAt: at(9, 50),
      },
    ],
  });
  expect(item.at).toBe(Date.parse(at(8)));
  expect(item.title).toBe("A plan is ready: Big Clock");
});
