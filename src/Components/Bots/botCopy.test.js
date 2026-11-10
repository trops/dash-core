/**
 * botCopy (lead-workspace "make a bot in Create"): a copy of one of the
 * user's bots for the bot form — its own bot, nothing saved until Create.
 */
import { botCopy, copyCandidates } from "./botCopy";

const inbox = {
  id: "b1",
  ref: "local/morning-inbox",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
  session: "s1",
  chatSession: "c1",
  installedFrom: { package: "x" },
  registryRef: "trops/morning-inbox",
  published: { version: "1.0.0" },
  layersNotice: true,
  promptLayers: 1,
  name: "Morning Inbox",
  instructions: "List what needs a reply.",
  provider: "claude-code",
  model: "claude-sonnet-5-5",
  modelSelection: "pinned",
  engine: "claude-agent",
  style: "brief",
  runLimits: { steps: 20 },
  approvalPolicy: "ask",
  whilePaused: "drop",
  mcpServers: ["Gmail"],
  toolSelections: { Gmail: ["search_threads"] },
  allowedTools: ["search_threads"],
  schedules: [{ cron: "0 7 * * 1-5", prompt: "" }],
  subscriptions: [
    {
      eventType: "widget:askClicked",
      source: { kind: "widget", workspaceId: "3", widget: "Ask" },
    },
    { eventType: "bot:completed", source: { kind: "bot", botId: "b9" } },
    { eventType: "schedule:tick", source: { kind: "time" } },
  ],
  publishes: [{ name: "summary", label: "Summary" }],
  workspaceId: "3",
};

describe("botCopy", () => {
  test("keeps what it does, as its own bot on the new dashboard", () => {
    const { initial } = botCopy(inbox, {
      workspaceId: "7",
      dashboardName: "Life HQ",
      fromDashboardName: "Smart Home",
    });
    expect(initial).toMatchObject({
      name: "Morning Inbox (Life HQ)",
      instructions: "List what needs a reply.",
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      modelSelection: "pinned",
      engine: "claude-agent",
      style: "brief",
      runLimits: { steps: 20 },
      approvalPolicy: "ask",
      whilePaused: "drop",
      mcpServers: ["Gmail"],
      toolSelections: { Gmail: ["search_threads"] },
      allowedTools: ["search_threads"],
      schedules: [{ cron: "0 7 * * 1-5", prompt: "" }],
      publishes: [{ name: "summary", label: "Summary" }],
      workspaceId: "7",
    });
    for (const k of [
      "id",
      "ref",
      "createdAt",
      "updatedAt",
      "session",
      "chatSession",
      "installedFrom",
      "registryRef",
      "published",
      "layersNotice",
      "promptLayers",
      "role",
      "system",
    ]) {
      expect(initial).not.toHaveProperty(k);
    }
  });

  test("changing the copy never changes the original", () => {
    const { initial } = botCopy(inbox, { workspaceId: "7" });
    initial.mcpServers.push("Slack");
    initial.toolSelections.Gmail.push("send");
    initial.schedules[0].cron = "0 9 * * *";
    expect(inbox.mcpServers).toEqual(["Gmail"]);
    expect(inbox.toolSelections.Gmail).toEqual(["search_threads"]);
    expect(inbox.schedules[0].cron).toBe("0 7 * * 1-5");
  });

  test("on another dashboard: the old dashboard's widget and bot triggers stay behind", () => {
    const { initial, note } = botCopy(inbox, {
      workspaceId: "7",
      dashboardName: "Life HQ",
      fromDashboardName: "Smart Home",
    });
    expect(initial.subscriptions).toEqual([
      { eventType: "schedule:tick", source: { kind: "time" } },
    ]);
    expect(note).toBe(
      "Copied from Morning Inbox on Smart Home: instructions, model, providers and tools, schedule, approval policy. Not copied: its runs, approvals you said to always allow, and triggers from Smart Home's widgets and bots. Nothing is saved until you click Create.",
    );
  });

  test("on the same dashboard: its triggers come along", () => {
    const { initial, note } = botCopy(inbox, {
      workspaceId: "3",
      dashboardName: "Smart Home",
      fromDashboardName: "Smart Home",
    });
    expect(initial.name).toBe("Morning Inbox (copy)");
    expect(initial.subscriptions).toHaveLength(3);
    expect(note).toBe(
      "Copied from Morning Inbox on Smart Home: instructions, model, providers and tools, schedule, approval policy, triggers. Not copied: its runs and approvals you said to always allow. Nothing is saved until you click Create.",
    );
  });

  test("onto no dashboard", () => {
    const { initial, note } = botCopy(inbox, {
      workspaceId: null,
      fromDashboardName: "Smart Home",
    });
    expect(initial.name).toBe("Morning Inbox (copy)");
    expect(initial.workspaceId).toBe(null);
    expect(note).toMatch(/triggers from Smart Home's widgets and bots/);
  });

  test("from a bot on no dashboard", () => {
    const lone = { ...inbox, workspaceId: null };
    const { note } = botCopy(lone, {
      workspaceId: "7",
      dashboardName: "Life HQ",
    });
    expect(note).toBe(
      "Copied from Morning Inbox: instructions, model, providers and tools, schedule, approval policy. Not copied: its runs, approvals you said to always allow, and triggers from other widgets and bots. Nothing is saved until you click Create.",
    );
  });
});

describe("copyCandidates", () => {
  const dashboards = [
    { id: 3, name: "Smart Home" },
    { id: "5", name: "Shopping List" },
  ];
  const bots = [
    { id: "lead_3", role: "lead", name: "Smart Home Lead", workspaceId: "3" },
    { id: "d_p", system: "dash-team", role: "planner", name: "Planner" },
    { id: "b2", name: "Thermostat Watch", workspaceId: "3" },
    { id: "b1", name: "Morning Inbox", workspaceId: "3" },
    { id: "b5", name: "Shopping List Helper", workspaceId: "5" },
    { id: "w1", name: "Weekly Digest", workspaceId: null },
    { id: "x1", name: "Orphan", workspaceId: "99" },
  ];
  test("your bots by dashboard — no leads or Dash team; no dashboard last", () => {
    expect(
      copyCandidates(bots, dashboards).map((g) => [
        g.label,
        g.bots.map((b) => b.name),
      ]),
    ).toEqual([
      ["On Shopping List", ["Shopping List Helper"]],
      ["On Smart Home", ["Morning Inbox", "Thermostat Watch"]],
      ["On no dashboard", ["Orphan", "Weekly Digest"]],
    ]);
  });
  test("a search narrows by name", () => {
    expect(
      copyCandidates(bots, dashboards, "inbox").map((g) => [
        g.label,
        g.bots.map((b) => b.name),
      ]),
    ).toEqual([["On Smart Home", ["Morning Inbox"]]]);
  });
});
