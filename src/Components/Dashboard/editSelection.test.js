import {
  findWidgetCell,
  relatedTo,
  widgetsOf,
  formatMonthCost,
} from "./editSelection";

/**
 * Select-to-edit (create-entry phase 1c, CRE-006): what's selected, where a
 * widget sits, what's connected to it, and what its bots cost.
 */

const layout = [
  {
    id: 1,
    parent: 0,
    grid: { rows: 1, cols: 2, 1.1: { component: 2 }, 1.2: { component: 3 } },
  },
  {
    id: 2,
    uuid: "d-Emails-2",
    component: "ai-built.emails.Emails",
    parent: 1,
    listeners: { onEmails: ["bot:local/triage[bot_t].result.important"] },
  },
  {
    id: 3,
    uuid: "d-Check-3",
    component: "ai-built.check.Check",
    parent: 1,
    listeners: {},
  },
];
const bots = [
  { id: "bot_t", name: "Triage", subscriptions: [] },
  {
    id: "bot_r",
    name: "Reader",
    subscriptions: [{ eventType: "ai-built.check.Check[3].checkNow" }],
  },
  { id: "bot_n", name: "Notifier", subscriptions: [] },
];

describe("findWidgetCell", () => {
  test("finds the grid and cell holding a widget", () => {
    expect(findWidgetCell(layout, 3)).toEqual({
      gridItemId: 1,
      cellNumber: "1.2",
    });
  });

  test("null when the widget isn't in a grid", () => {
    expect(findWidgetCell(layout, 99)).toBeNull();
    expect(findWidgetCell(null, 2)).toBeNull();
  });
});

describe("widgetsOf", () => {
  test("lists the widgets in a layout (not the grid containers)", () => {
    expect(widgetsOf(layout).map((w) => w.uuid)).toEqual([
      "d-Emails-2",
      "d-Check-3",
    ]);
  });
});

describe("relatedTo", () => {
  const widgets = widgetsOf(layout);

  test("a widget is related to the bot that feeds it", () => {
    const r = relatedTo(
      { kind: "widget", uuid: "d-Emails-2" },
      { widgets, bots },
    );
    expect([...r.bots]).toEqual(["bot_t"]);
    expect(r.widgets.size).toBe(0);
  });

  test("a widget is related to the bot it starts", () => {
    const r = relatedTo(
      { kind: "widget", uuid: "d-Check-3" },
      { widgets, bots },
    );
    expect([...r.bots]).toEqual(["bot_r"]);
  });

  test("a bot is related to the widgets it feeds and the widgets that start it", () => {
    expect([
      ...relatedTo({ kind: "bot", botId: "bot_t" }, { widgets, bots }).widgets,
    ]).toEqual(["d-Emails-2"]);
    expect([
      ...relatedTo({ kind: "bot", botId: "bot_r" }, { widgets, bots }).widgets,
    ]).toEqual(["d-Check-3"]);
  });

  test("nothing selected, or an unconnected bot, relates to nothing", () => {
    const none = relatedTo(null, { widgets, bots });
    expect(none.widgets.size + none.bots.size).toBe(0);
    const n = relatedTo({ kind: "bot", botId: "bot_n" }, { widgets, bots });
    expect(n.widgets.size).toBe(0);
  });
});

describe("formatMonthCost", () => {
  test("a bot's spend this month", () => {
    expect(formatMonthCost({ "bot:bot_t": { usd: 14.2 } }, "bot_t")).toBe(
      "$14.20 this month",
    );
    expect(formatMonthCost({ "bot:bot_t": { usd: 0.004 } }, "bot_t")).toBe(
      "<$0.01 this month",
    );
  });

  test("tokens when there's no dollar figure (e.g. Claude Code plan)", () => {
    expect(
      formatMonthCost(
        { "bot:bot_t": { usd: 0, inputTokens: 12000, outputTokens: 3400 } },
        "bot_t",
      ),
    ).toBe("15.4k tokens this month");
  });

  test("nothing yet", () => {
    expect(formatMonthCost({}, "bot_t")).toBe("No runs this month");
    expect(formatMonthCost(null, "bot_t")).toBe("No runs this month");
  });
});
