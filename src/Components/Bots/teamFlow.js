/**
 * teamFlow.js — the readable team diagram (DASH-139): bots in work order
 * with short arrows between neighbours, bots a bot hands on to stacked in
 * the next column, helpers in their own lane, which lines show for the
 * Lines toggle, each card's lines of text, and the selected bot's
 * connections panel (the events it publishes and who listens to each).
 *
 * Edges are diagramEdges() (teamDiagram.js) and widgetEdges()
 * (widgetDiagram.js). Bot events are `completed`, `failed`,
 * `result.<name>` and `tool.<providerType>.<tool>` (electron/bots/botEvents.js).
 *
 * Pure: no React, no IPC.
 */
import { handsOnTargets } from "./checksView";
import { arrowHead } from "./teamDiagram";
import { triggerSummary } from "./teamUtils";

/** The Lines toggle: only the selected bot's, every bot-to-bot one, or all. */
export const LINES = [
  { value: "selected", label: "Selected bot" },
  { value: "flow", label: "Work flow" },
  { value: "all", label: "All, with widgets" },
];
export const DEFAULT_LINES = "selected";
export const linesOrDefault = (v) =>
  LINES.some((l) => l.value === v) ? v : DEFAULT_LINES;

/** "completed" | "failed" | "result" | "tool" */
export function eventGroup(event) {
  const e = String(event || "");
  if (e === "completed" || e === "failed") return e;
  if (e.startsWith("result.")) return "result";
  return "tool";
}

/** A handoff is any line that isn't a failure route. */
const isHandoff = (e) => e && e.kind !== "failed";

/** The box heading for one of a bot's events in its panel. */
export function eventTitle(event, label = null) {
  const g = eventGroup(event);
  if (g === "completed") return "On Complete";
  if (g === "failed") return "On Failure";
  if (g === "result") return `On Result · ${String(event).slice(7)}`;
  return label || String(event).replace(/^tool\./, "");
}

/** "when it completes", "when it fails", "when it sends prUrl", "when it uses github.push". */
export function whenText(event) {
  const g = eventGroup(event);
  if (g === "completed") return "when it completes";
  if (g === "failed") return "when it fails";
  if (g === "result") return `when it sends ${String(event).slice(7)}`;
  return `when it uses ${String(event).replace(/^tool\./, "")}`;
}

/** The label a new subscription gets ("Completed", "Failed", the result's). */
function labelFor(event, choices = []) {
  const c = (choices || []).find((x) => x && x.event === event);
  if (c && c.label) return c.label;
  const g = eventGroup(event);
  if (g === "completed") return "Completed";
  if (g === "failed") return "Failed";
  if (g === "result") return String(event).slice(7);
  return String(event).replace(/^tool\./, "");
}

// ── Helpers: bots used only inside another bot's checks ──────────────

/**
 * Who uses each team bot as a reviewer in their checks:
 * Map<helperId, [{ botId, name, check }]>.
 */
export function reviewerUses(members = []) {
  const ids = new Set((members || []).filter(Boolean).map((b) => b.id));
  const out = new Map();
  for (const m of members || []) {
    if (!m) continue;
    for (const s of (m.checks && m.checks.steps) || []) {
      if (!s || s.kind !== "reviewer" || !s.botId) continue;
      if (!ids.has(s.botId) || s.botId === m.id) continue;
      if (!out.has(s.botId)) out.set(s.botId, []);
      out.get(s.botId).push({
        botId: m.id,
        name: m.name,
        check: s.name || "Reviewer",
      });
    }
  }
  return out;
}

/**
 * The helper lane: bots some team bot uses in its checks that have no line
 * of their own (nothing hands them work, they hand nothing on). A wired
 * reviewer stays in the flow; a failure route alone doesn't count.
 */
export function helperIds(members = [], edges = []) {
  const uses = reviewerUses(members);
  const wired = new Set();
  for (const e of (edges || []).filter(isHandoff)) {
    wired.add(e.from);
    wired.add(e.to);
  }
  return new Set([...uses.keys()].filter((id) => !wired.has(id)));
}

/** The helpers a bot uses in its checks: [{ botId, name, check }]. */
export function helpersOf(bot, members = []) {
  if (!bot) return [];
  const byId = new Map((members || []).filter(Boolean).map((b) => [b.id, b]));
  return ((bot.checks && bot.checks.steps) || [])
    .filter((s) => s && s.kind === "reviewer" && s.botId && s.botId !== bot.id)
    .map((s) => {
      const b = byId.get(s.botId);
      return {
        botId: s.botId,
        name: (b && b.name) || "A bot not on this team",
        check: s.name || "Reviewer",
        onTeam: !!b,
      };
    });
}

// ── Work order ─────────────────────────────────────────────────────────

/**
 * The flow as columns, left to right: `{ main, ids }` — `ids` is one bot,
 * or the bots one hands on to stacked (main first; the flow carries on from
 * the main one, the one whose work goes on). Chains start at bots nothing
 * hands work to; bots with no lines come next; bots that only get work
 * later in a loop, or only failures (a reporter), come last. Every bot is
 * in one column; a bot already placed stays put.
 *
 * @param {object[]} members  the team (lead not included)
 * @param {object[]} edges    diagramEdges()
 * @param {Set<string>} skip  bots not in the flow (the helper lane)
 */
export function workOrder(members = [], edges = [], skip = new Set()) {
  const ids = (members || [])
    .filter((b) => b && !skip.has(b.id))
    .map((b) => b.id);
  const inFlow = new Set(ids);
  const rank = new Map(ids.map((id, i) => [id, i]));
  const next = new Map(ids.map((id) => [id, []]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  for (const e of edges || []) {
    if (!e || !inFlow.has(e.from) || !inFlow.has(e.to) || e.from === e.to) {
      continue;
    }
    incoming.set(e.to, incoming.get(e.to) + 1);
    if (isHandoff(e) && !next.get(e.from).includes(e.to)) {
      next.get(e.from).push(e.to);
    }
  }
  for (const list of next.values()) {
    list.sort((a, b) => rank.get(a) - rank.get(b));
  }
  const placed = new Set();
  const columns = [];
  const open = (id) => next.get(id).filter((t) => !placed.has(t));
  const walk = (start) => {
    if (placed.has(start)) return;
    let cur = start;
    placed.add(cur);
    columns.push({ main: cur, ids: [cur] });
    for (;;) {
      const targets = open(cur);
      if (!targets.length) return;
      targets.forEach((t) => placed.add(t));
      const main = targets.find((t) => open(t).length) || targets[0];
      columns.push({ main, ids: [main, ...targets.filter((t) => t !== main)] });
      cur = main;
    }
  };
  const starts = ids.filter((id) => incoming.get(id) === 0);
  starts.filter((id) => next.get(id).length).forEach(walk);
  starts.filter((id) => !next.get(id).length).forEach(walk);
  ids.forEach(walk);
  return columns;
}

/** How many columns fit a row: cards share the row width, at most `max`. */
export function perRowFor(width, { minCard = 168, gutter = 28, max = 4 } = {}) {
  const w = Number(width) || 0;
  if (w <= 0) return max;
  return Math.max(
    1,
    Math.min(max, Math.floor((w + gutter) / (minCard + gutter))),
  );
}

/** The columns cut into rows of `perRow`. */
export function flowRows(columns = [], perRow = 4) {
  const n = Math.max(1, perRow || 1);
  const rows = [];
  for (let i = 0; i < columns.length; i += n)
    rows.push(columns.slice(i, i + n));
  return rows;
}

/**
 * The arrow between each pair of neighbouring columns in a row:
 * `{ key, kind: "none" | "single" | "fork", edges, to }`. A fork points at
 * each stacked bot it hands on to.
 */
export function neighbourArrows(rows = [], edges = []) {
  const handoffs = (edges || []).filter(isHandoff);
  return rows.map((row, r) =>
    row.slice(0, -1).map((a, i) => {
      const b = row[i + 1];
      const es = handoffs.filter(
        (e) => a.ids.includes(e.from) && b.ids.includes(e.to),
      );
      const to = b.ids.filter((id) => es.some((e) => e.to === id));
      return {
        key: `${r}:${i}`,
        kind: !es.length ? "none" : b.ids.length > 1 ? "fork" : "single",
        edges: es,
        to,
      };
    }),
  );
}

/** The keys of the lines drawn as neighbour arrows. */
export const arrowKeys = (arrows = []) =>
  new Set(arrows.flat().flatMap((a) => a.edges.map((e) => e.key)));

/**
 * What the Lines toggle shows:
 * - `lines`: drawn lines (bot → bot handoffs that aren't neighbour arrows,
 *   and in "all" bot → widget lines) `{ key, from, to, kind, widget }`.
 *   "selected": only the selected bot's; "flow": every handoff; "all": every
 *   handoff and widget line. Failure routes are never drawn (each card says
 *   where its failures go).
 * - `showWidgets`: the widget lane is shown ("all" only).
 * - `lit`: bots linked to the selected one (any line, a helper it uses or
 *   a bot that uses it); `failLit`: the bots getting its failures. When a
 *   bot is selected everything else is dimmed.
 */
export function lineSet({
  mode = DEFAULT_LINES,
  selectedId = null,
  edges = [],
  wEdges = [],
  covered = new Set(),
  members = [],
} = {}) {
  const m = linesOrDefault(mode);
  const touches = (e) =>
    !!selectedId && (e.from === selectedId || e.to === selectedId);
  const handoffs = (edges || []).filter(
    (e) => isHandoff(e) && !covered.has(e.key),
  );
  const botLines = (m === "selected" ? handoffs.filter(touches) : handoffs).map(
    (e) => ({
      key: e.key,
      from: e.from,
      to: e.to,
      kind: e.kind,
      hot: touches(e),
    }),
  );
  const showWidgets = m === "all";
  const widgetLines = showWidgets
    ? (wEdges || []).map((e) => ({
        key: e.key,
        from: e.from,
        to: `w:${e.widget}`,
        kind: e.kind,
        widget: e.widget,
        hot: e.from === selectedId,
      }))
    : [];
  const lit = new Set();
  const failLit = new Set();
  if (selectedId) {
    lit.add(selectedId);
    for (const e of edges || []) {
      if (!touches(e)) continue;
      lit.add(e.from);
      lit.add(e.to);
      if (e.kind === "failed" && e.from === selectedId) failLit.add(e.to);
    }
    for (const [helper, users] of reviewerUses(members)) {
      if (helper === selectedId) users.forEach((u) => lit.add(u.botId));
      if (users.some((u) => u.botId === selectedId)) lit.add(helper);
    }
    for (const e of wEdges || []) {
      if (e.from === selectedId) lit.add(`w:${e.widget}`);
    }
  }
  return {
    lines: [...botLines, ...widgetLines],
    showWidgets,
    lit,
    failLit,
    dim: !!selectedId,
  };
}

/**
 * How a card on the diagram is drawn while a bot is selected (DASH-139):
 * "selected" (the picked bot: the strongest style, decided first — it is in
 * `lit` too, and in `failLit` when it sends failures to itself), "failure"
 * (gets the selected bot's failures), "linked" (any other link: gets work
 * from / sends to / a helper), "dimmed" (unrelated), or null when nothing is
 * selected. Ids compare as strings, so a numeric id and its string form
 * match.
 *
 * @param {string|number} id
 * @param {string|number|null} selectedId
 * @param {{ lit: Set, failLit: Set }} shown  lineSet()
 */
export function cardState(id, selectedId, shown) {
  if (selectedId === null || selectedId === undefined || selectedId === "") {
    return null;
  }
  const key = String(id);
  const has = (set) =>
    !!set && (set.has(id) || [...set].some((v) => String(v) === key));
  if (key === String(selectedId)) return "selected";
  if (has(shown && shown.failLit)) return "failure";
  if (has(shown && shown.lit)) return "linked";
  return "dimmed";
}

// ── Line geometry (from measured card boxes { x, y, w, h }) ────────────

/**
 * A neighbour arrow: from the right edge of `a` to the left edge of `b`,
 * with an elbow in the gap when they aren't level (a fork to a stacked bot).
 */
export function elbowBetween(a, b) {
  const x1 = a.x + a.w;
  const y1 = a.y + Math.min(28, Math.round(a.h / 2));
  const x2 = b.x;
  const y2 = b.y + Math.min(28, Math.round(b.h / 2));
  const mx = Math.round((x1 + x2) / 2);
  const d =
    y1 === y2
      ? `M${x1},${y1} L${x2},${y2}`
      : `M${x1},${y1} H${mx} V${y2} H${x2}`;
  return { d, head: arrowHead(x2, y2, "right", 6) };
}

/**
 * A drawn line between cards that aren't neighbours: down from the bottom
 * of `a` into the top of `b` (or up into its bottom), or — on the same row
 * — a dip under the row into the bottom of `b`.
 */
export function curveBetween(a, b) {
  const ax = a.x + a.w / 2;
  const bx = b.x + b.w / 2;
  if (b.y >= a.y + a.h) {
    const y1 = a.y + a.h;
    const y2 = b.y;
    const c = Math.max(24, (y2 - y1) / 2);
    return {
      d: `M${ax},${y1} C${ax},${y1 + c} ${bx},${y2 - c} ${bx},${y2}`,
      head: arrowHead(bx, y2, "down", 6),
    };
  }
  if (b.y + b.h <= a.y) {
    const y1 = a.y;
    const y2 = b.y + b.h;
    const c = Math.max(24, (y1 - y2) / 2);
    return {
      d: `M${ax},${y1} C${ax},${y1 - c} ${bx},${y2 + c} ${bx},${y2}`,
      head: arrowHead(bx, y2, "up", 6),
    };
  }
  const y1 = a.y + a.h;
  const y2 = b.y + b.h;
  const dip = Math.max(y1, y2) + 24 + Math.abs(bx - ax) * 0.05;
  return {
    d: `M${ax},${y1} C${ax},${dip} ${bx},${dip} ${bx},${y2}`,
    head: arrowHead(bx, y2, "up", 6),
  };
}

// ── Card text ──────────────────────────────────────────────────────────

/**
 * A card's lines of text: `after` ("After Planner", or its trigger summary),
 * `failsTo` (names of the bots getting its failures) and `failures` (who
 * it gets failures from, as a line, or null).
 */
export function cardText(bot, members = [], edges = [], selectedId = null) {
  const byId = new Map((members || []).filter(Boolean).map((b) => [b.id, b]));
  const nameOf = (id) => (byId.get(id) && byId.get(id).name) || "a bot";
  const into = (edges || []).filter((e) => e.to === bot.id);
  const sources = [...new Set(into.filter(isHandoff).map((e) => e.from))];
  const subs = (bot.subscriptions || []).length;
  const scheduled = (bot.schedules || []).some((s) => s && s.cron);
  const after =
    sources.length === 1 && !scheduled && into.length === subs
      ? `After ${nameOf(sources[0])}`
      : triggerSummary(bot);
  const failsTo = [
    ...new Set(
      (edges || [])
        .filter((e) => e.from === bot.id && e.kind === "failed")
        .map((e) => nameOf(e.to)),
    ),
  ];
  const failFrom = [
    ...new Set(into.filter((e) => e.kind === "failed").map((e) => e.from)),
  ];
  let failures = null;
  if (failFrom.length) {
    failures =
      selectedId && failFrom.includes(selectedId)
        ? `Gets ${nameOf(selectedId)}'s failures`
        : failFrom.length === 1
          ? `Gets ${nameOf(failFrom[0])}'s failures`
          : `Gets failures from ${failFrom.length} bots`;
  }
  return { after, failsTo, failures };
}

// A check's rough cost and time: the same words as the checks window's list
// (DASH-127).
export { checkCost } from "./checkCost";

// ── The connections panel ──────────────────────────────────────────────

/**
 * Everything one bot is connected to, in the panel's order:
 * - `getsWorkFrom`: [{ botId, name, event, offTeam, when }] (runsAfter()).
 * - `events`: one box per event it publishes besides tools — completed,
 *   failed, one per declared result — `{ event, title, label, listeners,
 *   addChoices }`. Listeners are handsOnTargets() entries (bots and
 *   widgets); `addChoices` are `{ value: "bot:<id>" | "widget:<key>", label }`.
 * - `toolEvents`: the same for each tool event it can publish (`choices`
 *   from eventChoices()).
 * - `helpers`: helpersOf().
 *
 * @param {object} p
 * @param {object} p.bot
 * @param {object[]} p.members  the team (lead not included)
 * @param {object[]} p.widgets  diagramWidgets()
 * @param {object[]} p.wEdges   widgetEdges()
 * @param {object[]} p.choices  eventChoices(bot)
 * @param {object[]} p.after    runsAfter(bot, team, nameOf)
 * @param {string|null} p.mainNext  the bot the flow carries on to
 */
export function botConnections({
  bot,
  members = [],
  widgets = [],
  wEdges = [],
  choices = [],
  after = [],
  mainNext = null,
}) {
  if (!bot) return null;
  const base = ["completed", "failed"];
  for (const p of bot.publishes || []) {
    if (p && p.name) base.push(`result.${p.name}`);
  }
  for (const c of choices || []) {
    if (c && eventGroup(c.event) === "result" && !base.includes(c.event)) {
      base.push(c.event);
    }
  }
  const tools = (choices || [])
    .filter((c) => c && eventGroup(c.event) === "tool")
    .map((c) => c.event);
  const box = (event) => {
    const listeners = handsOnTargets(bot, members, widgets, wEdges, event).map(
      (t) => ({
        ...t,
        main:
          t.type === "bot" && t.id === mainNext && event === "completed"
            ? true
            : false,
      }),
    );
    const botTaken = new Set(
      listeners.filter((t) => t.type === "bot").map((t) => t.id),
    );
    const widgetTaken = new Set(
      listeners.filter((t) => t.type === "widget").map((t) => t.id),
    );
    const addChoices = [
      ...(members || [])
        .filter(
          (m) =>
            m && m.id !== bot.id && m.role !== "lead" && !botTaken.has(m.id),
        )
        .map((m) => ({ value: `bot:${m.id}`, label: `Bot · ${m.name}` })),
      ...(widgets || [])
        .filter((w) => !widgetTaken.has(w.key))
        .map((w) => ({
          value: `widget:${w.key}`,
          label: `Widget · ${w.label}`,
        })),
    ];
    const label = labelFor(event, choices);
    return {
      event,
      title: eventTitle(event, label),
      label,
      listeners,
      addChoices,
    };
  };
  return {
    getsWorkFrom: (after || []).map((a) => ({ ...a, when: whenText(a.event) })),
    events: base.map(box),
    toolEvents: tools.map(box),
    helpers: helpersOf(bot, members),
  };
}
