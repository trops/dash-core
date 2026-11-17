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
import {
  PILL_H,
  arrowHead,
  botRefOf,
  eventKind,
  pillWidth,
  segmentsPath,
} from "./teamDiagram";

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

// Lanes: the horizontal runs in the gap under a row of bots, this far apart.
export const LANE = 22;

/**
 * Where the widget cards go and how each bot → widget line runs, so that no
 * line crosses a card and no label sits on one.
 *
 * Wide (`side`): a column right of the team, each widget level with the bot
 * it shows where it can be (stacked below otherwise, in the bots' order).
 * A line goes straight across when its widget is level with the last bot of
 * a row; otherwise down from the bot's handle to a lane in the gap under
 * its row, along to a gutter left of the column, and into the widget.
 *
 * Narrow: each widget below the team in its bot's column (stacked when a
 * bot has several; widgets no bot feeds fill the shortest columns). A line
 * goes straight down when nothing is in between; otherwise down to a lane,
 * along to the gutter right of the widget's column, down, and into it.
 *
 * Labels sit on the straight part in a gap, or on the lane.
 *
 * @param {object} o
 * @param {number} o.width     the chart's width
 * @param {boolean} o.side     wide layout
 * @param {object} o.team      { cards: [{ id, x, y, w, row, col }] (in the
 *                             team's order), cols, cardH, gap, lead? {x,y,w} }
 * @param {object[]} o.widgets diagram widgets ({ key })
 * @param {object[]} o.edges   widgetEdges()
 * @param {number} [o.below]   narrow: the lowest y the team's own lines use
 * @param {(e) => string} [o.labelOf] a line's label text
 * @returns {{ cards: object, lines: object[], bottom: number,
 *             header: {x, y}, crowded: number }}
 *   crowded: the most lanes used under a row that has another row below it
 *   (more than 3 needs a taller row gap).
 */
export function routeWidgets({
  width,
  side = false,
  team = {},
  widgets = [],
  edges = [],
  below = 0,
  colW = 260,
  cardH = 64,
  gap = 16,
  labelOf = () => "",
}) {
  const cards = team.cards || [];
  const tH = team.cardH || 80;
  const cols = Math.max(1, team.cols || 1);
  const tGap = team.gap || 20;
  const idx = new Map(cards.map((c, i) => [c.id, i]));
  const wOrder = new Map(widgets.map((w, i) => [w.key, i]));
  const live = edges
    .filter((e) => idx.has(e.from) && wOrder.has(e.widget))
    .sort(
      (p, q) =>
        idx.get(p.from) - idx.get(q.from) ||
        wOrder.get(p.widget) - wOrder.get(q.widget),
    );
  const firstBot = new Map();
  const into = {};
  for (const e of live) {
    if (!firstBot.has(e.widget)) firstBot.set(e.widget, idx.get(e.from));
    (into[e.widget] = into[e.widget] || []).push(e);
  }
  const ordered = widgets
    .map((w, i) => ({
      w,
      i,
      b: firstBot.has(w.key) ? firstBot.get(w.key) : Infinity,
    }))
    .sort((p, q) => p.b - q.b || p.i - q.i);

  const lastRow = cards.length ? cards[cards.length - 1].row : -1;
  const rowBottom = (r) => {
    const c = cards.find((x) => x.row === r);
    return c ? c.y + tH : 0;
  };
  const lanes = {};
  const laneY = (r) => {
    lanes[r] = (lanes[r] || 0) + 1;
    return rowBottom(r) + LANE * lanes[r];
  };
  // Lines into one widget share its edge, spread out.
  const entry = (e, b, along) => {
    const list = into[e.widget];
    const s = list.indexOf(e);
    return b[along] + Math.round(((cardH * (s + 1)) / (list.length + 1)) | 0);
  };
  const crowdedOf = () =>
    Math.max(
      0,
      ...Object.entries(lanes)
        .filter(([r]) => Number(r) !== lastRow)
        .map(([, n]) => n),
    );
  const pos = {};
  const lines = [];
  const push = (e, segments, head, label) => {
    lines.push({
      ...e,
      segments,
      d: segmentsPath(segments),
      head,
      label,
      mx: label.x,
      my: label.y,
    });
  };

  if (!cards.length) {
    // No bots: just the widgets, nothing to draw to.
    const wl = widgetLayout({
      width,
      count: widgets.length,
      top: below,
      side,
      colW,
      cardH,
      gap,
    });
    widgets.forEach((w, i) => {
      pos[w.key] = wl.cards[i];
    });
    return {
      cards: pos,
      lines,
      bottom: wl.bottom,
      header: { x: wl.x, y: wl.labelY },
      crowded: 0,
    };
  }

  if (side) {
    const x = width - colW - gap;
    let y = 48;
    for (const { w, b } of ordered) {
      const want =
        b === Infinity ? y : cards[b].y + Math.round((tH - cardH) / 2);
      const top = Math.max(want, y);
      pos[w.key] = { x, y: top, w: colW };
      y = top + cardH + gap;
    }
    const teamRight = Math.max(
      ...cards.map((c) => c.x + c.w),
      team.lead ? team.lead.x + team.lead.w : 0,
    );
    let k = 0;
    for (const e of live) {
      const i = idx.get(e.from);
      const a = cards[i];
      const b = pos[e.widget];
      const wy = entry(e, b, "y");
      const pw = pillWidth(labelOf(e));
      const rightmost = a.col === cols - 1 || i === cards.length - 1;
      const level = wy >= a.y + 10 && wy <= a.y + tH - 10;
      const head = arrowHead(b.x, wy, "right");
      if (rightmost && level && b.x - (a.x + a.w) >= pw + 12) {
        push(e, [[a.x + a.w, wy, b.x, wy]], head, {
          x: (a.x + a.w + b.x) / 2,
          y: wy,
          w: pw,
          h: PILL_H,
        });
        continue;
      }
      const sx = a.x + a.w / 2;
      const sy = a.y + tH;
      const ly = laneY(a.row);
      const gx = Math.max(teamRight + 12, x - 18 - 10 * k++);
      push(
        e,
        [
          [sx, sy, sx, ly],
          [sx, ly, gx, ly],
          [gx, ly, gx, wy],
          [gx, wy, b.x, wy],
        ],
        head,
        { x: (sx + gx) / 2, y: ly, w: pw, h: PILL_H },
      );
    }
    const lastLanes = rowBottom(lastRow) + LANE * ((lanes[lastRow] || 0) + 1);
    return {
      cards: pos,
      lines,
      bottom: Math.max(y, lastLanes),
      header: { x, y: 20 },
      crowded: crowdedOf(),
    };
  }

  // Narrow: below the team, each in its bot's column.
  const cardW = cards[0].w;
  const colX = (c) => (cards.find((x) => x.col === c) || cards[0]).x;
  const stacks = Array.from({ length: cols }, () => 0);
  const where = {};
  for (const { w, b } of ordered) {
    const c =
      b === Infinity ? stacks.indexOf(Math.min(...stacks)) : cards[b].col;
    where[w.key] = { col: c, n: stacks[c]++ };
  }
  const lowestInCol = (i) => i + cols >= cards.length;
  const plan = live.map((e) => {
    const i = idx.get(e.from);
    const a = cards[i];
    const wc = where[e.widget];
    const straight =
      a.col === wc.col &&
      wc.n === 0 &&
      lowestInCol(i) &&
      into[e.widget][0] === e;
    return { e, a, wc, straight, ly: straight ? null : laneY(a.row) };
  });
  const lastBottom = rowBottom(lastRow);
  const zoneTop = Math.max(
    lastBottom + LANE * (lanes[lastRow] || 0) + 10 + 6 + PILL_H + 10,
    lastBottom + 56,
    below + 34,
  );
  let bottom = zoneTop;
  for (const { w } of ordered) {
    const wc = where[w.key];
    const top = zoneTop + wc.n * (cardH + gap);
    pos[w.key] = { x: colX(wc.col), y: top, w: cardW };
    bottom = Math.max(bottom, top + cardH + gap);
  }
  const gutters = {};
  for (const { e, a, wc, straight, ly } of plan) {
    const b = pos[e.widget];
    const pw = pillWidth(labelOf(e));
    const sx = a.x + a.w / 2;
    const sy = a.y + tH;
    if (straight) {
      push(e, [[sx, sy, sx, b.y]], arrowHead(sx, b.y, "down"), {
        x: sx,
        y: b.y - 16,
        w: pw,
        h: PILL_H,
      });
      continue;
    }
    const g = (gutters[wc.col] = (gutters[wc.col] || 0) + 1) - 1;
    const gx = colX(wc.col) + cardW + tGap / 2 + [0, -8, 8][g % 3];
    const wy = entry(e, b, "y");
    push(
      e,
      [
        [sx, sy, sx, ly],
        [sx, ly, gx, ly],
        [gx, ly, gx, wy],
        [gx, wy, b.x + b.w, wy],
      ],
      arrowHead(b.x + b.w, wy, "left"),
      { x: (sx + gx) / 2, y: ly, w: pw, h: PILL_H },
    );
  }
  return {
    cards: pos,
    lines,
    bottom: bottom + 24,
    header: { x: colX(0), y: bottom },
    crowded: crowdedOf(),
  };
}
