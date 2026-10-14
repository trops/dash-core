/**
 * contactsList.js — the Bots dock's contacts list (bot-teams PRD TEAM-015):
 * every user bot as a contact, its latest activity on the row, grouped by
 * dashboard or one list, newest activity first or A–Z.
 *
 * Pure: no React, no IPC.
 */
import { groupBotsByTeam } from "./teamUtils";
import { toPlainText } from "./botConversation";

export const SORTS = ["recent", "az"];

const lower = (v) => String(v || "").toLowerCase();

/** "now" · "4m" · "3h" · "Tue" · "Sep 30" — a row's time, kept short. */
export function shortTime(iso, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = new Date(t);
  if (h < 24 * 6) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * One contact: what the row says and how it sorts.
 * @returns {{ bot, id, name, isLead, status, line, at, approvals: number }}
 *   status: "Needs approval" | "Running" | "Paused" | "Failed" | "Idle"
 */
export function contactOf(bot, { last, running, approvals, paused, now }) {
  const mine = (approvals || []).filter(
    (a) => a && a.request && a.request.botId === bot.id,
  );
  const run = (running || []).find((r) => r && r.id === bot.id);
  const isPaused = !!(paused && paused.has(bot.id));
  let status = "Idle";
  let line = "Hasn't run yet";
  let at = last ? last.at : null;
  if (last) {
    if (last.status === "failed") {
      status = "Failed";
      line = `Failed · ${last.error || "see Activity"}`;
    } else {
      line = toPlainText(last.text || "") || "Done";
    }
  }
  if (isPaused) {
    status = "Paused";
    line = "Paused";
  }
  if (run) {
    status = "Running";
    line = "Running now…";
    at = run.startedAt || new Date(now || Date.now()).toISOString();
  }
  if (mine.length) {
    status = "Needs approval";
    const tool = mine[0].request.toolName;
    line = `Needs approval${tool ? ` · ${tool}` : ""}`;
    at = mine[0].createdAt || at;
  }
  return {
    bot,
    id: bot.id,
    name: bot.name || bot.id,
    isLead: bot.role === "lead",
    status,
    line,
    at,
    approvals: mine.length,
  };
}

const atOf = (c) => {
  const t = c.at ? Date.parse(c.at) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

function sortContacts(list, sort) {
  const byName = (a, b) => lower(a.name).localeCompare(lower(b.name));
  return list.slice().sort((a, b) => {
    if (sort === "az") return byName(a, b);
    // Needing you first, then newest activity; quiet bots by name.
    if (!!b.approvals !== !!a.approvals) return b.approvals ? 1 : -1;
    return atOf(b) - atOf(a) || byName(a, b);
  });
}

/**
 * The contacts list's sections.
 * @param {object} args
 *   bots, workspaces, lastRuns ({ [botId]: { at, status, text, error } }),
 *   running, approvals, paused (Set of bot ids), sort ("recent" | "az"),
 *   byTeam, query, now
 * @returns {Array<{ key, label, contacts }>} — one section ("All bots") when
 *   not grouped; empty sections left out.
 */
export function contactSections({
  bots = [],
  workspaces = [],
  lastRuns = {},
  running = [],
  approvals = [],
  paused = new Set(),
  sort = "recent",
  byTeam = true,
  query = "",
  now = Date.now(),
} = {}) {
  const q = lower(query).trim();
  const visible = (bots || []).filter(
    (b) => b && b.id && (!q || lower(b.name).includes(q)),
  );
  const contact = (b) =>
    contactOf(b, {
      last: lastRuns[b.id] || null,
      running,
      approvals,
      paused,
      now,
    });
  if (!byTeam) {
    const contacts = sortContacts(visible.map(contact), sort);
    return contacts.length ? [{ key: "all", label: "All bots", contacts }] : [];
  }
  const groups = groupBotsByTeam(visible, workspaces).map((g) => ({
    key: g.workspaceId === null ? "none" : g.workspaceId,
    label: g.workspaceId === null ? "No dashboard" : g.label,
    contacts: sortContacts(g.bots.map(contact), sort),
  }));
  if (sort === "az") {
    // Dashboards A–Z too; bots on no dashboard last.
    return groups.sort((a, b) =>
      a.key === "none"
        ? 1
        : b.key === "none"
          ? -1
          : lower(a.label).localeCompare(lower(b.label)),
    );
  }
  // Recent: the team with the newest activity (or something waiting) first.
  const lead = (g) => g.contacts[0];
  return groups.sort((a, b) => {
    const x = lead(a);
    const y = lead(b);
    if (!!y.approvals !== !!x.approvals) return y.approvals ? 1 : -1;
    return atOf(y) - atOf(x);
  });
}

/** The first bot waiting on an approval (the "Needs you" banner opens it). */
export function firstWaiting(approvals, bots) {
  const ids = new Set((bots || []).map((b) => b && b.id));
  const a = (approvals || []).find(
    (x) => x && x.request && ids.has(x.request.botId),
  );
  return a ? a.request.botId : null;
}
