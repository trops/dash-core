/**
 * moveWidgetToPage.js — a widget moves to another page of its dashboard
 * (approved mockup "Move a widget to another page", frames 1-4).
 *
 * It moves as it is: its uuid, settings (userPrefs), connections
 * (selectedProviders), listeners, and anything inside it (a container's
 * children). It leaves its cell on the source page empty, and goes into the
 * first free cell of the target page's main grid, reading row by row. A full
 * grid gets a new row at the bottom. Its id (and its children's) are made new
 * on the target page, whose items count from 1 too; the cell points at the
 * new id.
 *
 * Pure — the workspace passed in is never changed.
 */
import { addGridRowOp } from "../Models/addGridRowOp";

const isCellKey = (k) => /^\d+\.\d+$/.test(k);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** The page a widget is on (by uuid, else by its id on fromPageId). */
export function pageOfWidget(
  workspace,
  { uuid = null, itemId = null, pageId = null } = {},
) {
  const pages = (workspace && workspace.pages) || [];
  const match = (it) =>
    it &&
    (uuid != null
      ? it.uuid === uuid || it.uuidString === uuid
      : itemId != null && String(it.id) === String(itemId));
  for (const p of pages) {
    if (pageId != null && String(p.id) !== String(pageId)) continue;
    const item = (p.layout || []).find(match);
    if (item) return { page: p, item };
  }
  return null;
}

/** The page's main grid: the grid at its top (parent 0), else any grid. */
function mainGrid(layout) {
  const grids = (layout || []).filter(
    (it) => it && it.grid && typeof it.grid === "object",
  );
  return (
    grids.find((g) => g.parent === 0 || g.parent === "0" || g.parent == null) ||
    grids[0] ||
    null
  );
}

/** "r.c" of the first free cell (row by row), or null. */
export function firstFreeCell(grid) {
  if (!grid) return null;
  const rows = Number(grid.rows) || 0;
  const cols = Number(grid.cols) || 0;
  for (let r = 1; r <= rows; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      const cell = grid[`${r}.${c}`];
      if (!cell) return `${r}.${c}`;
      if (cell.hide) continue;
      if (cell.component === null || cell.component === undefined) {
        return `${r}.${c}`;
      }
    }
  }
  return null;
}

/** The widget and everything inside it (children by parent id). */
function subtreeOf(layout, root) {
  const out = [root];
  const ids = new Set([String(root.id)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const it of layout) {
      if (!it || out.includes(it)) continue;
      if (it.parent != null && ids.has(String(it.parent))) {
        out.push(it);
        ids.add(String(it.id));
        grew = true;
      }
    }
  }
  return out;
}

/**
 * @returns {{ ok: true, workspace, cell: string, toPage: object, fromPage: object }
 *         | { ok: false, error: string }}
 */
export function moveWidgetToPage(
  workspace,
  { uuid = null, itemId = null, fromPageId = null, toPageId } = {},
) {
  if (!workspace || !Array.isArray(workspace.pages)) {
    return { ok: false, error: "This dashboard has no pages." };
  }
  const found = pageOfWidget(workspace, { uuid, itemId, pageId: fromPageId });
  if (!found)
    return { ok: false, error: "That widget isn't on this dashboard." };
  const { page: from, item } = found;
  if (String(from.id) === String(toPageId)) {
    return { ok: false, error: "It's already on that page." };
  }
  const to = workspace.pages.find((p) => String(p.id) === String(toPageId));
  if (!to) return { ok: false, error: "That page isn't on this dashboard." };

  const fromLayout = clone(from.layout || []);
  const toLayout = clone(to.layout || []);
  const moving = subtreeOf(
    fromLayout,
    fromLayout.find((it) => String(it.id) === String(item.id)),
  );
  const movingIds = new Set(moving.map((it) => String(it.id)));

  // Off the source page: its items, and the cell that held it.
  const leftLayout = fromLayout
    .filter((it) => !movingIds.has(String(it.id)))
    .map((it) => {
      if (!it.grid) return it;
      const grid = { ...it.grid };
      for (const k of Object.keys(grid)) {
        if (
          isCellKey(k) &&
          grid[k] &&
          grid[k].component != null &&
          String(grid[k].component) === String(item.id)
        ) {
          grid[k] = { ...grid[k], component: null };
        }
      }
      return { ...it, grid };
    });

  // Onto the target page: new ids above everything there.
  let grid = mainGrid(toLayout);
  if (!grid) return { ok: false, error: "That page has no grid to put it in." };
  let next =
    toLayout.reduce((m, it) => Math.max(m, Number(it && it.id) || 0), 0) + 1;
  const idMap = new Map();
  for (const it of moving) idMap.set(String(it.id), next++);
  const moved = moving.map((it) => {
    const copy = { ...it, id: idMap.get(String(it.id)) };
    if (it === moving[0]) copy.parent = grid.id;
    else if (idMap.has(String(it.parent)))
      copy.parent = idMap.get(String(it.parent));
    if (copy.grid) {
      const g = { ...copy.grid };
      for (const k of Object.keys(g)) {
        if (isCellKey(k) && g[k] && idMap.has(String(g[k].component))) {
          g[k] = { ...g[k], component: idMap.get(String(g[k].component)) };
        }
      }
      copy.grid = g;
    }
    return copy;
  });

  let gridOut = { ...grid.grid };
  let cell = firstFreeCell(gridOut);
  if (!cell) {
    gridOut = addGridRowOp(gridOut, Number(gridOut.rows) || 0);
    cell = firstFreeCell(gridOut);
  }
  gridOut[cell] = {
    ...(gridOut[cell] || {}),
    component: moved[0].id,
    hide: false,
  };
  const placedLayout = [
    ...toLayout.map((it) => (it === grid ? { ...it, grid: gridOut } : it)),
    ...moved,
  ];

  const pages = workspace.pages.map((p) =>
    p === from
      ? { ...p, layout: leftLayout }
      : p === to
        ? { ...p, layout: placedLayout }
        : p,
  );
  return {
    ok: true,
    workspace: { ...workspace, pages },
    cell,
    fromPage: { id: from.id, name: from.name },
    toPage: { id: to.id, name: to.name },
  };
}
