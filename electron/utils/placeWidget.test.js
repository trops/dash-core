/**
 * placeWidget.test.js — add a widget to a dashboard's layout: next empty grid
 * cell, a new row when the grid is full, and saved settings (userPrefs).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { placeWidget, setWidgetPrefs } = require("./placeWidget");

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
