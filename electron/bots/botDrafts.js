/**
 * botDrafts.js — a team lead's proposed bot (bot-teams TEAM-005).
 *
 * The lead's propose_bot tool hands in a free-form proposal; buildDraft turns
 * it into a draft that only uses what the user actually has:
 *   - providers/tools from Settings › Providers (as listToolSources reports
 *     them) — offered as *suggestions*; the draft's own mcpServers and
 *     toolSelections stay empty until the user picks them in the form;
 *   - a schedule only if its cron parses;
 *   - event subscriptions only to this team's bots' real events;
 *   - anything else is dropped (and said so), or listed as missing.
 * The lead never saves or runs a draft — DraftStore just holds it until the
 * user saves or discards it in the Bots view.
 */
"use strict";

const crypto = require("crypto");
const { Cron } = require("croner");
const { botRef, botEventType } = require("./botEvents");
const { validateBotDefinition, withDefaults } = require("./botSchema");

const BOT_EVENTS = ["completed", "failed"];
const MAX_NAME = 80;
const MAX_INSTRUCTIONS = 8000;
const MAX_REASONING = 1000;
const MAX_PER_DASHBOARD = 10;

const str = (v, max) =>
  String(v === undefined || v === null ? "" : v)
    .trim()
    .slice(0, max);
const lower = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

function cronIsValid(expr) {
  try {
    const job = new Cron(expr, { paused: true });
    job.stop();
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * @param {{ proposal: object, sources: object[], team: object[],
 *           workspaceId: string, leadId: string, now?: () => string }} args
 * @returns {{ draft: object } | { error: string }}
 */
function buildDraft({
  proposal = {},
  sources = [],
  team = [],
  workspaceId,
  leadId,
  now,
}) {
  const name = str(proposal.name, MAX_NAME);
  const instructions = str(proposal.instructions, MAX_INSTRUCTIONS);
  if (!name) return { error: "A draft needs a name." };
  if (!instructions) return { error: "A draft needs instructions." };

  const dropped = [];
  const missing = [];
  // Longer "needs" entries are the lead's notes, not provider names.
  const notes = [];

  // Providers and tools → suggestions the user accepts in the form.
  const suggestions = [];
  for (const p of Array.isArray(proposal.providers) ? proposal.providers : []) {
    const wanted = str(p && p.name, 200);
    if (!wanted) continue;
    // By name first; else by type ("gmail" → each Gmail provider the user
    // has) — the lead can't see the user's provider names.
    const byName = sources.filter((s) => lower(s.name) === lower(wanted));
    const matches = byName.length
      ? byName
      : sources.filter((s) => s.type && lower(s.type) === lower(wanted));
    if (!matches.length) {
      if (!missing.includes(wanted)) missing.push(wanted);
      continue;
    }
    const asked = (Array.isArray(p.tools) ? p.tools : [])
      .map((t) => str(t, 200))
      .filter(Boolean);
    for (const src of matches) {
      if (suggestions.some((x) => x.provider === src.name)) continue;
      const known = Array.isArray(src.tools) ? src.tools : null;
      const tools = known ? asked.filter((t) => known.includes(t)) : asked;
      for (const t of asked) {
        if (known && !known.includes(t))
          dropped.push(`Tool "${t}" — ${src.name} doesn't have it.`);
      }
      suggestions.push({ provider: src.name, tools, toolsChecked: !!known });
    }
  }
  for (const need of Array.isArray(proposal.needs) ? proposal.needs : []) {
    const n = str(need, 300);
    if (!n) continue;
    if (n.length > 40) {
      notes.push(n);
      continue;
    }
    const have = sources.some(
      (s) => lower(s.name) === lower(n) || lower(s.type) === lower(n),
    );
    if (!have && !missing.includes(n)) missing.push(n);
  }

  // Schedule (optional).
  const schedules = [];
  const sched = proposal.schedule;
  if (sched && sched.cron) {
    const cron = str(sched.cron, 100);
    if (cronIsValid(cron)) {
      const entry = { cron };
      const prompt = str(sched.prompt, 500);
      if (prompt) entry.prompt = prompt;
      schedules.push(entry);
    } else {
      dropped.push(`Schedule "${cron}" — not a valid schedule.`);
    }
  }

  // Event subscriptions: only this team's bots' real events.
  const subscriptions = [];
  for (const on of Array.isArray(proposal.on) ? proposal.on : []) {
    const botName = str(on && on.bot, 200);
    const event = str(on && on.event, 50);
    const member = team.find(
      (b) => b.role !== "lead" && lower(b.name) === lower(botName),
    );
    if (!member || !BOT_EVENTS.includes(event)) {
      dropped.push(
        `Event "${botName || "?"} › ${event || "?"}" — not a known event on this team.`,
      );
      continue;
    }
    subscriptions.push({
      eventType: botEventType(member, event),
      label: `${member.name} › ${event}`,
      source: {
        kind: "bot",
        ref: botRef(member),
        instanceId: member.id,
        event,
        workspaceId: String(workspaceId),
      },
    });
  }

  const definition = withDefaults({
    name,
    instructions,
    workspaceId: String(workspaceId),
    mcpServers: [],
    toolSelections: {},
    approvalPolicy: "ask",
    schedules,
    subscriptions,
  });
  delete definition.session;
  const { valid, errors } = validateBotDefinition(definition);
  if (!valid) return { error: `The draft isn't valid: ${errors.join("; ")}` };

  const dup = team.find(
    (b) => b.role !== "lead" && lower(b.name) === lower(name),
  );
  return {
    draft: {
      id: `draft_${crypto.randomBytes(6).toString("hex")}`,
      workspaceId: String(workspaceId),
      leadId: leadId || null,
      createdAt: (now || (() => new Date().toISOString()))(),
      reasoning: str(proposal.reasoning, MAX_REASONING),
      definition,
      suggestions,
      missing,
      dropped,
      duplicateOf: dup ? dup.name : null,
      notes,
      // What the user has, so the lead can retry when something's missing.
      available: missing.length
        ? sources.map((s) => (s.type ? `${s.name} (${s.type})` : s.name))
        : [],
    },
  };
}

/** Drafts waiting for the user, per dashboard (in memory; not persisted). */
class DraftStore {
  constructor({ maxPerDashboard = MAX_PER_DASHBOARD } = {}) {
    this._max = maxPerDashboard;
    this._drafts = [];
    this._listeners = new Set();
  }

  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _changed() {
    for (const l of this._listeners) {
      try {
        l();
      } catch (_e) {
        // a listener's bug must not break the store
      }
    }
  }

  add(draft) {
    this._drafts.push(draft);
    const mine = this._drafts.filter(
      (d) => d.workspaceId === draft.workspaceId,
    );
    if (mine.length > this._max) {
      const drop = new Set(
        mine.slice(0, mine.length - this._max).map((d) => d.id),
      );
      this._drafts = this._drafts.filter((d) => !drop.has(d.id));
    }
    this._changed();
    return draft;
  }

  list(workspaceId) {
    return this._drafts.filter((d) => d.workspaceId === String(workspaceId));
  }

  get(id) {
    return this._drafts.find((d) => d.id === id) || null;
  }

  remove(id) {
    const before = this._drafts.length;
    this._drafts = this._drafts.filter((d) => d.id !== id);
    const removed = this._drafts.length !== before;
    if (removed) this._changed();
    return removed;
  }
}

module.exports = { buildDraft, DraftStore, BOT_EVENTS };
