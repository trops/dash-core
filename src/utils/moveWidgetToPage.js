/**
 * moveWidgetToPage.js — a widget moves to another page of its dashboard
 * (approved mockup "Move a widget to another page", frames 1-4).
 *
 * It moves as it is: its uuid, settings (userPrefs), connections
 * (selectedProviders), listeners, and anything inside it (a container's
 * children). It leaves its cell on the source page empty, and goes into the
 * first free cell of the target page's main grid, reading row by row. A full
 * grid gets a new row at the bottom. A merged (spanned) cell stays an empty
 * merged cell; the widget takes one cell there.
 *
 * Its id — and so its uuid (`dashboard-component-id`), which its
 * connection binding and the listeners pointing at it use — stays the same
 * when that id is free on the target page (each page counts from 1). When it
 * isn't, it gets a new one, and what pointed at the old one follows: the
 * dashboard's connection binding for it, and listeners on every page
 * (`Component[id].event`) — unless another copy still answers to the old one.
 *
 * Pure — the workspace passed in is never changed.
 */
import { addGridRowOp } from "../Models/addGridRowOp";
import { layoutItemUuid } from "./layoutItemUuid";

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

  // Onto the target page: the same ids when they're free there, else new
  // ones above everything there.
  let grid = mainGrid(toLayout);
  if (!grid) return { ok: false, error: "That page has no grid to put it in." };
  const taken = new Set(toLayout.map((it) => String(it && it.id)));
  const keep = moving.every((it) => !taken.has(String(it.id)));
  let next =
    toLayout.reduce((m, it) => Math.max(m, Number(it && it.id) || 0), 0) + 1;
  const idMap = new Map();
  for (const it of moving) idMap.set(String(it.id), keep ? it.id : next++);
  const moved = moving.map((it) => {
    const copy = { ...it, id: idMap.get(String(it.id)) };
    if (!keep && it.component) {
      copy.uuid = layoutItemUuid(workspace.id, it.component, copy.id);
    }
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

  let pages = workspace.pages.map((p) =>
    p === from
      ? { ...p, layout: leftLayout }
      : p === to
        ? { ...p, layout: placedLayout }
        : p,
  );
  let selectedProviders = workspace.selectedProviders;
  const root = moving[0];
  const newId = idMap.get(String(root.id));
  if (!keep && root.component) {
    const derivedOld = layoutItemUuid(workspace.id, root.component, root.id);
    const newUuid = layoutItemUuid(workspace.id, root.component, newId);
    // Its connection binding follows it (the old one stays for any other
    // copy answering to it).
    if (selectedProviders && typeof selectedProviders === "object") {
      const sp = { ...selectedProviders };
      for (const [from, to] of [
        [root.uuid, newUuid],
        [derivedOld, newUuid],
        [String(root.id), String(newId)],
      ]) {
        if (from == null) continue;
        if (sp[from] && sp[to] === undefined) sp[to] = sp[from];
      }
      selectedProviders = sp;
    }
    // Listeners pointing at it, when nothing else answers to its old id.
    const stillThere = pages.some((p) =>
      (p.layout || []).some(
        (it) =>
          it &&
          it.component === root.component &&
          String(it.id) === String(root.id),
      ),
    );
    if (!stillThere) {
      const esc = String(root.component).replace(
        /[.*+?^${}()|[\]\\]/g,
        (c) => "\\" + c,
      );
      const re = new RegExp(`^(${esc})\\[${root.id}\\]\\.`);
      const fix = (it) => {
        if (!it || !it.listeners || typeof it.listeners !== "object") return it;
        let changed = false;
        const listeners = {};
        for (const [h, list] of Object.entries(it.listeners)) {
          listeners[h] = Array.isArray(list)
            ? list.map((ev) => {
                if (typeof ev === "string" && re.test(ev)) {
                  changed = true;
                  return ev.replace(re, `$1[${newId}].`);
                }
                return ev;
              })
            : list;
        }
        return changed ? { ...it, listeners } : it;
      };
      pages = pages.map((p) => ({ ...p, layout: (p.layout || []).map(fix) }));
    }
  }
  return {
    ok: true,
    workspace: {
      ...workspace,
      pages,
      ...(selectedProviders !== workspace.selectedProviders
        ? { selectedProviders }
        : {}),
    },
    itemId: newId,
    uuid: moved[0].uuid || null,
    cell,
    fromPage: { id: from.id, name: from.name },
    toPage: { id: to.id, name: to.name },
  };
}
