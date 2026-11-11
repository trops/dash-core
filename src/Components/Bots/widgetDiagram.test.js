import { applyWiringChanges } from "../../utils/listenerResolution";
import {
  BOT_RESULTS,
  botListeners,
  diagramWidgets,
  widgetSub,
  widgetEdges,
  wireHandlerName,
  wireChange,
  wireEventString,
  unwireChange,
  widgetLayout,
} from "./widgetDiagram";

const shop = { id: "bot_shop", name: "Shopping Helper" };
const reader = { id: "bot_read", name: "Email Reader", ref: "trops/reader" };

const grid = (id, cells) => ({
  id,
  component: "LayoutGridContainer",
  dashboardId: 7,
  grid: { rows: 1, cols: 3, ...cells },
});
const list = {
  id: 11,
  component: "me.notes.ShoppingList",
  dashboardId: 7,
  parent: 1,
  userPrefs: { title: "Shopping List" },
};
const notice = {
  id: 12,
  component: "me.board.NoticeBoard",
  dashboardId: 7,
  parent: 1,
  listeners: {
    showMessage: ["bot:local/shopping-helper[bot_shop].completed"],
    onClick: ["Other[3].clicked"],
  },
};
const results = {
  id: 13,
  component: BOT_RESULTS,
  dashboardId: 7,
  parent: 1,
  userPrefs: { botId: "bot_read" },
};
const config = {
  "me.board.NoticeBoard": {
    name: "Notice Board",
    eventHandlers: ["showMessage"],
  },
  "me.notes.ShoppingList": { name: "ShoppingList" },
};
const getConfig = (c) => config[c] || null;
const ws = {
  id: 7,
  layout: [
    grid(1, {
      1.1: { component: 11 },
      1.2: { component: 12 },
      1.3: { component: 13 },
    }),
    list,
    notice,
    results,
  ],
};

describe("diagramWidgets", () => {
  const widgets = diagramWidgets(ws, getConfig);
  test("lists the dashboard's widgets, not its grids", () => {
    expect(widgets.map((w) => w.label)).toEqual([
      "Shopping List",
      "Notice Board",
      expect.any(String),
    ]);
    expect(widgets[0]).toMatchObject({
      itemId: "11",
      gridItemId: 1,
      cellNumber: "1.1",
      handlers: [],
      listens: [],
      resultsBotId: null,
    });
  });
  test("says what each listens for and which bot a Bot results widget shows", () => {
    expect(widgets[1].handlers).toEqual(["showMessage"]);
    expect(widgets[1].listens).toEqual([
      {
        handlerName: "showMessage",
        botId: "bot_shop",
        event: "completed",
        raw: "bot:local/shopping-helper[bot_shop].completed",
      },
    ]);
    expect(widgets[2].resultsBotId).toBe("bot_read");
  });
  test("names each page when there are several, and counts a widget once", () => {
    const paged = {
      id: 7,
      layout: [list],
      pages: [
        { id: "p1", name: "Home", layout: [list] },
        { id: "p2", name: "Kitchen", layout: [notice] },
      ],
    };
    const w = diagramWidgets(paged, getConfig);
    expect(w.map((x) => [x.label, x.page, x.pageId])).toEqual([
      ["Shopping List", "Home", "p1"],
      ["Notice Board", "Kitchen", "p2"],
    ]);
  });
  test("leaves out widgets stamped for another dashboard", () => {
    const other = { ...list, id: 99, dashboardId: 8 };
    expect(diagramWidgets({ id: 7, layout: [other] }, getConfig)).toEqual([]);
  });
  test("copes with no workspace", () => {
    expect(diagramWidgets(null)).toEqual([]);
  });
});

describe("botListeners and widgetSub", () => {
  test("only bot sources count", () => {
    expect(botListeners(notice)).toHaveLength(1);
    expect(botListeners({})).toEqual([]);
  });
  test("a widget's line", () => {
    const [l, n, r] = diagramWidgets(ws, getConfig);
    const nameOf = (id) =>
      ({ bot_shop: "Shopping Helper", bot_read: "Email Reader" })[id];
    expect(widgetSub(l, nameOf)).toBe("No listener yet");
    expect(widgetSub(n, nameOf)).toBe("Shows what Shopping Helper sends");
    expect(widgetSub(r, nameOf)).toBe("Shows Email Reader's answers");
    expect(widgetSub({ ...l, handlers: ["a", "b", "c"] })).toBe(
      "Listens for: a, b…",
    );
  });
});

describe("widgetEdges", () => {
  const widgets = diagramWidgets(ws, getConfig);
  test("a line per bot listener and per Bot results widget on the team", () => {
    const edges = widgetEdges(widgets, [shop, reader]);
    expect(edges.map((e) => [e.from, e.widget, e.event, e.kind])).toEqual([
      ["bot_shop", "me.board.NoticeBoard|12", "completed", "completed"],
      ["bot_read", `${BOT_RESULTS}|13`, "results", "results"],
    ]);
  });
  test("bots off the team aren't drawn", () => {
    expect(widgetEdges(widgets, [reader]).map((e) => e.from)).toEqual([
      "bot_read",
    ]);
  });
});

describe("wireHandlerName", () => {
  test("names it for the bot and the event", () => {
    expect(wireHandlerName(shop, "completed")).toBe("showShoppingHelperAnswer");
    expect(wireHandlerName(shop, "failed")).toBe("showShoppingHelperProblem");
    expect(wireHandlerName(shop, "result.weekly_list")).toBe(
      "showShoppingHelperWeeklyList",
    );
    expect(wireHandlerName(shop, "tool.notes.write")).toBe(
      "showShoppingHelperToolResult",
    );
    expect(wireHandlerName({ name: "" }, "completed")).toBe("showBotAnswer");
  });
  test("never one the widget already has", () => {
    expect(
      wireHandlerName(shop, "completed", [
        "showShoppingHelperAnswer",
        "showShoppingHelperAnswer2",
      ]),
    ).toBe("showShoppingHelperAnswer3");
  });
});

describe("wireChange / unwireChange", () => {
  const [l, n] = diagramWidgets(ws, getConfig);
  test("adds the listener the runtime subscribes to", () => {
    const next = applyWiringChanges(ws, {
      adds: [wireChange(l, shop, "completed", "showShoppingHelperAnswer")],
    });
    const item = next.layout.find((i) => i.id === 11);
    expect(item.listeners).toEqual({
      showShoppingHelperAnswer: [wireEventString(shop, "completed")],
    });
    expect(wireEventString(shop, "completed")).toBe(
      "bot:local/shopping-helper[bot_shop].completed",
    );
    expect(wireEventString(reader, "failed")).toBe(
      "bot:trops/reader[bot_read].failed",
    );
  });
  test("removes exactly that line", () => {
    const [edge] = widgetEdges([n], [shop]);
    const next = applyWiringChanges(ws, { removes: [unwireChange(n, edge)] });
    const item = next.layout.find((i) => i.id === 12);
    expect(item.listeners.showMessage || []).toEqual([]);
    expect(item.listeners.onClick).toEqual(["Other[3].clicked"]);
  });
});

describe("widgetLayout", () => {
  test("a column right of the team", () => {
    const l = widgetLayout({ width: 1000, count: 3, side: true });
    expect(l.side).toBe(true);
    expect(l.cards.map((c) => c.x)).toEqual([724, 724, 724]);
    expect(l.cards.map((c) => c.y)).toEqual([48, 128, 208]);
    expect(l.bottom).toBe(288);
  });
  test("rows below it when there's no room", () => {
    const l = widgetLayout({ width: 500, count: 3, top: 400 });
    expect(l.side).toBe(false);
    expect(l.cards[0].y).toBe(432);
    expect(l.cards[2].y).toBeGreaterThan(l.cards[0].y);
    expect(l.bottom).toBeGreaterThan(l.cards[2].y);
  });
});
