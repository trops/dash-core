import {
  parseBotEventType,
  eventText,
  eventKind,
  diagramEdges,
  diagramLayout,
  runsAfter,
  thenTriggers,
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
        from: "planner",
        to: "reader",
        event: "completed",
        kind: "completed",
        label: "Plan ready",
      },
      {
        key: `checker|${ev("reader", "completed")}`,
        from: "reader",
        to: "checker",
        event: "completed",
        kind: "completed",
        label: null,
      },
      {
        key: `checker|${ev("reader", "tool.algolia.search_index")}`,
        from: "reader",
        to: "checker",
        event: "tool.algolia.search_index",
        kind: "tool",
        label: null,
      },
      {
        key: `matcher|${ev("checker", "failed")}`,
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
