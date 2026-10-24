import { findWidgetCell, widgetsOf } from "./editSelection";
import { pruneDeadListenerReferences } from "../../utils/listenerResolution";

/**
 * What Cancel will discard (create-entry phase 1e, CRE-006 AC7).
 *
 * Compares the copy of the dashboard taken on entering edit mode with the
 * staged one, plus bot edits staged in the editor, and returns plain lines
 * for the Cancel confirmation:
 *
 *   { discarded: ["Added Weather", ...], kept: ["Widgets you installed …"] }
 *
 * Paged dashboards are compared page by page (the top-level layout only
 * mirrors the visible page). Anything that differs but isn't recognised is
 * summed up as "Other layout changes" so nothing is silently left out.
 */

const MAX_LINES = 8;

const plural = (n, one, many) => (n === 1 ? `a ${one}` : `${n} ${many}`);
// Settings compare by content: key order, and an empty list/object or null
// vs a missing value, aren't changes (loading the editor fills those in).
// An empty string is — clearing a setting shows nothing instead of its
// default.
function canonical(value) {
  if (Array.isArray(value)) {
    const items = value.map((v) => {
      const c = canonical(v);
      return c === undefined ? null : c;
    });
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = canonical(value[key]);
      if (v !== undefined) out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null ? undefined : value;
}
const same = (a, b) =>
  JSON.stringify(canonical(a) ?? null) === JSON.stringify(canonical(b) ?? null);

/** [{ key, layout }] — each place widgets live on the dashboard. */
function layoutsOf(ws) {
  const pages = Array.isArray(ws?.pages) ? ws.pages : [];
  const out = pages.length
    ? pages.map((p) => ({ key: `page:${p.id}`, layout: p.layout || [] }))
    : [{ key: "main", layout: ws?.layout || [] }];
  out.push({ key: "sidebar", layout: ws?.sidebarLayout || [] });
  return out;
}

/** uuid → { widget, where } across every layout of the dashboard. */
function placedWidgets(ws) {
  const map = new Map();
  for (const { key, layout } of layoutsOf(ws)) {
    for (const w of widgetsOf(layout)) {
      const cell = findWidgetCell(layout, w.id);
      map.set(String(w.uuid ?? w.id), {
        widget: w,
        where: cell ? `${key}:${cell.gridItemId}:${cell.cellNumber}` : key,
      });
    }
  }
  return map;
}

/** "key:gridId" → { rows, cols } for every grid. */
function gridsOf(ws) {
  const map = new Map();
  for (const { key, layout } of layoutsOf(ws)) {
    for (const item of layout) {
      if (item && item.grid) {
        map.set(`${key}:${item.id}`, {
          rows: Number(item.grid.rows) || 0,
          cols: Number(item.grid.cols) || 0,
        });
      }
    }
  }
  return map;
}

function gridLines(before, after) {
  const lines = [];
  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a) continue;
    const dr = a.rows - b.rows;
    const dc = a.cols - b.cols;
    if (dr > 0) lines.push(`Added ${plural(dr, "row", "rows")}`);
    if (dr < 0) lines.push(`Removed ${plural(-dr, "row", "rows")}`);
    if (dc > 0) lines.push(`Added ${plural(dc, "column", "columns")}`);
    if (dc < 0) lines.push(`Removed ${plural(-dc, "column", "columns")}`);
  }
  return lines;
}

const SETTINGS = ["userPrefs", "listeners", "providers"];

/**
 * The Cancel list, plus the widget notification / schedule changes waiting
 * for Save (consolidation Phase 3P) — they're kept outside the dashboard's
 * file, so describeEditChanges can't see them.
 */
export function withPendingSettings(changes, count) {
  const out = changes || { discarded: [], kept: [] };
  if (!count) return out;
  return {
    ...out,
    discarded: [
      ...(out.discarded || []),
      count === 1
        ? "Changed a widget's notifications or schedule"
        : `Changed widgets' notifications or schedules (${count})`,
    ],
  };
}

export function describeEditChanges({
  original,
  current,
  pendingBotEdits = {},
  nameOf = (w) => w.component,
}) {
  const discarded = [];
  const kept = [];
  if (!original || !current) return { discarded, kept };
  // The editor drops wiring to widgets that aren't there any more as it
  // loads; the copy taken on entering edit mode still has it. Drop it there
  // too, so it isn't listed as a change the user made.
  original = JSON.parse(JSON.stringify(original));
  pruneDeadListenerReferences(original);

  if ((current.name || "") !== (original.name || "")) {
    discarded.push(`Renamed the dashboard to "${current.name}"`);
  }
  if (!same(current.themeKey, original.themeKey)) {
    discarded.push("Changed the theme");
  }
  if (!same(current.menuId, original.menuId)) {
    discarded.push("Moved it to another folder");
  }

  const pagesBefore = new Map((original.pages || []).map((p) => [p.id, p]));
  const pagesAfter = new Map((current.pages || []).map((p) => [p.id, p]));
  for (const [id, p] of pagesAfter) {
    if (!pagesBefore.has(id)) discarded.push(`Added page "${p.name}"`);
  }
  for (const [id, p] of pagesBefore) {
    if (!pagesAfter.has(id)) discarded.push(`Removed page "${p.name}"`);
  }

  discarded.push(...gridLines(gridsOf(original), gridsOf(current)));

  const before = placedWidgets(original);
  const after = placedWidgets(current);
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const stillThere = [...after.keys()].filter((k) => before.has(k));
  added.forEach((k) => discarded.push(`Added ${nameOf(after.get(k).widget)}`));
  removed.forEach((k) =>
    discarded.push(`Removed ${nameOf(before.get(k).widget)}`),
  );
  stillThere.forEach((k) => {
    if (before.get(k).where !== after.get(k).where) {
      discarded.push(`Moved ${nameOf(after.get(k).widget)}`);
    }
  });
  stillThere.forEach((k) => {
    const a = after.get(k).widget;
    const b = before.get(k).widget;
    if (SETTINGS.some((f) => !same(a[f], b[f]))) {
      discarded.push(`Changed ${nameOf(a)}'s settings`);
    }
  });

  for (const bot of Object.values(pendingBotEdits || {})) {
    discarded.push(`Changes to the bot "${bot.name || bot.id}"`);
  }

  // Nothing recognised, but the dashboard differs: say so.
  const workspaceLines =
    discarded.length - Object.keys(pendingBotEdits || {}).length;
  if (
    workspaceLines === 0 &&
    !same(stripVolatile(current), stripVolatile(original))
  ) {
    discarded.push("Other layout changes");
  }

  if (added.length) {
    kept.push(
      "Widgets you installed stay installed — only their place on this dashboard is undone.",
    );
  }

  if (discarded.length > MAX_LINES + 1) {
    const extra = discarded.length - MAX_LINES;
    discarded.splice(MAX_LINES, extra, `…and ${extra} more`);
  }
  return { discarded, kept };
}

/** Fields that change without a user edit (timestamps). */
function stripVolatile(ws) {
  // eslint-disable-next-line no-unused-vars
  const { updatedAt, lastModified, version, ...rest } = ws || {};
  return rest;
}
