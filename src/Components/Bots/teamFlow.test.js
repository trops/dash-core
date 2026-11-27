import { diagramEdges } from "./teamDiagram";
import {
  arrowKeys,
  botConnections,
  cardState,
  cardText,
  checkCost,
  curveBetween,
  elbowBetween,
  eventGroup,
  eventTitle,
  flowRows,
  helperIds,
  helpersOf,
  lineSet,
  linesOrDefault,
  neighbourArrows,
  perRowFor,
  whenText,
  workOrder,
} from "./teamFlow";

const ev = (bot, event) => `bot:local/${bot}[${bot}].${event}`;
const bot = (id, subs = [], extra = {}) => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  subscriptions: subs.map((s) => ({ eventType: s })),
  ...extra,
});

// The mockup's team: ticket → triage → planner → coder → (pr, notify);
// pr → merge; every bot's failures → reporter; the reviewer is a helper.
const ticket = bot("ticket");
const triage = bot("triage", [ev("ticket", "completed")]);
const planner = bot("planner", [ev("triage", "completed")]);
const coder = bot("coder", [ev("planner", "completed")], {
  checks: {
    steps: [
      { id: "c1", kind: "check", name: "Validate", check: { kind: "command" } },
      {
        id: "c2",
        kind: "reviewer",
        name: "Reviewer approves",
        botId: "reviewer",
      },
    ],
  },
  publishes: [{ name: "prUrl" }],
});
const pr = bot("pr", [ev("coder", "completed")]);
const notify = bot("notify", [ev("coder", "completed")]);
const merge = bot("merge", [ev("pr", "completed")]);
const reporter = bot(
  "reporter",
  ["ticket", "triage", "planner", "coder", "pr", "merge"].map((b) =>
    ev(b, "failed"),
  ),
);
const reviewer = bot("reviewer");
// Listed in a muddled order, as a team often is.
const team = [
  reporter,
  merge,
  notify,
  reviewer,
  coder,
  ticket,
  pr,
  planner,
  triage,
];
const edges = diagramEdges(team, null);

describe("teamFlow — events", () => {
  it("groups and names a bot's events", () => {
    expect(eventGroup("completed")).toBe("completed");
    expect(eventGroup("failed")).toBe("failed");
    expect(eventGroup("result.prUrl")).toBe("result");
    expect(eventGroup("tool.github.push")).toBe("tool");
    expect(eventTitle("completed")).toBe("On Complete");
    expect(eventTitle("failed")).toBe("On Failure");
    expect(eventTitle("result.prUrl")).toBe("On Result · prUrl");
    expect(eventTitle("tool.github.push", "GitHub › push")).toBe(
      "GitHub › push",
    );
    expect(whenText("completed")).toBe("when it completes");
    expect(whenText("failed")).toBe("when it fails");
    expect(whenText("result.prUrl")).toBe("when it sends prUrl");
  });

  it("Lines defaults to the selected bot", () => {
    expect(linesOrDefault("flow")).toBe("flow");
    expect(linesOrDefault("bogus")).toBe("selected");
    expect(linesOrDefault(null)).toBe("selected");
  });
});

describe("teamFlow — helpers", () => {
  it("a bot only used in another bot's checks is a helper; a wired one isn't", () => {
    expect([...helperIds(team, edges)]).toEqual(["reviewer"]);
    const wired = bot("reviewer", [ev("merge", "completed")]);
    const t2 = team.map((b) => (b.id === "reviewer" ? wired : b));
    expect(helperIds(t2, diagramEdges(t2, null)).size).toBe(0);
  });

  it("a failure route alone keeps a helper a helper", () => {
    const withFail = bot("reporter2", [ev("reviewer", "failed")]);
    const t2 = [...team, withFail];
    expect(helperIds(t2, diagramEdges(t2, null)).has("reviewer")).toBe(true);
  });

  it("helpersOf lists the bots a bot's checks use", () => {
    expect(helpersOf(coder, team)).toEqual([
      {
        botId: "reviewer",
        name: "Reviewer",
        check: "Reviewer approves",
        onTeam: true,
      },
    ]);
    expect(helpersOf(coder, [coder])[0].onTeam).toBe(false);
  });
});

describe("teamFlow — work order", () => {
  const columns = workOrder(team, edges, helperIds(team, edges));

  it("follows the handoffs, stacks a fork and puts the failure receiver last", () => {
    expect(columns.map((c) => c.ids)).toEqual([
      ["ticket"],
      ["triage"],
      ["planner"],
      ["coder"],
      // pr's work goes on (to merge): it's the main one, on top.
      ["pr", "notify"],
      ["merge"],
      ["reporter"],
    ]);
    expect(columns[4].main).toBe("pr");
  });

  it("bots with no lines come after the chains; every bot appears once", () => {
    const lone = bot("lone");
    const t = [lone, ...team];
    const e = diagramEdges(t, null);
    const ids = workOrder(t, e, helperIds(t, e)).flatMap((c) => c.ids);
    expect(ids.indexOf("lone")).toBeGreaterThan(ids.indexOf("merge"));
    expect(ids.indexOf("lone")).toBeLessThan(ids.indexOf("reporter"));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(t.length - 1); // the helper isn't in the flow
  });

  it("a loop still places every bot once", () => {
    const a = bot("a", [ev("b", "completed")]);
    const b = bot("b", [ev("a", "completed")]);
    const cols = workOrder([a, b], diagramEdges([a, b], null));
    expect(cols.map((c) => c.ids)).toEqual([["a"], ["b"]]);
  });

  it("a target already placed stays put", () => {
    // planner also hands on to triage (back): triage keeps its place.
    const p2 = bot("planner", [ev("triage", "completed")]);
    const t2 = bot("triage", [
      ev("ticket", "completed"),
      ev("planner", "completed"),
    ]);
    const t = [ticket, t2, p2];
    const cols = workOrder(t, diagramEdges(t, null));
    expect(cols.map((c) => c.ids)).toEqual([
      ["ticket"],
      ["triage"],
      ["planner"],
    ]);
  });
});

describe("teamFlow — rows and arrows", () => {
  const columns = workOrder(team, edges, helperIds(team, edges));

  it("cards share the row: up to 4 columns, fewer when narrow", () => {
    expect(perRowFor(1400)).toBe(4);
    expect(perRowFor(600)).toBe(3);
    expect(perRowFor(200)).toBe(1);
    expect(perRowFor(0)).toBe(4);
    expect(flowRows(columns, 4).map((r) => r.length)).toEqual([4, 3]);
  });

  it("an arrow between neighbours that hand on; a fork into a stack; none at a wrap", () => {
    const rows = flowRows(columns, 4);
    const arrows = neighbourArrows(rows, edges);
    expect(arrows[0].map((a) => a.kind)).toEqual([
      "single",
      "single",
      "single",
    ]);
    // Row 2: [pr, notify] → merge → reporter (failures only: no arrow).
    expect(arrows[1].map((a) => a.kind)).toEqual(["single", "none"]);
    // The coder → (pr, notify) fork crosses the wrap here; on one row it forks.
    const one = neighbourArrows(flowRows(columns, 7), edges);
    expect(one[0][3]).toMatchObject({ kind: "fork", to: ["pr", "notify"] });
  });

  it("arrowKeys: the lines drawn as arrows", () => {
    const keys = arrowKeys(neighbourArrows(flowRows(columns, 7), edges));
    expect(keys.has(`triage|${ev("ticket", "completed")}`)).toBe(true);
    expect([...keys].some((k) => k.endsWith(".failed"))).toBe(false);
  });
});

describe("teamFlow — which lines show", () => {
  const columns = workOrder(team, edges, helperIds(team, edges));
  const covered = arrowKeys(neighbourArrows(flowRows(columns, 4), edges));
  const wEdges = [
    {
      key: "w1",
      from: "coder",
      widget: "Notes|1",
      event: "completed",
      kind: "completed",
    },
  ];

  it("selected bot (default): only its lines, never failures; nothing selected draws none", () => {
    const none = lineSet({ edges, wEdges, covered, members: team });
    expect(none.lines).toEqual([]);
    expect(none.dim).toBe(false);
    // coder → pr/notify cross the wrap, so they're lines, not arrows.
    const sel = lineSet({
      selectedId: "coder",
      edges,
      wEdges,
      covered,
      members: team,
    });
    expect(sel.lines.map((l) => l.to).sort()).toEqual(["notify", "pr"]);
    expect(sel.showWidgets).toBe(false);
    expect(sel.failLit.has("reporter")).toBe(true);
    expect(sel.lit.has("reviewer")).toBe(true);
    expect(sel.lit.has("planner")).toBe(true);
    expect(sel.lit.has("ticket")).toBe(false);
    expect(sel.lit.has("w:Notes|1")).toBe(true);
  });

  it("work flow: every handoff that isn't an arrow; all: the widgets too", () => {
    const flow = lineSet({
      mode: "flow",
      edges,
      wEdges,
      covered,
      members: team,
    });
    expect(flow.lines.every((l) => l.kind !== "failed")).toBe(true);
    expect(flow.lines).toHaveLength(2);
    const all = lineSet({ mode: "all", edges, wEdges, covered, members: team });
    expect(all.showWidgets).toBe(true);
    expect(all.lines.filter((l) => l.widget)).toEqual([
      expect.objectContaining({ from: "coder", to: "w:Notes|1" }),
    ]);
  });

  it("a helper selected lights the bots that use it", () => {
    const s = lineSet({ selectedId: "reviewer", edges, members: team });
    expect(s.lit.has("coder")).toBe(true);
  });
});

describe("teamFlow — card text", () => {
  it("after its one source; else its trigger summary", () => {
    expect(cardText(coder, team, edges).after).toBe("After Planner");
    expect(cardText(ticket, team, edges).after).toBe("Runs manually");
    expect(cardText(reporter, team, edges).after).toBe("On 6 events");
  });

  it("where its failures go, and who it gets failures from", () => {
    expect(cardText(coder, team, edges).failsTo).toEqual(["Reporter"]);
    expect(cardText(reporter, team, edges).failures).toBe(
      "Gets failures from 6 bots",
    );
    expect(cardText(reporter, team, edges, "coder").failures).toBe(
      "Gets Coder's failures",
    );
    expect(cardText(notify, team, edges)).toMatchObject({
      failsTo: [],
      failures: null,
    });
  });

  it("checkCost: the checks window's words (DASH-127)", () => {
    expect(checkCost({ kind: "check", check: { kind: "rules" } })).toBe(
      "Free · instant rule",
    );
    expect(checkCost({ kind: "check", check: { kind: "command" } })).toBe(
      "No AI cost · time not known yet",
    );
    expect(checkCost({ kind: "reviewer" })).toBe("AI · cost not known yet");
    expect(checkCost({ kind: "you" })).toBe("Free · waits for you");
  });
});

describe("teamFlow — the connections panel", () => {
  const notes = {
    key: "Notes|1",
    itemId: "1",
    component: "Notes",
    label: "Notes",
    handlers: ["show"],
    listens: [],
  };
  const wEdges = [
    {
      key: "w1",
      from: "coder",
      widget: "Notes|1",
      event: "result.prUrl",
      kind: "tool",
      handlerName: "show",
      raw: ev("coder", "result.prUrl"),
    },
  ];
  const c = botConnections({
    bot: coder,
    members: team,
    widgets: [notes],
    wEdges,
    choices: [
      { event: "completed", label: "Completed" },
      { event: "failed", label: "Failed" },
      { event: "result.prUrl", label: "PR link" },
      { event: "tool.github.push", label: "GitHub › push" },
    ],
    after: [{ botId: "planner", name: "Planner", event: "completed" }],
    mainNext: "pr",
  });

  it("one box per event it sends, with the bots and widgets listening", () => {
    expect(c.events.map((b) => b.title)).toEqual([
      "On Complete",
      "On Failure",
      "On Result · prUrl",
    ]);
    const [done, failed, result] = c.events;
    expect(done.listeners.map((t) => [t.name, t.main])).toEqual([
      ["Notify", false],
      ["Pr", true],
    ]);
    expect(failed.listeners.map((t) => t.name)).toEqual(["Reporter"]);
    expect(result.listeners).toEqual([
      expect.objectContaining({ type: "widget", name: "Notes" }),
    ]);
    expect(result.label).toBe("PR link");
  });

  it("add choices: team bots and widgets not already listening (never itself)", () => {
    const [done, , result] = c.events;
    const values = done.addChoices.map((x) => x.value);
    expect(values).not.toContain("bot:coder");
    expect(values).not.toContain("bot:pr");
    expect(values).toContain("bot:merge");
    expect(values).toContain("widget:Notes|1");
    expect(result.addChoices.map((x) => x.value)).not.toContain(
      "widget:Notes|1",
    );
    expect(done.addChoices.find((x) => x.value === "bot:merge").label).toBe(
      "Bot · Merge",
    );
  });

  it("gets work from, tool events and helpers", () => {
    expect(c.getsWorkFrom).toEqual([
      expect.objectContaining({ name: "Planner", when: "when it completes" }),
    ]);
    expect(c.toolEvents.map((b) => b.event)).toEqual(["tool.github.push"]);
    expect(c.helpers.map((h) => h.name)).toEqual(["Reviewer"]);
  });

  it("no bot, no panel", () => {
    expect(botConnections({ bot: null })).toBeNull();
  });
});

describe("teamFlow — line geometry", () => {
  const a = { x: 0, y: 0, w: 100, h: 80 };

  it("a neighbour arrow goes straight across, or elbows to a stacked bot", () => {
    expect(elbowBetween(a, { x: 130, y: 0, w: 100, h: 80 }).d).toBe(
      "M100,28 L130,28",
    );
    expect(elbowBetween(a, { x: 130, y: 100, w: 100, h: 80 }).d).toBe(
      "M100,28 H115 V128 H130",
    );
  });

  it("a drawn line goes down to a lower bot, up to a higher one, or dips under a row", () => {
    expect(curveBetween(a, { x: 0, y: 200, w: 100, h: 80 }).d).toMatch(
      /^M50,80 C/,
    );
    expect(curveBetween({ x: 0, y: 200, w: 100, h: 80 }, a).d).toMatch(
      /^M50,200 C.* 50,80$/,
    );
    const dip = curveBetween(a, { x: 300, y: 0, w: 100, h: 80 }).d;
    expect(dip).toMatch(/^M50,80 C50,(\d+)/);
    expect(Number(dip.match(/^M50,80 C50,(\d+)/)[1])).toBeGreaterThan(80);
  });
});

describe("cardState — the selected card's style (DASH-139)", () => {
  const shown = {
    lit: new Set(["sel", "up", "down", "fail"]),
    failLit: new Set(["fail"]),
  };
  it("the selected bot is 'selected' even though it is lit (and in failLit)", () => {
    expect(cardState("sel", "sel", shown)).toBe("selected");
    expect(
      cardState("sel", "sel", {
        lit: new Set(["sel"]),
        failLit: new Set(["sel"]),
      }),
    ).toBe("selected");
  });
  it("linked, failure listeners and unrelated bots each get their own state", () => {
    expect(cardState("up", "sel", shown)).toBe("linked");
    expect(cardState("down", "sel", shown)).toBe("linked");
    expect(cardState("fail", "sel", shown)).toBe("failure");
    expect(cardState("other", "sel", shown)).toBe("dimmed");
  });
  it("nothing selected: no state", () => {
    expect(cardState("sel", null, shown)).toBeNull();
    expect(cardState("sel", undefined, shown)).toBeNull();
  });
  it("a numeric id matches its string form", () => {
    const n = { lit: new Set([7, 8]), failLit: new Set() };
    expect(cardState(7, "7", n)).toBe("selected");
    expect(cardState("8", 7, n)).toBe("linked");
  });
  it("follows lineSet: the selected bot, its links and the rest", () => {
    const members = [
      { id: "a", subscriptions: [] },
      { id: "b", subscriptions: [{ eventType: ev("a", "completed") }] },
      { id: "c", subscriptions: [{ eventType: ev("b", "failed") }] },
      { id: "d", subscriptions: [] },
    ];
    const edges = diagramEdges(members, null);
    const s = lineSet({ mode: "selected", selectedId: "b", edges, members });
    expect(members.map((m) => cardState(m.id, "b", s))).toEqual([
      "linked",
      "selected",
      "failure",
      "dimmed",
    ]);
  });
});
