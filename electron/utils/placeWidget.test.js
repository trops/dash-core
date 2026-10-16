/**
 * placeWidget.test.js — add a widget to a dashboard's layout: next empty grid
 * cell, a new row when the grid is full, and saved settings (userPrefs).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  placeWidget,
  setWidgetPrefs,
  addWidgetListener,
  removeWidgets,
  blankDashboard,
} = require("./placeWidget");

function dashboard(cells) {
  const grid = { rows: 1, cols: 2, gap: "gap-2" };
  grid["1.1"] = { component: cells[0], hide: false };
  grid["1.2"] = { component: cells[1], hide: false };
  return {
    id: 7,
    name: "Daily Brief",
    layout: [
      { id: 1, order: 1, component: "LayoutGridContainer", parent: 0, grid },
      ...cells.filter(Boolean).map((id) => ({
        id,
        order: id,
        component: "trops.gcal.Agenda",
        parent: 1,
      })),
    ],
  };
}

describe("placeWidget", () => {
  it("puts the widget in the next empty cell with its settings", () => {
    const ws = dashboard([2, null]);
    const r = placeWidget(ws, {
      component: "dash.bots.BotResults",
      userPrefs: { botId: "bot_i" },
    });
    assert.deepEqual(r.cell, { row: 1, col: 2 });
    const item = r.workspace.layout.find((i) => i.id === r.widgetId);
    assert.equal(r.widgetId, 3);
    assert.equal(item.component, "dash.bots.BotResults");
    assert.equal(item.parent, 1);
    assert.deepEqual(item.userPrefs, { botId: "bot_i" });
    assert.equal(r.workspace.layout[0].grid["1.2"].component, 3);
    // The input is not mutated.
    assert.equal(ws.layout[0].grid["1.2"].component, null);
    assert.equal(ws.layout.length, 2);
  });

  it("adds a row when the grid is full", () => {
    const ws = dashboard([2, 3]);
    const r = placeWidget(ws, { component: "dash.bots.BotActivity" });
    const grid = r.workspace.layout[0].grid;
    assert.equal(grid.rows, 2);
    assert.deepEqual(r.cell, { row: 2, col: 1 });
    assert.equal(grid["2.1"].component, r.widgetId);
    assert.deepEqual(grid["2.2"], { component: null, hide: false });
  });

  it("appends to a dashboard without a grid", () => {
    const ws = {
      id: 8,
      layout: [{ id: 1, component: "Container", parent: 0 }],
    };
    const r = placeWidget(ws, { component: "dash.bots.BotResults" });
    assert.equal(r.cell, null);
    assert.equal(r.workspace.layout.find((i) => i.id === r.widgetId).parent, 1);
  });

  it("refuses a missing component", () => {
    assert.throws(() => placeWidget(dashboard([null, null]), {}), /component/);
  });
});

describe("setWidgetPrefs", () => {
  it("merges settings into one widget and leaves the rest alone", () => {
    const ws = dashboard([2, null]);
    ws.layout[1].userPrefs = { title: "Agenda" };
    const out = setWidgetPrefs(ws, 2, { botId: "bot_a" });
    assert.deepEqual(out.layout[1].userPrefs, {
      title: "Agenda",
      botId: "bot_a",
    });
    assert.equal(ws.layout[1].userPrefs.botId, undefined);
  });

  it("returns null for a widget that isn't on the dashboard", () => {
    assert.equal(
      setWidgetPrefs(dashboard([2, null]), 99, { botId: "x" }),
      null,
    );
  });
});

describe("placeWidget — dashboards with pages", () => {
  function paged() {
    const page = dashboard([2, 3]);
    return {
      id: 7,
      layout: JSON.parse(JSON.stringify(page.layout)),
      pages: [
        {
          id: "page-a",
          name: "Page 1",
          layout: JSON.parse(JSON.stringify(page.layout)),
        },
        {
          id: "page-b",
          name: "Page 2",
          layout: dashboard([null, null]).layout,
        },
      ],
      activePageId: "page-a",
    };
  }

  it("places into the active page (what the dashboard shows) and keeps layout in step", () => {
    const r = placeWidget(paged(), {
      component: "dash.bots.BotResults",
      userPrefs: { botId: "b" },
    });
    const pageA = r.workspace.pages[0];
    assert.equal(pageA.layout[0].grid.rows, 2);
    assert.ok(
      pageA.layout.some(
        (i) => i.id === r.widgetId && i.component === "dash.bots.BotResults",
      ),
    );
    assert.deepEqual(r.workspace.layout, pageA.layout);
    // Other pages are untouched.
    assert.equal(r.workspace.pages[1].layout.length, 1);
  });

  it("uses the first page when no active page is recorded", () => {
    const ws = paged();
    delete ws.activePageId;
    const r = placeWidget(ws, { component: "dash.bots.BotActivity" });
    assert.ok(r.workspace.pages[0].layout.some((i) => i.id === r.widgetId));
  });

  it("links a bot widget wherever it is, without touching other widgets with the same id", () => {
    const ws = paged();
    const placed = placeWidget(ws, { component: "dash.bots.BotResults" });
    // Page b happens to have an item with the same id but a different component.
    placed.workspace.pages[1].layout.push({
      id: placed.widgetId,
      component: "trops.other.Thing",
      userPrefs: {},
    });
    const out = setWidgetPrefs(
      placed.workspace,
      placed.widgetId,
      { botId: "bot_x" },
      "dash.bots.BotResults",
    );
    const inA = out.pages[0].layout.find((i) => i.id === placed.widgetId);
    const inB = out.pages[1].layout.find((i) => i.id === placed.widgetId);
    assert.equal(inA.userPrefs.botId, "bot_x");
    assert.equal(inB.userPrefs.botId, undefined);
    assert.equal(
      out.layout.find((i) => i.id === placed.widgetId).userPrefs.botId,
      "bot_x",
    );
  });
});

describe("placeWidget — page and cell (CRE-011 3c)", () => {
  const grid = (taken = {}) => [
    {
      id: 1,
      component: "LayoutGridContainer",
      parent: 0,
      grid: { rows: 2, cols: 2, ...taken },
    },
  ];
  const ws = () => ({
    activePageId: "b",
    pages: [
      { id: "a", name: "Home", layout: grid() },
      { id: "b", name: "Second", layout: grid() },
    ],
    layout: grid(),
  });

  it("places on a named page; the mirror keeps showing the shown page", () => {
    const { workspace } = placeWidget(ws(), { component: "W", page: "Home" });
    assert.ok(workspace.pages[0].layout.some((i) => i.component === "W"));
    assert.ok(!workspace.pages[1].layout.some((i) => i.component === "W"));
    assert.ok(!workspace.layout.some((i) => i.component === "W"));
  });

  it("places in the asked-for cell", () => {
    const { workspace, cell, widgetId } = placeWidget(ws(), {
      component: "W",
      row: 2,
      col: 2,
    });
    assert.deepEqual(cell, { row: 2, col: 2 });
    assert.equal(workspace.pages[1].layout[0].grid["2.2"].component, widgetId);
    assert.deepEqual(workspace.layout, workspace.pages[1].layout);
  });

  it("refuses a cell outside the grid, a taken cell, or an unknown page", () => {
    assert.throws(
      () => placeWidget(ws(), { component: "W", row: 3, col: 1 }),
      /outside the 2×2 grid/,
    );
    const taken = ws();
    taken.pages[1].layout[0].grid["1.1"] = { component: 5, hide: false };
    assert.throws(
      () => placeWidget(taken, { component: "W", row: 1, col: 1 }),
      /already holds a widget/,
    );
    assert.throws(
      () => placeWidget(ws(), { component: "W", page: "Nope" }),
      /No page/,
    );
  });
});

describe("addWidgetListener (phase 4d-2)", () => {
  const EV = "bot:local/greeter[bot_9].result.greeting";
  it("adds the event under the handler, once", () => {
    const ws = dashboard([2, null]);
    const once = addWidgetListener(ws, 2, "showGreeting", EV);
    const twice = addWidgetListener(once, 2, "showGreeting", EV);
    assert.deepEqual(twice.layout[1].listeners, { showGreeting: [EV] });
    assert.equal(ws.layout[1].listeners, undefined);
  });
  it("writes every layout that has the widget (pages and the mirror)", () => {
    const page = dashboard([2, null]);
    const ws = {
      id: 7,
      layout: JSON.parse(JSON.stringify(page.layout)),
      pages: [{ id: "p1", name: "One", layout: page.layout }],
    };
    const out = addWidgetListener(ws, 2, "h", EV);
    assert.deepEqual(out.layout[1].listeners, { h: [EV] });
    assert.deepEqual(out.pages[0].layout[1].listeners, { h: [EV] });
  });
  it("null when the widget isn't there or is another component", () => {
    assert.equal(addWidgetListener(dashboard([2, null]), 99, "h", EV), null);
    assert.equal(
      addWidgetListener(dashboard([2, null]), 2, "h", EV, "other.pkg.W"),
      null,
    );
  });
});

describe("removeWidgets — Remove on a dashboard you have (5e-2b)", () => {
  function paged() {
    const page = dashboard([2, 3]);
    return {
      id: 7,
      layout: JSON.parse(JSON.stringify(page.layout)),
      pages: [
        {
          id: "page-a",
          name: "Page 1",
          layout: JSON.parse(JSON.stringify(page.layout)),
        },
        {
          id: "page-b",
          name: "Page 2",
          layout: dashboard([null, null]).layout,
        },
      ],
      activePageId: "page-a",
    };
  }

  it("takes a placed widget off its page and the mirror, and empties its cell", () => {
    const placed = placeWidget(paged(), { component: "trops.clock.Clock" });
    assert.equal(placed.pageId, "page-a");
    const r = removeWidgets(placed.workspace, [
      {
        widgetId: placed.widgetId,
        component: "trops.clock.Clock",
        pageId: "page-a",
      },
    ]);
    assert.equal(r.removed, 1);
    const pageA = r.workspace.pages[0];
    assert.ok(!pageA.layout.some((i) => i.id === placed.widgetId));
    assert.ok(!r.workspace.layout.some((i) => i.id === placed.widgetId));
    const cell = pageA.layout[0].grid[`${placed.cell.row}.${placed.cell.col}`];
    assert.equal(cell.component, null);
    // The user's own widgets stay.
    assert.ok(pageA.layout.some((i) => i.id === 2));
    assert.ok(pageA.layout.some((i) => i.id === 3));
  });

  it("only touches the page it was placed on (ids repeat across pages)", () => {
    const ws = paged();
    ws.pages[1].layout.push({
      id: 4,
      component: "trops.clock.Clock",
      parent: 1,
    });
    const r = removeWidgets(ws, [
      { widgetId: 4, component: "trops.clock.Clock", pageId: "page-a" },
    ]);
    assert.equal(r.removed, 0);
    assert.ok(r.workspace.pages[1].layout.some((i) => i.id === 4));
  });

  it("skips a widget that's gone or now holds something else", () => {
    const r = removeWidgets(dashboard([2, 3]), [
      { widgetId: 9, component: "trops.clock.Clock", pageId: null },
      { widgetId: 2, component: "trops.clock.Clock", pageId: null },
    ]);
    assert.equal(r.removed, 0);
    assert.equal(r.workspace.layout.length, 3);
  });

  it("a dashboard without pages: off the top-level layout", () => {
    const placed = placeWidget(dashboard([2, null]), {
      component: "trops.clock.Clock",
    });
    assert.equal(placed.pageId, null);
    const r = removeWidgets(placed.workspace, [
      {
        widgetId: placed.widgetId,
        component: "trops.clock.Clock",
        pageId: null,
      },
    ]);
    assert.equal(r.removed, 1);
    assert.equal(r.workspace.layout[0].grid["1.2"].component, null);
  });
});

describe("placeWidget — a widget's connection (Create build fixes 2)", () => {
  it("selectedProviders goes on the placed widget", () => {
    const r = placeWidget(dashboard([null]), {
      component: "trops.algolia.AlgoliaRulesList",
      userPrefs: { indexName: "products" },
      selectedProviders: { algolia: "Algolia Demos" },
    });
    const item = r.workspace.layout.find((i) => i.id === r.widgetId);
    assert.deepEqual(item.selectedProviders, { algolia: "Algolia Demos" });
    assert.deepEqual(item.userPrefs, { indexName: "products" });
  });
  it("without one, the widget has none", () => {
    const r = placeWidget(dashboard([null]), { component: "a.b.C" });
    const item = r.workspace.layout.find((i) => i.id === r.widgetId);
    assert.equal("selectedProviders" in item, false);
  });
});

describe("blankDashboard — a plan's new dashboard (Create build fixes 2)", () => {
  const gridOf = (layout) => layout[0].grid;
  it("one page: a grid sized for its widgets, two columns", () => {
    const ws = blankDashboard({ id: 5, name: "Brief", count: 3 });
    assert.equal(ws.name, "Brief");
    assert.equal("pages" in ws, false);
    assert.equal(gridOf(ws.layout).rows, 2);
    assert.equal(gridOf(ws.layout).cols, 2);
    assert.deepEqual(gridOf(ws.layout)["2.2"], {
      component: null,
      hide: false,
    });
  });
  it("planned pages: one per page, each sized for its widgets, the first shown", () => {
    const ws = blankDashboard({
      id: 5,
      name: "Merch",
      count: 3,
      pages: [
        { name: "Curate", widgets: 1 },
        { name: "Rank", widgets: 2 },
      ],
    });
    assert.deepEqual(
      ws.pages.map((p) => [p.id, p.name, p.order]),
      [
        ["page-5-1", "Curate", 0],
        ["page-5-2", "Rank", 1],
      ],
    );
    assert.equal(ws.activePageId, "page-5-1");
    assert.equal(gridOf(ws.pages[0].layout).cols, 1);
    assert.equal(gridOf(ws.pages[1].layout).cols, 2);
    // The top-level layout mirrors the page shown.
    assert.deepEqual(ws.layout, ws.pages[0].layout);
    assert.notEqual(ws.layout, ws.pages[0].layout);
  });
  it("places onto a named page", () => {
    const ws = blankDashboard({
      id: 5,
      name: "Merch",
      count: 2,
      pages: [
        { name: "Curate", widgets: 1 },
        { name: "Rank", widgets: 1 },
      ],
    });
    const r = placeWidget(ws, { component: "a.b.C", page: "Rank" });
    assert.equal(r.pageId, "page-5-2");
    assert.equal(r.workspace.pages[1].layout.length, 2);
    assert.equal(r.workspace.pages[0].layout.length, 1);
  });
});

describe("blankDashboard — a planned grid (plan grids)", () => {
  const grid = {
    cols: 2,
    rows: 4,
    colModes: { 1: "1/4" },
    rowModes: { 1: "shrink", 2: "grow", 3: "grow", 4: "shrink" },
    cells: [
      { row: 1, col: 1, rowSpan: 1, colSpan: 2 },
      { row: 2, col: 1, rowSpan: 1, colSpan: 1 },
      { row: 3, col: 1, rowSpan: 1, colSpan: 1 },
      { row: 2, col: 2, rowSpan: 2, colSpan: 1 },
      { row: 4, col: 1, rowSpan: 1, colSpan: 2 },
    ],
  };

  it("one named page with the planned sizes and spans; covered cells hidden", () => {
    const ws = blankDashboard({
      id: 7,
      name: "Algolia Storefront",
      count: 5,
      pages: [{ name: "Search", widgets: 5, grid }],
    });
    assert.deepEqual(
      ws.pages.map((p) => p.name),
      ["Search"],
    );
    assert.equal(ws.activePageId, "page-7-1");
    const g = ws.pages[0].layout[0].grid;
    assert.equal(g.cols, 2);
    assert.equal(g.rows, 4);
    assert.deepEqual(g.colModes, { 1: "1/4" });
    assert.deepEqual(g.rowModes, {
      1: "shrink",
      2: "grow",
      3: "grow",
      4: "shrink",
    });
    assert.deepEqual(g["1.1"], {
      component: null,
      hide: false,
      span: { row: 1, col: 2 },
    });
    assert.deepEqual(g["1.2"], { component: null, hide: true });
    assert.deepEqual(g["2.2"], {
      component: null,
      hide: false,
      span: { row: 2, col: 1 },
    });
    assert.deepEqual(g["3.2"], { component: null, hide: true });
    assert.deepEqual(g["4.2"], { component: null, hide: true });
    assert.deepEqual(g["2.1"], { component: null, hide: false });
    assert.deepEqual(ws.layout, ws.pages[0].layout);
  });

  it("a widget placed in a spanning cell keeps the span", () => {
    const ws = blankDashboard({
      id: 7,
      name: "S",
      count: 5,
      pages: [{ name: "Search", widgets: 5, grid }],
    });
    const r = placeWidget(ws, {
      component: "a.b.Hits",
      page: "Search",
      row: 2,
      col: 2,
    });
    const g = r.workspace.pages[0].layout[0].grid;
    assert.deepEqual(g["2.2"], {
      component: r.widgetId,
      hide: false,
      span: { row: 2, col: 1 },
    });
  });

  it("a single page without a grid keeps its name", () => {
    const ws = blankDashboard({
      id: 7,
      name: "S",
      count: 3,
      pages: [{ name: "Only", widgets: 3 }],
    });
    assert.deepEqual(
      ws.pages.map((p) => p.name),
      ["Only"],
    );
    assert.equal(ws.pages[0].layout[0].grid.cols, 2);
  });
});
