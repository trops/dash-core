/**
 * botsTree (lead-workspace release 5, frames 23–26): teams first, closed
 * unless picked or needing the user; search and status open only matches.
 */
import { botsTree, treeNeeds, DASH_KEY, EMPTY_KEY, LONE_KEY } from "./botsTree";

const WS = [
  { id: 7, name: "Kitchen Sink" },
  { id: 9, name: "Algolia Search" },
  { id: 11, name: "Calendar" },
  { id: 12, name: "Slack test" },
];
const BOTS = [
  { id: "lead_7", name: "Kitchen Sink Lead", role: "lead", workspaceId: 7 },
  { id: "inbox", name: "Inbox Watch", workspaceId: 7 },
  { id: "brief", name: "Morning Briefer", workspaceId: 7 },
  { id: "lead_9", name: "Algolia Search Lead", role: "lead", workspaceId: 9 },
  { id: "index", name: "Index Watch", workspaceId: "9" },
  { id: "lead_11", name: "Calendar Lead", role: "lead", workspaceId: 11 },
  { id: "keeper", name: "Word Keeper", workspaceId: null },
  { id: "old", name: "Old Bot", workspaceId: 99 },
];
const TEAM = [
  { id: "d1", name: "Dash Lead", role: "dashlead", system: "dash-team" },
  { id: "d2", name: "Planner", role: "planner", system: "dash-team" },
  { id: "d3", name: "Scout", role: "scout", system: "dash-team" },
];
const status = (map) => (id) => map[id] || "Idle";
const tree = (over = {}) =>
  botsTree({
    bots: BOTS,
    dashTeam: TEAM,
    workspaces: WS,
    statusOf: status({}),
    ...over,
  });
const brief = (t) => t.map((x) => [x.key, x.open]);

test("teams first: Dash team, dashboards' teams, dashboards with no bots, on no dashboard (frame 23)", () => {
  const t = tree();
  expect(t.map((x) => x.name)).toEqual([
    "Dash team",
    "Kitchen Sink",
    "Algolia Search",
    "Dashboards with no bots",
    "On no dashboard",
  ]);
  const kitchen = t[1];
  expect(kitchen.lead.id).toBe("lead_7");
  expect(kitchen.members.map((b) => b.id)).toEqual(["inbox", "brief"]);
  expect(kitchen.sub).toBe("2 bots · Kitchen Sink Lead");
  expect(t[0].lead.id).toBe("d1");
  expect(t[0].members.map((b) => b.id)).toEqual(["d2", "d3"]);
  // A dashboard with only a lead (or nothing) is folded into one group.
  expect(t[3].dashboards.map((d) => d.name)).toEqual([
    "Calendar",
    "Slack test",
  ]);
  expect(t[3].dashboards[0].lead.id).toBe("lead_11");
  expect(t[3].sub).toBe(
    "2 dashboards · their leads are ready when you add bots",
  );
  // No dashboard, or one that's gone.
  expect(t[4].members.map((b) => b.id)).toEqual(["keeper", "old"]);
  // Closed by default — except On no dashboard (talked to directly).
  expect(t.filter((x) => x.open).map((x) => x.key)).toEqual([LONE_KEY]);
});

test("the picked team and any that needs you start open; the user's toggles win", () => {
  const statusOf = status({ index: "Needs approval", brief: "Running" });
  const t = tree({ statusOf, selected: "bot:inbox" });
  expect(brief(t)).toEqual([
    [DASH_KEY, false],
    ["team:7", true],
    ["team:9", true],
    [EMPTY_KEY, false],
    [LONE_KEY, true],
  ]);
  expect(t[1].running).toBe(1);
  expect(t[2].needs).toBe(1);
  const closed = tree({
    statusOf,
    selected: "bot:inbox",
    open: { "team:9": false },
  });
  expect(closed[2].open).toBe(false);
  expect(tree({ selected: EMPTY_KEY })[3].open).toBe(true);
});

test("search: only matching teams, open; a team's own name keeps all its bots (frame 25)", () => {
  const t = tree({ query: "inbox" });
  expect(t.map((x) => x.key)).toEqual(["team:7"]);
  expect(t[0].open).toBe(true);
  expect(t[0].members.map((b) => b.id)).toEqual(["inbox"]);
  const byTeam = tree({ query: "kitchen" });
  expect(byTeam[0].members.map((b) => b.id)).toEqual(["inbox", "brief"]);
  expect(tree({ query: "calendar" }).map((x) => x.key)).toEqual([EMPTY_KEY]);
  expect(tree({ query: "zzz" })).toEqual([]);
});

test("status filter: only bots in that state, their teams open, no empty dashboards", () => {
  const statusOf = status({ index: "Running", keeper: "Running" });
  const t = tree({ statusOf, filter: "running" });
  expect(t.map((x) => [x.key, x.members.map((b) => b.id), x.open])).toEqual([
    ["team:9", ["index"], true],
    [LONE_KEY, ["keeper"], true],
  ]);
  expect(t[0].lead).toBeNull();
});

test("Needs you: what each bot wants, and its team", () => {
  const needs = treeNeeds({
    approvals: [
      {
        id: "a1",
        request: { botId: "inbox", toolName: "gmail_send", input: {} },
      },
      { id: "a2", request: { botId: "d2", toolName: "x_tool", input: {} } },
      { id: "a3", request: { botId: "keeper", toolName: "y_tool", input: {} } },
    ],
    bots: BOTS,
    dashTeam: TEAM,
    workspaces: WS,
  });
  expect(needs.map((n) => [n.botId, n.where, n.teamKey])).toEqual([
    ["inbox", "Kitchen Sink", "team:7"],
    ["d2", "Dash team", DASH_KEY],
    ["keeper", "", LONE_KEY],
  ]);
  expect(needs[0].text).toMatch(/^Inbox Watch wants to/);
  expect(needs[0].text).not.toMatch(/\.$/);
});

test("a lead on a dashboard with no bots can need you: counted, filtered, and its needs point at the group", () => {
  const statusOf = status({ lead_11: "Needs approval" });
  const t = tree({ statusOf });
  const empty = t.find((x) => x.key === EMPTY_KEY);
  expect(empty.needs).toBe(1);
  expect(empty.open).toBe(true);
  const filtered = tree({ statusOf, filter: "needs" });
  expect(filtered.map((x) => x.key)).toEqual([EMPTY_KEY]);
  expect(filtered[0].dashboards.map((d) => d.name)).toEqual(["Calendar"]);
  expect(filtered[0].sub).toMatch(/^1 dashboard ·/);
  const [n] = treeNeeds({
    approvals: [{ id: "a1", request: { botId: "lead_11", toolName: "x" } }],
    bots: BOTS,
    dashTeam: TEAM,
    workspaces: WS,
  });
  expect(n.teamKey).toBe(EMPTY_KEY);
});

test("On no dashboard starts open", () => {
  expect(tree().find((x) => x.key === LONE_KEY).open).toBe(true);
});
