import { diagramLayout, neighbourLine, pillWidth } from "./teamDiagram";
import { routeWidgets } from "./widgetDiagram";

// The Bots diagram's geometry (polish, 2026-11): lines run through gaps,
// never across a card, and no label sits on a card.

const CARD_H = 80;
const W_CARD_H = 64;
const W_COL = 260;

const bots = (n) => Array.from({ length: n }, (_, i) => ({ id: `b${i}` }));
const widget = (key) => ({ key });
const results = (bot, w) => ({
  key: `r|${w}`,
  from: bot,
  widget: w,
  kind: "results",
  event: "results",
});
const listens = (bot, w, event = "completed") => ({
  key: `w|${w}|${bot}|${event}`,
  from: bot,
  widget: w,
  kind: event,
  event,
});

function route({ width, side, members, widgets, edges, outX = {} }) {
  const teamWidth = side ? width - W_COL - 40 : width;
  const layout = diagramLayout({
    width: teamWidth,
    count: members.length,
    cardH: CARD_H,
    gap: 80,
    minW: 184,
  });
  const team = {
    cards: members.map((b, i) => ({
      id: b.id,
      ...layout.cards[i],
      w: layout.cardW,
      ...(outX[b.id] != null ? { outX: outX[b.id] } : {}),
    })),
    cols: layout.cols,
    cardH: CARD_H,
    gap: layout.gap,
    lead: layout.lead,
  };
  const r = routeWidgets({
    width: Math.max(width, layout.width),
    side,
    team,
    widgets,
    edges,
    below: team.cards[team.cards.length - 1].y + CARD_H,
    colW: W_COL,
    cardH: W_CARD_H,
    labelOf: (e) => (e.kind === "results" ? "shows answers" : e.event),
  });
  const rects = [
    ...team.cards.map((c) => ({ x: c.x, y: c.y, w: c.w, h: CARD_H })),
    { x: layout.lead.x, y: layout.lead.y, w: layout.lead.w, h: CARD_H },
    ...Object.values(r.cards).map((c) => ({
      x: c.x,
      y: c.y,
      w: c.w,
      h: W_CARD_H,
    })),
  ];
  return { r, team, rects };
}

// Inside a card (its edges don't count: lines start and end on them).
const inside = (rect, x1, y1, x2, y2) =>
  Math.max(x1, x2) > rect.x + 1 &&
  Math.min(x1, x2) < rect.x + rect.w - 1 &&
  Math.max(y1, y2) > rect.y + 1 &&
  Math.min(y1, y2) < rect.y + rect.h - 1;

function expectClear({ r, rects }) {
  for (const line of r.lines) {
    for (const [x1, y1, x2, y2] of line.segments) {
      // Axis-aligned only.
      expect(x1 === x2 || y1 === y2).toBe(true);
      for (const rect of rects) {
        expect({
          line: line.key,
          crosses: inside(rect, x1, y1, x2, y2),
        }).toEqual({
          line: line.key,
          crosses: false,
        });
      }
    }
    const l = line.label;
    for (const rect of rects) {
      expect({
        label: line.key,
        onCard: inside(
          rect,
          l.x - l.w / 2,
          l.y - l.h / 2,
          l.x + l.w / 2,
          l.y + l.h / 2,
        ),
      }).toEqual({ label: line.key, onCard: false });
    }
  }
  // Labels don't sit on each other either.
  for (let i = 0; i < r.lines.length; i++) {
    for (let j = i + 1; j < r.lines.length; j++) {
      const a = r.lines[i].label;
      const b = r.lines[j].label;
      const overlap =
        Math.abs(a.x - b.x) < (a.w + b.w) / 2 &&
        Math.abs(a.y - b.y) < (a.h + b.h) / 2;
      expect({ pair: [r.lines[i].key, r.lines[j].key], overlap }).toEqual({
        pair: [r.lines[i].key, r.lines[j].key],
        overlap: false,
      });
    }
  }
}

describe("routeWidgets: wide (a column right of the team)", () => {
  const members = bots(3);
  const widgets = [widget("w2"), widget("free"), widget("w0")];
  const edges = [results("b0", "w0"), listens("b2", "w2"), listens("b1", "w2")];
  const out = route({ width: 1240, side: true, members, widgets, edges });

  it("puts every widget in one column, in the order of the bots they show", () => {
    const { cards } = out.r;
    const xs = new Set(Object.values(cards).map((c) => c.x));
    expect(xs.size).toBe(1);
    expect(cards.w0.y).toBeLessThan(cards.w2.y);
    expect(cards.w2.y).toBeLessThan(cards.free.y);
    // The first sits level with its bot's row.
    const b0 = out.team.cards[0];
    expect(cards.w0.y).toBe(b0.y + (CARD_H - W_CARD_H) / 2);
  });

  it("no line crosses a card and no label sits on one", () => {
    expect(out.r.lines).toHaveLength(3);
    expectClear(out);
  });

  it("a widget level with the last bot of the row gets a straight line", () => {
    const one = route({
      width: 1240,
      side: true,
      members,
      widgets: [widget("w2")],
      edges: [listens("b2", "w2")],
    });
    expect(one.r.lines[0].segments).toHaveLength(1);
    expectClear(one);
  });

  it("a bot with checks: its line leaves from below its checks card (CHK-002)", () => {
    const { r } = route({
      width: 1240,
      side: true,
      members,
      widgets: [widget("w0")],
      edges: [results("b0", "w0")],
      outX: { b0: 150 },
    });
    expect(r.lines[0].segments[0][0]).toBe(150);
  });

  it("lines into one widget come in at different heights", () => {
    const into = out.r.lines.filter((l) => l.widget === "w2");
    const ys = into.map((l) => l.segments[l.segments.length - 1][3]);
    expect(new Set(ys).size).toBe(2);
  });
});

describe("routeWidgets: narrow (each widget under its bot's column)", () => {
  it("one row: straight down, label just above the widget", () => {
    const out = route({
      width: 700,
      side: false,
      members: bots(2),
      widgets: [widget("w1"), widget("w0")],
      edges: [results("b0", "w0"), results("b1", "w1")],
    });
    const { cards } = out.r;
    expect(cards.w0.x).toBe(out.team.cards[0].x);
    expect(cards.w1.x).toBe(out.team.cards[1].x);
    for (const l of out.r.lines) expect(l.segments).toHaveLength(1);
    expectClear(out);
  });

  it("two rows, stacked and unfed widgets: lines go round through the gaps", () => {
    const out = route({
      width: 700,
      side: false,
      members: bots(4),
      widgets: [
        widget("free"),
        widget("w3b"),
        widget("w3"),
        widget("w1"),
        widget("w0"),
      ],
      edges: [
        results("b0", "w0"),
        results("b1", "w1"),
        results("b3", "w3"),
        listens("b3", "w3b"),
        listens("b2", "w1", "failed"),
      ],
    });
    expect(out.team.cols).toBe(2);
    const { cards } = out.r;
    const col = (i) => out.team.cards[i].x;
    expect(cards.w0.x).toBe(col(0));
    expect(cards.w1.x).toBe(col(1));
    expect(cards.w3.x).toBe(col(1));
    // A bot with two widgets: stacked in its column, in page order.
    expect(cards.w3b.x).toBe(col(1));
    expect(cards.w3.y).toBeGreaterThan(cards.w3b.y);
    const teamBottom = Math.max(...out.team.cards.map((c) => c.y + CARD_H));
    for (const c of Object.values(cards))
      expect(c.y).toBeGreaterThan(teamBottom);
    expectClear(out);
  });
});

describe("neighbourLine", () => {
  const a = { x: 100, y: 200, w: 184, row: 0, col: 0 };
  const b = { x: 364, y: 200, w: 184, row: 0, col: 1 };

  it("straight across the gap, label in the gap", () => {
    const l = neighbourLine(a, b, { cardH: 80, text: "completed" });
    expect(l.segments).toEqual([[284, 240, 364, 240]]);
    expect(l.mx).toBe(324);
    expect(pillWidth("completed")).toBeLessThan(80);
  });

  it("both ways: at a third and two thirds", () => {
    const there = neighbourLine(a, b, {
      cardH: 80,
      slot: 0,
      slots: 2,
      text: "completed",
    });
    const back = neighbourLine(b, a, {
      cardH: 80,
      slot: 1,
      slots: 2,
      text: "failed",
    });
    expect(there.my).toBe(227);
    expect(back.my).toBe(253);
    expect(back.segments[0][0]).toBe(364);
    expect(back.segments[0][2]).toBe(284);
  });

  it("not neighbours, or a label too long for the gap: null (a curve instead)", () => {
    const far = { ...b, x: 628, col: 2 };
    expect(neighbourLine(a, far, { cardH: 80, text: "completed" })).toBeNull();
    expect(
      neighbourLine(a, b, { cardH: 80, text: "tool · gmail.send_email" }),
    ).toBeNull();
    expect(
      neighbourLine(a, { ...b, row: 1 }, { cardH: 80, text: "x" }),
    ).toBeNull();
  });
});
