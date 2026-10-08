/**
 * teamDiagram.js — what the Bots view's team diagram draws (bot-teams PRD
 * TEAM-014): which team bot runs after which (from `subscriptions` to bot
 * events), each bot's "runs after" / "then triggers", and where the cards go.
 *
 * Bot events are `bot:<ref>[<botId>].<event>` (electron/bots/botEvents.js);
 * events: `completed`, `failed`, `tool.<providerType>.<tool>`.
 *
 * Pure: no React, no IPC.
 */
import {
  buildBotEventCatalog,
  botSubscription,
} from "../Settings/details/eventCatalog";

const BOT_EVENT_RE = /^bot:(.+)\[([^\]]+)\]\.(.+)$/;

const slugify = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "bot";

/** The bot's event ref — mirrors botRef in electron/bots/botEvents.js. */
export const botRefOf = (bot) =>
  (bot && bot.ref) || `local/${slugify(bot && bot.name)}`;

/** @returns {{ ref, botId, event } | null} */
export function parseBotEventType(eventType) {
  const m = typeof eventType === "string" && eventType.match(BOT_EVENT_RE);
  return m ? { ref: m[1], botId: m[2], event: m[3] } : null;
}

/** "completed" | "failed" | "tool" */
export function eventKind(event) {
  if (event === "failed") return "failed";
  if (event === "completed") return "completed";
  return "tool";
}

/** "completed", "failed", "tool · gmail.send_email" */
export function eventText(event) {
  const kind = eventKind(event);
  if (kind !== "tool") return kind;
  return `tool · ${String(event).replace(/^tool\./, "")}`;
}

const botSubs = (bot) =>
  ((bot && bot.subscriptions) || [])
    .map((sub) => ({ sub, parsed: parseBotEventType(sub && sub.eventType) }))
    .filter((x) => x.parsed);

/**
 * One edge per subscription from a team bot to another team bot. The lead
 * isn't triggered by or wired to events, so it's never an end; nor are bots on
 * other dashboards, deleted bots, or a bot listening to itself.
 */
export function diagramEdges(members = [], lead = null) {
  const ids = new Set((members || []).map((b) => b && b.id));
  if (lead) ids.delete(lead.id);
  const edges = [];
  for (const to of members || []) {
    if (!to || !ids.has(to.id)) continue;
    for (const { sub, parsed } of botSubs(to)) {
      if (!ids.has(parsed.botId) || parsed.botId === to.id) continue;
      edges.push({
        key: `${to.id}|${sub.eventType}`,
        eventType: sub.eventType,
        note: sub.note || null,
        from: parsed.botId,
        to: to.id,
        event: parsed.event,
        kind: eventKind(parsed.event),
        label: sub.label || null,
      });
    }
  }
  return edges;
}

/**
 * Every bot this one listens to (for the summary) — including bots on other
 * dashboards (`offTeam`) and deleted ones.
 */
export function runsAfter(bot, team = [], nameOf = () => null) {
  // team: the dashboard's bots, lead included.
  const byId = new Map((team || []).filter(Boolean).map((b) => [b.id, b]));
  return botSubs(bot).map(({ parsed }) => {
    const local = byId.get(parsed.botId);
    return {
      botId: parsed.botId,
      name: (local && local.name) || nameOf(parsed.botId) || "Deleted bot",
      event: parsed.event,
      offTeam: !local,
    };
  });
}

/** The team bots that run after this one. */
export function thenTriggers(botId, members = []) {
  const out = [];
  for (const b of members || []) {
    for (const { parsed } of botSubs(b)) {
      if (parsed.botId === botId && b.id !== botId) {
        out.push({ botId: b.id, name: b.name, event: parsed.event });
      }
    }
  }
  return out;
}

/**
 * Card positions: the lead centred on top, the team's bots in rows below —
 * one row when it fits, otherwise wrapped so cards never get narrower than
 * `minW`.
 */
export function diagramLayout({
  width,
  count,
  gap = 20,
  minW = 200,
  maxW = 240,
  cardH = 76,
  leadTop = 24,
  rowTop = 190,
  rowH = 170,
}) {
  const avail = Math.max(Number(width) || 0, minW + gap * 2);
  const n = Math.max(0, count || 0);
  const cols = Math.max(
    1,
    Math.min(n || 1, Math.floor((avail - gap) / (minW + gap))),
  );
  const cardW = Math.max(
    minW,
    Math.min(maxW, Math.floor((avail - gap * (cols + 1)) / cols)),
  );
  const rowW = cols * cardW + (cols - 1) * gap;
  const start = Math.max(gap, (avail - rowW) / 2);
  const cards = [];
  for (let i = 0; i < n; i++) {
    cards.push({
      x: start + (i % cols) * (cardW + gap),
      y: rowTop + Math.floor(i / cols) * rowH,
    });
  }
  const leadW = Math.min(320, cardW + 80);
  const rows = Math.ceil(n / cols);
  return {
    cols,
    cardW,
    cardH,
    lead: { x: (avail - leadW) / 2, y: leadTop, w: leadW },
    busY: Math.round((leadTop + cardH + rowTop) / 2),
    cards,
    width: avail,
    height: (n ? rowTop + (rows - 1) * rowH + cardH : leadTop + cardH) + 110,
  };
}

/**
 * The keys of every line that's part of a loop (TEAM-014 AC11): a line
 * from → to is in a loop when `to` can reach `from` again.
 */
export function loopEdges(edges = []) {
  const next = new Map();
  for (const e of edges) {
    if (!next.has(e.from)) next.set(e.from, new Set());
    next.get(e.from).add(e.to);
  }
  const reaches = (start, goal) => {
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop();
      if (id === goal) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const n of next.get(id) || []) stack.push(n);
    }
    return false;
  };
  return new Set(edges.filter((e) => reaches(e.to, e.from)).map((e) => e.key));
}

/**
 * What a bot can trigger others on (TEAM-014 AC8): Completed, Failed, and
 * each tool it may use — the same list as the Settings picker
 * (buildBotEventCatalog), for a bot with or without a saved ref.
 */
export function eventChoices(bot, toolSources = []) {
  if (!bot) return [];
  const [entry] = buildBotEventCatalog(
    [{ ...bot, ref: botRefOf(bot) }],
    toolSources,
  );
  return entry ? entry.events : [];
}

const subscriptionFor = (source, event, label, note) => {
  const sub = botSubscription(
    { botId: source.id, ref: botRefOf(source), name: source.name || source.id },
    { event, label },
  );
  const text = typeof note === "string" ? note.trim() : "";
  return text ? { ...sub, note: text } : sub;
};

/**
 * `target` with a trigger on `source`'s event added — the same subscription
 * the Settings picker makes, plus the owner's note. Adding one it already
 * has replaces it (no duplicates).
 */
export function addTrigger(target, source, event, label, note) {
  const sub = subscriptionFor(source, event, label, note);
  const rest = (target.subscriptions || []).filter(
    (s) => !s || s.eventType !== sub.eventType,
  );
  return { ...target, subscriptions: [...rest, sub] };
}

/** `target` with the trigger `oldEventType` changed (event and/or note). */
export function updateTrigger(
  target,
  oldEventType,
  source,
  event,
  label,
  note,
) {
  const sub = subscriptionFor(source, event, label, note);
  const subs = (target.subscriptions || []).filter(
    (s) => s && s.eventType !== sub.eventType,
  );
  const at = subs.findIndex((s) => s.eventType === oldEventType);
  if (at < 0) return addTrigger(target, source, event, label, note);
  const nextSubs = [...subs];
  nextSubs[at] = sub;
  return { ...target, subscriptions: nextSubs };
}

/** `target` without the trigger `eventType`. */
export function removeTrigger(target, eventType) {
  return {
    ...target,
    subscriptions: (target.subscriptions || []).filter(
      (s) => !s || s.eventType !== eventType,
    ),
  };
}
