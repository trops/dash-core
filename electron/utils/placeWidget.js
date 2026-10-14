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
 * the top-level `layout` mirrors it. Placement goes into the active page (or
 * the one asked for) and the mirror is kept in step (activeLayout.js).
 */
"use strict";

const { layoutOf, withLayout, shownPage } = require("./activeLayout");

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

/**
 * Place into one layout array (mutates it). `at` ({ row, col }) asks for a
 * cell; it must exist in the grid and be empty.
 */
function placeInto(layout, component, userPrefs, at = null) {
  const gridNode = layout.find(
    (i) => i && i.component === "LayoutGridContainer" && i.grid,
  );
  const container = layout.find(
    (i) => i && /Container$/.test(i.component || ""),
  );
  let cell = null;
  if (gridNode && at) {
    const grid = gridNode.grid;
    const row = Number(at.row);
    const col = Number(at.col);
    if (!(row >= 1 && row <= grid.rows && col >= 1 && col <= grid.cols)) {
      throw new Error(
        `Cell ${at.row}.${at.col} is outside the ${grid.rows}×${grid.cols} grid.`,
      );
    }
    const existing = grid[`${row}.${col}`];
    if (
      existing &&
      existing.component !== null &&
      existing.component !== undefined
    ) {
      throw new Error(`Cell ${row}.${col} already holds a widget.`);
    }
    cell = { row, col };
  } else if (gridNode) {
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
 * @param {{ component: string, userPrefs?: object, page?: string,
 *           row?: number, col?: number }} widget — `page` by name or id
 *   (default: the page shown); `row` + `col` ask for a cell (default: the
 *   next empty one, or a new row)
 * @returns {{ workspace: object, widgetId: number, cell: {row, col}|null,
 *   pageId: string|null }} — pageId: the page it went on (null without pages)
 * @throws on an unknown page, or a cell outside the grid / already taken
 */
function placeWidget(workspace, { component, userPrefs, page, row, col } = {}) {
  if (!component || typeof component !== "string") {
    throw new Error("placeWidget: component is required");
  }
  const ws = clone(workspace || {});
  const target = layoutOf(ws, page);
  if (target.error) throw new Error(target.error);
  const layout = target.layout;
  const at = row !== undefined && col !== undefined ? { row, col } : null;
  const placed = placeInto(layout, component, userPrefs, at);
  withLayout(ws, layout, target.page);
  return {
    workspace: ws,
    ...placed,
    pageId: target.page ? target.page.id : null,
  };
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

/**
 * Add an event to a widget's listeners (`listeners[handler]`) — in every
 * layout (pages and the top-level mirror) where that widget id holds
 * `component` (when given). Adding one that's already there is a no-op.
 * @returns {object|null} the new workspace, or null when the widget isn't there
 */
function addWidgetListener(
  workspace,
  widgetId,
  handler,
  eventType,
  component = null,
) {
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
    const listeners =
      item.listeners && typeof item.listeners === "object"
        ? { ...item.listeners }
        : {};
    const list = Array.isArray(listeners[handler])
      ? [...listeners[handler]]
      : [];
    if (!list.includes(eventType)) list.push(eventType);
    listeners[handler] = list;
    item.listeners = listeners;
    found = true;
  }
  return found ? ws : null;
}

/**
 * Take widgets a plan build placed off a dashboard (Remove what was built on
 * a dashboard you have, create-entry 5e-2b): each `{ widgetId, component,
 * pageId }` comes off the page it was placed on — widget ids repeat across
 * pages — and off the top-level mirror when that page is shown. Its grid
 * cell is emptied; rows the build added stay. A widget that's gone (or now
 * holds another component) is skipped.
 * @returns {{ workspace: object, removed: number }}
 */
function removeWidgets(workspace, placed) {
  const ws = clone(workspace || {});
  const pages = Array.isArray(ws.pages) ? ws.pages : [];
  const shown = shownPage(ws);
  let removed = 0;
  const takeOut = (layout, { widgetId, component }) => {
    if (!Array.isArray(layout)) return false;
    const at = layout.findIndex(
      (i) =>
        i &&
        String(i.id) === String(widgetId) &&
        (!component || i.component === component),
    );
    if (at < 0) return false;
    layout.splice(at, 1);
    for (const node of layout) {
      if (!node || !node.grid) continue;
      for (const [key, cell] of Object.entries(node.grid)) {
        if (cell && String(cell.component) === String(widgetId)) {
          node.grid[key] = { ...cell, component: null };
        }
      }
    }
    return true;
  };
  for (const p of placed || []) {
    if (!p || p.widgetId == null) continue;
    if (pages.length) {
      const page =
        pages.find((x) => x && String(x.id) === String(p.pageId)) || null;
      if (!page) continue;
      if (takeOut(page.layout, p)) removed++;
      if (page === shown) takeOut(ws.layout, p);
    } else if (takeOut(ws.layout, p)) {
      removed++;
    }
  }
  return { workspace: ws, removed };
}

module.exports = {
  placeWidget,
  setWidgetPrefs,
  addWidgetListener,
  removeWidgets,
};
