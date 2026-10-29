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
function placeInto(layout, component, userPrefs, at = null, selectedProviders) {
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
    // A widget, so the editor shows its Listeners (src/utils/widgetSections.js).
    type: "widget",
    parent: gridNode ? gridNode.id : container ? container.id : 0,
    config: {},
    userPrefs: { ...(userPrefs || {}) },
    // Which connection per provider type — read before the dashboard's own
    // bindings (utils/providerResolution.js).
    ...(selectedProviders && Object.keys(selectedProviders).length
      ? { selectedProviders: { ...selectedProviders } }
      : {}),
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
 *           row?: number, col?: number, selectedProviders?: object }} widget — `page` by name or id
 *   (default: the page shown); `row` + `col` ask for a cell (default: the
 *   next empty one, or a new row)
 * @returns {{ workspace: object, widgetId: number, cell: {row, col}|null,
 *   pageId: string|null }} — pageId: the page it went on (null without pages)
 * @throws on an unknown page, or a cell outside the grid / already taken
 */
function placeWidget(
  workspace,
  { component, userPrefs, page, row, col, selectedProviders } = {},
) {
  if (!component || typeof component !== "string") {
    throw new Error("placeWidget: component is required");
  }
  const ws = clone(workspace || {});
  const target = layoutOf(ws, page);
  if (target.error) throw new Error(target.error);
  const layout = target.layout;
  const at = row !== undefined && col !== undefined ? { row, col } : null;
  const placed = placeInto(layout, component, userPrefs, at, selectedProviders);
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
 * Set settings on one copy of a widget (lead-workspace release 6c): the item
 * with that id on that page (or the pinned sidebar, scope "sidebar") — item
 * ids repeat across pages — and the top-level mirror when that page is the
 * one shown. The component must be that widget's, by its id or, on a
 * dashboard saved before scoped ids, its bare name.
 * @returns {object|null} the new workspace, or null when it isn't there
 */
function setItemPrefs(
  workspace,
  { itemId, component = null, pageId = null, scope = "main" } = {},
  prefs = {},
) {
  const ws = clone(workspace || {});
  const bare = component ? String(component).split(".").pop() : null;
  const isIt = (i) =>
    i &&
    String(i.id) === String(itemId) &&
    (!component || i.component === component || i.component === bare);
  const setIn = (layout) => {
    const item = Array.isArray(layout) ? layout.find(isIt) : null;
    if (!item) return false;
    item.userPrefs = { ...(item.userPrefs || {}), ...(prefs || {}) };
    return true;
  };
  if (scope && scope !== "main") {
    return setIn(ws.sidebarLayout) ? ws : null;
  }
  const pages = Array.isArray(ws.pages) ? ws.pages : [];
  if (!pages.length) return setIn(ws.layout) ? ws : null;
  const page =
    pageId != null
      ? pages.find((p) => p && String(p.id) === String(pageId)) || null
      : shownPage(ws);
  if (!page || !setIn(page.layout)) return null;
  if (page === shownPage(ws)) setIn(ws.layout);
  return ws;
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

/** A layout with one empty grid for n widgets (two columns from two). */
function gridLayout(n) {
  const count = Math.max(1, Number(n) || 1);
  const cols = count > 1 ? 2 : 1;
  const rows = Math.ceil(count / cols);
  const grid = { rows, cols, gap: "gap-2" };
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      grid[`${r}.${c}`] = { component: null, hide: false };
    }
  }
  return [
    {
      id: 1,
      order: 1,
      component: "LayoutGridContainer",
      type: "grid",
      parent: 0,
      hasChildren: 1,
      scrollable: false,
      width: "w-full",
      height: "h-full",
      workspace: "layout",
      grid,
    },
  ];
}

/**
 * A planned grid (teamPlan planPages): its size, column widths and row
 * heights, and a span on each cell a widget spans — the cells a span covers
 * hidden, as the grid editor leaves them.
 */
function plannedGridLayout(planned) {
  const [node] = gridLayout(1);
  const grid = { rows: planned.rows, cols: planned.cols, gap: "gap-2" };
  for (let r = 1; r <= grid.rows; r++) {
    for (let c = 1; c <= grid.cols; c++) {
      grid[`${r}.${c}`] = { component: null, hide: false };
    }
  }
  for (const cell of planned.cells || []) {
    const rowSpan = cell.rowSpan || 1;
    const colSpan = cell.colSpan || 1;
    if (rowSpan === 1 && colSpan === 1) continue;
    for (let r = cell.row; r < cell.row + rowSpan; r++) {
      for (let c = cell.col; c < cell.col + colSpan; c++) {
        grid[`${r}.${c}`] = { component: null, hide: true };
      }
    }
    grid[`${cell.row}.${cell.col}`] = {
      component: null,
      hide: false,
      span: { row: rowSpan, col: colSpan },
    };
  }
  if (planned.colModes && Object.keys(planned.colModes).length) {
    grid.colModes = { ...planned.colModes };
  }
  if (planned.rowModes && Object.keys(planned.rowModes).length) {
    grid.rowModes = { ...planned.rowModes };
  }
  return [{ ...node, grid }];
}

/**
 * A plan's new, empty dashboard (create-entry CRE-004): one grid sized for
 * `count` widgets, or — with planned `pages` ([{ name, widgets: count,
 * grid? }]) — a page each (one page keeps its name), the first shown, the
 * top-level layout its mirror (as src/Models/DashboardModel.createPage
 * makes pages). A page with a planned grid gets that grid.
 */
function blankDashboard({ id, name, count, pages = [] }) {
  const label = String(name || "New dashboard").trim();
  const ws = {
    id,
    name: label,
    label,
    type: "workspace",
    version: 1,
    menuId: 1,
    layout: gridLayout(count),
  };
  if (Array.isArray(pages) && pages.length >= 1) {
    ws.pages = pages.map((p, i) => ({
      id: `page-${id}-${i + 1}`,
      name: String(p.name),
      order: i,
      layout: p.grid ? plannedGridLayout(p.grid) : gridLayout(p.widgets),
    }));
    ws.activePageId = ws.pages[0].id;
    ws.layout = clone(ws.pages[0].layout);
  }
  return ws;
}

module.exports = {
  blankDashboard,
  placeWidget,
  setWidgetPrefs,
  setItemPrefs,
  addWidgetListener,
  removeWidgets,
};
