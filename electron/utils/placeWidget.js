/**
 * placeWidget.js
 *
 * Add a widget to a dashboard's layout (bot-teams TEAM-012 "Show on
 * dashboard"): into the grid's next empty cell, or a new row when the grid is
 * full, with the widget's saved settings (userPrefs). Pure — returns a new
 * workspace; the caller saves it. Mirrors the AI Assistant's add_widget
 * placement (electron/mcp/toolHandlers.js) plus the full-grid case.
 *
 * Dashboards with pages draw the ACTIVE page's layout (`pages[].layout`);
 * the top-level `layout` mirrors it. Placement goes into the active page and
 * the mirror is kept in step.
 */
"use strict";

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function nextLayoutId(layout) {
  return (
    (layout || []).reduce((max, i) => Math.max(max, Number(i.id) || 0), 0) + 1
  );
}

function findNextEmptyCell(grid) {
  for (let r = 1; r <= grid.rows; r++) {
    for (let c = 1; c <= grid.cols; c++) {
      const cell = grid[`${r}.${c}`];
      if (!cell || (cell.component === null && !cell.hide))
        return { row: r, col: c };
    }
  }
  return null;
}

/** The page whose layout the dashboard shows, or null for a dashboard without pages. */
function activePage(ws) {
  if (!Array.isArray(ws.pages) || !ws.pages.length) return null;
  return ws.pages.find((p) => p && p.id === ws.activePageId) || ws.pages[0];
}

/** Place into one layout array (mutates it). */
function placeInto(layout, component, userPrefs) {
  const gridNode = layout.find(
    (i) => i && i.component === "LayoutGridContainer" && i.grid,
  );
  const container = layout.find(
    (i) => i && /Container$/.test(i.component || ""),
  );
  let cell = null;
  if (gridNode) {
    const grid = gridNode.grid;
    cell = findNextEmptyCell(grid);
    if (!cell) {
      // Full: add a row of empty cells and use its first one.
      grid.rows = (Number(grid.rows) || 0) + 1;
      for (let c = 1; c <= grid.cols; c++) {
        grid[`${grid.rows}.${c}`] = { component: null, hide: false };
      }
      cell = { row: grid.rows, col: 1 };
    }
  }
  const widgetId = nextLayoutId(layout);
  const order =
    layout.reduce((max, i) => Math.max(max, Number(i.order) || 0), 0) + 1;
  layout.push({
    id: widgetId,
    order,
    component,
    parent: gridNode ? gridNode.id : container ? container.id : 0,
    config: {},
    userPrefs: { ...(userPrefs || {}) },
  });
  if (gridNode && cell) {
    const key = `${cell.row}.${cell.col}`;
    gridNode.grid[key] = {
      ...(gridNode.grid[key] || {}),
      component: widgetId,
      hide: false,
    };
  }
  return { widgetId, cell };
}

/**
 * @param {object} workspace
 * @param {{ component: string, userPrefs?: object }} widget
 * @returns {{ workspace: object, widgetId: number, cell: {row, col}|null }}
 */
function placeWidget(workspace, { component, userPrefs } = {}) {
  if (!component || typeof component !== "string") {
    throw new Error("placeWidget: component is required");
  }
  const ws = clone(workspace || {});
  const page = activePage(ws);
  if (page) {
    page.layout = Array.isArray(page.layout) ? page.layout : [];
    const placed = placeInto(page.layout, component, userPrefs);
    ws.layout = clone(page.layout);
    return { workspace: ws, ...placed };
  }
  ws.layout = Array.isArray(ws.layout) ? ws.layout : [];
  const placed = placeInto(ws.layout, component, userPrefs);
  return { workspace: ws, ...placed };
}

/**
 * Merge settings into a widget's userPrefs — in every layout (pages and the
 * top-level mirror) where that widget id holds `component` (when given).
 * @returns {object|null} the new workspace, or null when the widget isn't there
 */
function setWidgetPrefs(workspace, widgetId, prefs, component = null) {
  const ws = clone(workspace || {});
  const layouts = [
    ws.layout,
    ...(ws.pages || []).map((p) => p && p.layout),
  ].filter(Array.isArray);
  let found = false;
  for (const layout of layouts) {
    const item = layout.find(
      (i) =>
        i &&
        String(i.id) === String(widgetId) &&
        (!component || i.component === component),
    );
    if (!item) continue;
    item.userPrefs = { ...(item.userPrefs || {}), ...(prefs || {}) };
    found = true;
  }
  return found ? ws : null;
}

module.exports = { placeWidget, setWidgetPrefs };
