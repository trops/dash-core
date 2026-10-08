import {
  parseBotEventType,
  eventText,
  eventKind,
  diagramEdges,
  diagramLayout,
  runsAfter,
  thenTriggers,
  loopEdges,
  eventChoices,
  addTrigger,
  updateTrigger,
  removeTrigger,
} from "./teamDiagram";

const ev = (bot, event, ref = `local/${bot}`) => `bot:${ref}[${bot}].${event}`;

const lead = { id: "lead", name: "Lead", role: "lead" };
const planner = { id: "planner", name: "Planner", subscriptions: [] };
const reader = {
  id: "reader",
  name: "Reader",
  subscriptions: [
    { eventType: ev("planner", "completed"), label: "Plan ready" },
  ],
};
const checker = {
  id: "checker",
  name: "Checker",
  subscriptions: [
    { eventType: ev("reader", "completed") },
    { eventType: ev("reader", "tool.algolia.search_index") },
    // Another dashboard's bot, the lead, itself, a deleted bot, a widget.
    { eventType: ev("elsewhere", "completed") },
    { eventType: ev("lead", "completed") },
    { eventType: ev("checker", "failed") },
    { eventType: ev("gone", "completed") },
    { eventType: "Notepad[12].saved" },
  ],
};
const matcher = {
  id: "matcher",
  name: "Matcher",
  subscriptions: [{ eventType: ev("checker", "failed") }],
};
const members = [planner, reader, checker, matcher];

describe("parseBotEventType", () => {
  it("reads the publishing bot and event", () => {
    expect(parseBotEventType(ev("reader", "completed"))).toEqual({
      ref: "local/reader",
      botId: "reader",
      event: "completed",
    });
    expect(
      parseBotEventType("bot:@acme/digest[bot_1].tool.gmail.send_email"),
    ).toEqual({
      ref: "@acme/digest",
      botId: "bot_1",
      event: "tool.gmail.send_email",
    });
  });

  it("is null for widget events and junk", () => {
    expect(parseBotEventType("Notepad[12].saved")).toBe(null);
    expect(parseBotEventType("")).toBe(null);
    expect(parseBotEventType(null)).toBe(null);
  });
});

describe("eventText / eventKind", () => {
  it("names events plainly", () => {
    expect(eventText("completed")).toBe("completed");
    expect(eventText("failed")).toBe("failed");
    expect(eventText("tool.algolia.search_index")).toBe(
      "tool · algolia.search_index",
    );
    expect(eventKind("failed")).toBe("failed");
    expect(eventKind("completed")).toBe("completed");
    expect(eventKind("tool.x.y")).toBe("tool");
  });
});

describe("diagramEdges (TEAM-014)", () => {
  it("one edge per subscription to another team bot; no lead, self, other-dashboard or deleted bots", () => {
    expect(diagramEdges(members, lead)).toEqual([
      {
        key: `reader|${ev("planner", "completed")}`,
        eventType: ev("planner", "completed"),
        note: null,
        from: "planner",
        to: "reader",
        event: "completed",
        kind: "completed",
        label: "Plan ready",
      },
      {
        key: `checker|${ev("reader", "completed")}`,
        eventType: ev("reader", "completed"),
        note: null,
        from: "reader",
        to: "checker",
        event: "completed",
        kind: "completed",
        label: null,
      },
      {
        key: `checker|${ev("reader", "tool.algolia.search_index")}`,
        eventType: ev("reader", "tool.algolia.search_index"),
        note: null,
        from: "reader",
        to: "checker",
        event: "tool.algolia.search_index",
        kind: "tool",
        label: null,
      },
      {
        key: `matcher|${ev("checker", "failed")}`,
        eventType: ev("checker", "failed"),
        note: null,
        from: "checker",
        to: "matcher",
        event: "failed",
        kind: "failed",
        label: null,
      },
    ]);
  });

  it("no members → no edges", () => {
    expect(diagramEdges([], lead)).toEqual([]);
    expect(diagramEdges(undefined, null)).toEqual([]);
  });
});

describe("runsAfter / thenTriggers", () => {
  const nameOf = (id) =>
    ({ planner: "Planner", reader: "Reader", elsewhere: "Far Bot" })[id] ||
    null;

  it("runsAfter lists every bot it listens to, marking off-team and missing ones", () => {
    expect(runsAfter(checker, [lead, ...members], nameOf)).toEqual([
      { botId: "reader", name: "Reader", event: "completed", offTeam: false },
      {
        botId: "reader",
        name: "Reader",
        event: "tool.algolia.search_index",
        offTeam: false,
      },
      {
        botId: "elsewhere",
        name: "Far Bot",
        event: "completed",
        offTeam: true,
      },
      { botId: "lead", name: "Lead", event: "completed", offTeam: false },
      { botId: "checker", name: "Checker", event: "failed", offTeam: false },
      { botId: "gone", name: "Deleted bot", event: "completed", offTeam: true },
    ]);
  });

  it("thenTriggers lists the team bots that run after it", () => {
    expect(thenTriggers("reader", members)).toEqual([
      { botId: "checker", name: "Checker", event: "completed" },
      { botId: "checker", name: "Checker", event: "tool.algolia.search_index" },
    ]);
    expect(thenTriggers("matcher", members)).toEqual([]);
  });
});

describe("diagramLayout", () => {
  it("one row when it fits, centred, cards at most 240 wide", () => {
    const l = diagramLayout({ width: 1200, count: 4 });
    expect(l.cols).toBe(4);
    expect(l.cardW).toBe(240);
    expect(l.cards).toHaveLength(4);
    expect(new Set(l.cards.map((c) => c.y)).size).toBe(1);
    const first = l.cards[0].x;
    const last = l.cards[3].x + l.cardW;
    expect(Math.round(first)).toBe(Math.round(1200 - last));
    expect(l.lead.x + l.lead.w / 2).toBe(600);
  });

  it("wraps onto more rows rather than shrinking cards below 200", () => {
    const l = diagramLayout({ width: 700, count: 4 });
    expect(l.cols).toBe(3);
    expect(l.cardW).toBeGreaterThanOrEqual(200);
    expect(l.cards[3].y).toBeGreaterThan(l.cards[0].y);
    expect(l.height).toBeGreaterThan(l.cards[3].y);
  });

  it("no members → just the lead", () => {
    const l = diagramLayout({ width: 900, count: 0 });
    expect(l.cards).toEqual([]);
    expect(l.lead.w).toBeGreaterThan(0);
  });
});

describe("loopEdges (TEAM-014 AC11)", () => {
  it("marks every line that's part of a loop", () => {
    const edges = [
      { key: "1", from: "a", to: "b" },
      { key: "2", from: "b", to: "c" },
      { key: "3", from: "c", to: "a" },
      { key: "4", from: "c", to: "d" },
    ];
    expect([...loopEdges(edges)].sort()).toEqual(["1", "2", "3"]);
  });

  it("no loop → nothing marked", () => {
    expect(
      loopEdges([
        { key: "1", from: "a", to: "b" },
        { key: "2", from: "b", to: "c" },
      ]).size,
    ).toBe(0);
  });
});

describe("eventChoices (TEAM-014 AC8)", () => {
  const bot = {
    id: "bot_1",
    name: "Reader",
    mcpServers: ["Algolia HR", "Unknown"],
    toolSelections: { "Algolia HR": ["search_index"] },
  };
  const sources = [
    {
      name: "Algolia HR",
      type: "algolia",
      tools: ["search_index", "recommend"],
    },
  ];

  it("Completed, Failed, then each tool the bot may use (its selection)", () => {
    expect(eventChoices(bot, sources)).toEqual([
      { event: "completed", label: "Completed" },
      { event: "failed", label: "Failed" },
      {
        event: "tool.algolia.search_index",
        label: "Algolia HR › search_index",
      },
    ]);
  });

  it("works for a bot without a saved ref (local/<slug>)", () => {
    expect(
      eventChoices({ id: "bot_2", name: "X" }, []).map((e) => e.event),
    ).toEqual(["completed", "failed"]);
  });
});

describe("addTrigger / updateTrigger / removeTrigger", () => {
  const source = { id: "bot_1", name: "Schema Planner" };
  const target = {
    id: "bot_2",
    name: "Record Reader",
    subscriptions: [{ eventType: "Notepad[1].saved", label: "keep me" }],
  };

  it("adds the same subscription the Settings picker makes, plus the note", () => {
    const next = addTrigger(
      target,
      source,
      "completed",
      "Completed",
      "Read them.",
    );
    expect(next.subscriptions).toHaveLength(2);
    expect(next.subscriptions[1]).toEqual({
      eventType: "bot:local/schema-planner[bot_1].completed",
      source: {
        kind: "bot",
        ref: "local/schema-planner",
        instanceId: "bot_1",
        event: "completed",
      },
      label: "Schema Planner › Completed",
      note: "Read them.",
    });
    expect(target.subscriptions).toHaveLength(1);
  });

  it("an empty note isn't stored; adding an existing trigger again doesn't duplicate it", () => {
    const once = addTrigger(target, source, "completed", "Completed", "  ");
    expect(once.subscriptions[1].note).toBeUndefined();
    const twice = addTrigger(once, source, "completed", "Completed", "x");
    expect(twice.subscriptions).toHaveLength(2);
    expect(twice.subscriptions[1].note).toBe("x");
  });

  it("updateTrigger changes the event and note in place; removeTrigger drops only it", () => {
    const withTrigger = addTrigger(
      target,
      source,
      "completed",
      "Completed",
      "a",
    );
    const old = "bot:local/schema-planner[bot_1].completed";
    const changed = updateTrigger(
      withTrigger,
      old,
      source,
      "failed",
      "Failed",
      "b",
    );
    expect(changed.subscriptions.map((x) => x.eventType)).toEqual([
      "Notepad[1].saved",
      "bot:local/schema-planner[bot_1].failed",
    ]);
    expect(changed.subscriptions[1].note).toBe("b");
    const removed = removeTrigger(
      changed,
      "bot:local/schema-planner[bot_1].failed",
    );
    expect(removed.subscriptions).toEqual([
      { eventType: "Notepad[1].saved", label: "keep me" },
    ]);
  });
});
