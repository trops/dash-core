/**
 * widgetDiagram.js — the dashboard's widgets on the Bots diagram
 * (team-dashboards TD-009): which widgets there are, which bot each one
 * shows (a listener on a bot's event, or a Bot results widget's bot), where
 * their cards go, and the listener changes a line from a bot to a widget
 * makes. Lines go one way: from a bot to a widget.
 *
 * Listeners live on the widget's layout item (`listeners = { handler:
 * ["bot:<ref>[<botId>].<event>"] }`, listenerResolution.js); a widget
 * declares the listeners it has in its .dash.js `eventHandlers`.
 *
 * Pure: no React, no IPC.
 */
import {
  formatEventString,
  isBotSource,
  parseEventString,
} from "../../utils/listenerResolution";
import {
  belongsToWorkspace,
  isUserWidget,
  pickWidgetDisplayName,
} from "../../utils/widgetIdentity";
import { botRefOf, eventKind } from "./teamDiagram";

/** The built-in widget that shows one bot's answers and results. */
export const BOT_RESULTS = "dash.bots.BotResults";

const itemIdOf = (item) =>
  item && item.id !== undefined && item.id !== null ? String(item.id) : null;

/** Each grid's cells: item id → { gridItemId, cellNumber }. */
function cellsOf(items, out = new Map()) {
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const grid = item.grid && typeof item.grid === "object" ? item.grid : null;
    if (grid) {
      for (const [cell, v] of Object.entries(grid)) {
        if (!/^\d+\.\d+$/.test(cell) || !v || v.component == null) continue;
        out.set(String(v.component), { gridItemId: item.id, cellNumber: cell });
      }
    }
    if (Array.isArray(item.items)) cellsOf(item.items, out);
    if (Array.isArray(item.layout)) cellsOf(item.layout, out);
  }
  return out;
}

function walk(items, visit) {
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    if (item.component) visit(item);
    if (Array.isArray(item.items)) walk(item.items, visit);
    if (Array.isArray(item.layout)) walk(item.layout, visit);
  }
}

/** The bot listeners on a layout item: [{ handlerName, botId, event, raw }]. */
export function botListeners(item) {
  const out = [];
  const listeners =
    item && item.listeners && typeof item.listeners === "object"
      ? item.listeners
      : {};
  for (const [handlerName, list] of Object.entries(listeners)) {
    const events = Array.isArray(list)
      ? list
      : typeof list === "string"
        ? [list]
        : [];
    for (const raw of events) {
      const p = parseEventString(raw);
      if (!p || !isBotSource(p.component)) continue;
      out.push({ handlerName, botId: String(p.itemId), event: p.event, raw });
    }
  }
  return out;
}

/**
 * The dashboard's widgets for the diagram, in page order: { key, itemId,
 * component, label, page (its page's name, when there are several),
 * pageId, gridItemId, cellNumber, handlers, listens, resultsBotId,
 * settings, providers }. `getConfig(component, item)` is the widget's
 * .dash.js (ComponentManager.config).
 */
export function diagramWidgets(workspace, getConfig = () => null) {
  if (!workspace) return [];
  const pages =
    Array.isArray(workspace.pages) && workspace.pages.length
      ? workspace.pages.map((p) => ({
          id: p.id ?? null,
          name: p.name || "",
          layout: p.layout,
        }))
      : [{ id: null, name: "", layout: workspace.layout }];
  const several = pages.length > 1;
  const out = [];
  const seen = new Set();
  for (const page of pages) {
    const cells = cellsOf(page.layout);
    walk(page.layout, (item) => {
      if (!isUserWidget(item) || !belongsToWorkspace(item, workspace)) return;
      const itemId = itemIdOf(item);
      if (itemId === null) return;
      const key = `${item.component}|${itemId}`;
      if (seen.has(key)) return;
      seen.add(key);
      const cfg = getConfig(item.component, item) || {};
      const handlers = [
        ...(Array.isArray(cfg.eventHandlers) ? cfg.eventHandlers : []),
        ...(Array.isArray(item.eventHandlers) ? item.eventHandlers : []),
      ].filter(
        (h, i, all) => typeof h === "string" && h && all.indexOf(h) === i,
      );
      const cell = cells.get(itemId) || {};
      const prefs =
        item.userPrefs && typeof item.userPrefs === "object"
          ? item.userPrefs
          : {};
      out.push({
        key,
        itemId,
        component: item.component,
        sourcePackage: item.packageId || cfg._sourcePackage || null,
        label: pickWidgetDisplayName(item, cfg),
        page: several ? page.name : "",
        pageId: page.id,
        gridItemId: cell.gridItemId ?? null,
        cellNumber: cell.cellNumber ?? null,
        handlers,
        listens: botListeners(item),
        // Every listener name it's wired with — a new one never reuses one.
        listenerNames:
          item.listeners && typeof item.listeners === "object"
            ? Object.keys(item.listeners)
            : [],
        resultsBotId:
          item.component === BOT_RESULTS && prefs.botId
            ? String(prefs.botId)
            : null,
        settings: prefs,
        providers:
          item.selectedProviders && typeof item.selectedProviders === "object"
            ? item.selectedProviders
            : null,
      });
    });
  }
  return out;
}

/** The widget's line in a few words: what it shows, or what it is. */
export function widgetSub(widget, nameOf = () => null) {
  if (!widget) return "";
  if (widget.resultsBotId) {
    const n = nameOf(widget.resultsBotId);
    return n ? `Shows ${n}'s answers` : "Bot results";
  }
  const shows = widget.listens
    .map((l) => nameOf(l.botId))
    .filter((n, i, all) => n && all.indexOf(n) === i);
  if (shows.length) return `Shows what ${shows.join(", ")} sends`;
  if (widget.handlers.length) {
    return `Listens for: ${widget.handlers.slice(0, 2).join(", ")}${
      widget.handlers.length > 2 ? "…" : ""
    }`;
  }
  return "No listener yet";
}

/**
 * Lines from the team's bots to widgets: a listener on a bot's event, or a
 * Bot results widget showing a bot. Bots off the team aren't drawn.
 */
export function widgetEdges(widgets = [], members = []) {
  const ids = new Set((members || []).map((b) => b && b.id));
  const edges = [];
  for (const w of widgets || []) {
    for (const l of w.listens) {
      if (!ids.has(l.botId)) continue;
      edges.push({
        key: `w|${w.key}|${l.handlerName}|${l.raw}`,
        from: l.botId,
        widget: w.key,
        event: l.event,
        kind: eventKind(l.event),
        handlerName: l.handlerName,
        raw: l.raw,
      });
    }
    if (w.resultsBotId && ids.has(w.resultsBotId)) {
      edges.push({
        key: `r|${w.key}`,
        from: w.resultsBotId,
        widget: w.key,
        event: "results",
        kind: "results",
        handlerName: null,
        raw: null,
      });
    }
  }
  return edges;
}

const pascal = (s) =>
  String(s || "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

/**
 * The listener name Dash picks for a widget showing a bot's event — e.g.
 * showShoppingHelperAnswer — never one the widget already has.
 */
export function wireHandlerName(bot, event, taken = []) {
  const who = pascal(bot && bot.name) || "Bot";
  const what =
    event === "completed"
      ? "Answer"
      : event === "failed"
        ? "Problem"
        : String(event || "").startsWith("result.")
          ? pascal(String(event).slice(7)) || "Result"
          : "ToolResult";
  const base = `show${who}${what}`.slice(0, 50);
  const used = new Set(taken || []);
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    if (!used.has(`${base}${n}`)) return `${base}${n}`;
  }
  return `${base}${Date.now()}`;
}

/** The listener change for a line from `bot`'s `event` to a widget. */
export function wireChange(widget, bot, event, handlerName) {
  return {
    receiverItemId: widget.itemId,
    handlerName,
    sourceComponent: `bot:${botRefOf(bot)}`,
    sourceItemId: bot.id,
    eventName: event,
  };
}

/** The event string a widget's listener has for a bot's event. */
export const wireEventString = (bot, event) =>
  formatEventString(`bot:${botRefOf(bot)}`, bot.id, event);

/** The listener change that removes a line (an edge from widgetEdges). */
export function unwireChange(widget, edge) {
  const p = parseEventString(edge.raw) || {};
  return {
    receiverItemId: widget.itemId,
    handlerName: edge.handlerName,
    sourceComponent: p.component,
    sourceItemId: p.itemId,
    eventName: p.event,
    raw: edge.raw,
  };
}

/**
 * Where the widget cards go: a column right of the team when there's room
 * (`side`), otherwise rows below it starting at `top`.
 */
export function widgetLayout({
  width,
  count,
  top = 0,
  side = false,
  colW = 260,
  cardH = 64,
  gap = 16,
  minW = 200,
  maxW = 260,
}) {
  const n = Math.max(0, count || 0);
  const avail = Math.max(Number(width) || 0, minW + gap * 2);
  if (side) {
    const x = avail - colW - gap;
    return {
      side: true,
      x,
      w: colW,
      cards: Array.from({ length: n }, (_, i) => ({
        x,
        y: 48 + i * (cardH + gap),
        w: colW,
      })),
      labelY: 20,
      bottom: 48 + n * (cardH + gap),
    };
  }
  const cols = Math.max(
    1,
    Math.min(n || 1, Math.floor((avail - gap) / (minW + gap))),
  );
  const w = Math.max(
    minW,
    Math.min(maxW, Math.floor((avail - gap * (cols + 1)) / cols)),
  );
  const rowW = cols * w + (cols - 1) * gap;
  const start = Math.max(gap, (avail - rowW) / 2);
  const firstY = top + 32;
  return {
    side: false,
    x: start,
    w,
    cards: Array.from({ length: n }, (_, i) => ({
      x: start + (i % cols) * (w + gap),
      y: firstY + Math.floor(i / cols) * (cardH + gap),
      w,
    })),
    labelY: top + 4,
    bottom: firstY + Math.ceil(n / cols) * (cardH + gap),
  };
}
