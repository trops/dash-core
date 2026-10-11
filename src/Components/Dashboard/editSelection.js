import React from "react";

/**
 * Select-to-edit in the dashboard editor (create-entry phase 1c, CRE-006).
 *
 * The selection is shared through EditSelectionContext so grid cells deep in
 * the layout can highlight themselves and report clicks without threading
 * props through every layout renderer.
 *
 *   selection: { kind: "widget", uuid, id, component, label, openTab? }
 *            | { kind: "bot", botId, label }
 *            | { kind: "cell", gridItemId, cellNumber, scope, label }  (1d)
 *            | null  (the dashboard itself)
 *
 * `available` is false outside the editor (no provider): callers fall back
 * to their old behaviour (e.g. the Add Widget pop-up).
 */
export const EditSelectionContext = React.createContext({
  available: false,
  selection: null,
  related: { widgets: new Set(), bots: new Set() },
  select: () => {},
});

const isWidget = (item) =>
  item && item.component && !item.grid && item.parent !== 0;

/** The widgets in a layout (grid containers and the root left out). */
export function widgetsOf(layout) {
  return (Array.isArray(layout) ? layout : []).filter(isWidget);
}

/** The grid and cell holding widget `itemId`, or null. */
export function findWidgetCell(layout, itemId) {
  for (const item of Array.isArray(layout) ? layout : []) {
    if (!item || !item.grid) continue;
    for (const [cellNumber, cell] of Object.entries(item.grid)) {
      if (cell && typeof cell === "object" && cell.component === itemId) {
        return { gridItemId: item.id, cellNumber };
      }
    }
  }
  return null;
}

/** Bot ids named in a widget's listeners (`bot:<ref>[<botId>].<event>`). */
function botsFeeding(widget) {
  const out = new Set();
  for (const events of Object.values((widget && widget.listeners) || {})) {
    for (const ev of Array.isArray(events) ? events : []) {
      const m = /^bot:.+\[([^\]]+)\]\./.exec(String(ev));
      if (m) out.add(m[1]);
    }
  }
  return out;
}

/** Does `bot` run on one of `widget`'s events (`<ref>[<widgetId>].<event>`)? */
function botStartedBy(bot, widget) {
  return ((bot && bot.subscriptions) || []).some(
    (s) =>
      s &&
      typeof s.eventType === "string" &&
      !s.eventType.startsWith("bot:") &&
      s.eventType.includes(`[${widget.id}].`),
  );
}

/**
 * What's connected to the selection: the bots that feed or are started by a
 * selected widget, or the widgets a selected bot feeds or is started by.
 * @returns {{ widgets: Set<string>, bots: Set<string> }} widget uuids, bot ids
 */
export function relatedTo(selection, { widgets = [], bots = [] } = {}) {
  const related = { widgets: new Set(), bots: new Set() };
  if (!selection) return related;
  if (selection.kind === "widget") {
    const widget = widgets.find((w) => w.uuid === selection.uuid);
    if (!widget) return related;
    for (const id of botsFeeding(widget)) related.bots.add(id);
    for (const bot of bots) {
      if (botStartedBy(bot, widget)) related.bots.add(bot.id);
    }
  } else if (selection.kind === "bot") {
    const bot = bots.find((b) => b.id === selection.botId);
    for (const w of widgets) {
      if (
        botsFeeding(w).has(selection.botId) ||
        (bot && botStartedBy(bot, w))
      ) {
        related.widgets.add(w.uuid);
      }
    }
  }
  return related;
}

/**
 * A bot's spend this month, from bots.getSpend() buckets (`bot:<id>`).
 * Dollars when there are any; tokens otherwise (e.g. runs on a Claude plan).
 */
export function formatMonthCost(spend, botId) {
  const b = spend && spend[`bot:${botId}`];
  if (!b) return "No runs this month";
  const usd = Number(b.usd) || 0;
  if (usd > 0) {
    return usd < 0.01 ? "<$0.01 this month" : `$${usd.toFixed(2)} this month`;
  }
  const tokens = (Number(b.inputTokens) || 0) + (Number(b.outputTokens) || 0);
  if (tokens > 0) {
    const k =
      tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
    return `${k} tokens this month`;
  }
  return "No runs this month";
}
