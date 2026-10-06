/**
 * teamDirectory.js — the AI Assistant's view of teams (bot-teams TEAM-004).
 *
 * Pure helpers behind the Dash MCP team tools: which dashboards have a team
 * (a lead or members), finding a dashboard by name or id, and a cap on how
 * many leads one question can fan out to.
 */
"use strict";

const sameId = (a, b) =>
  a !== null &&
  a !== undefined &&
  b !== null &&
  b !== undefined &&
  String(a) === String(b);

/**
 * Dashboards with a lead or at least one member bot.
 * @param {{ workspaces: object[], bots: object[], lastRunAt: (botId: string) => string|null }} args
 */
function summarizeTeams({ workspaces, bots, lastRunAt }) {
  const out = [];
  for (const ws of workspaces || []) {
    const team = (bots || []).filter((b) => sameId(b.workspaceId, ws.id));
    if (!team.length) continue;
    const lead = team.find((b) => b.role === "lead") || null;
    const members = team.filter((b) => b.role !== "lead");
    let last = null;
    for (const b of team) {
      const t = lastRunAt(b.id);
      if (t && (!last || Date.parse(t) > Date.parse(last))) last = t;
    }
    out.push({
      id: String(ws.id),
      name: ws.name || "Untitled",
      bots: members.length,
      hasLead: !!lead,
      lead: lead ? lead.name : null,
      lastActivity: last,
    });
  }
  return out;
}

/**
 * Team leads the user can message directly from the AI Assistant's "To:"
 * picker (bot-teams TEAM-013): one entry per dashboard that has a lead, in
 * dashboard order, with running state and availability. Dashboards whose
 * names match (any case) get a numbered label so the picker can tell them
 * apart.
 * @param {{ workspaces: object[], bots: object[],
 *           availability: (botId: string) => { paused: boolean, overBudget: boolean },
 *           isRunning: (botId: string) => boolean }} args
 */
function summarizeLeads({ workspaces, bots, availability, isRunning }) {
  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch (_e) {
      return fallback;
    }
  };
  const nameCounts = {};
  for (const ws of workspaces || []) {
    const key = String(ws.name || "Untitled").toLowerCase();
    nameCounts[key] = (nameCounts[key] || 0) + 1;
  }
  const seen = {};
  const out = [];
  for (const ws of workspaces || []) {
    const lead = (bots || []).find(
      (b) => b.role === "lead" && sameId(b.workspaceId, ws.id),
    );
    if (!lead) continue;
    const name = ws.name || "Untitled";
    const key = name.toLowerCase();
    seen[key] = (seen[key] || 0) + 1;
    const avail = safe(() => availability(lead.id), null) || {};
    out.push({
      botId: lead.id,
      leadName: lead.name || "Team lead",
      dashboardId: String(ws.id),
      dashboardName: name,
      dashboardLabel: nameCounts[key] > 1 ? `${name} (${seen[key]})` : name,
      running: !!safe(() => isRunning(lead.id), false),
      paused: !!avail.paused,
      overBudget: !!avail.overBudget,
    });
  }
  return out;
}

/**
 * Find a dashboard by id or name: exact id, then exact name (any case), then
 * a unique partial name match.
 * @returns {{ match: object } | { ambiguous: object[] } | { none: true }}
 */
function resolveDashboard(workspaces, query) {
  const q = String(query || "").trim();
  if (!q) return { none: true };
  const list = workspaces || [];
  const byId = list.find((w) => String(w.id) === q);
  if (byId) return { match: byId };
  const lower = q.toLowerCase();
  const exact = list.filter((w) => (w.name || "").toLowerCase() === lower);
  if (exact.length === 1) return { match: exact[0] };
  if (exact.length > 1) return { ambiguous: exact };
  const partial = list.filter((w) =>
    (w.name || "").toLowerCase().includes(lower),
  );
  if (partial.length === 1) return { match: partial[0] };
  if (partial.length > 1) return { ambiguous: partial };
  return { none: true };
}

/**
 * At most `limit` lead questions per rolling window — a question spanning
 * all teams fans out to each lead, and every ask is a real run.
 */
class AskCap {
  constructor({ limit = 5, windowMs = 120000, now = () => Date.now() } = {}) {
    this._limit = limit;
    this._windowMs = windowMs;
    this._now = now;
    this._times = [];
  }

  /** @returns {boolean} whether another ask is allowed (and records it) */
  take() {
    const t = this._now();
    this._times = this._times.filter((x) => t - x < this._windowMs);
    if (this._times.length >= this._limit) return false;
    this._times.push(t);
    return true;
  }
}

module.exports = { summarizeTeams, summarizeLeads, resolveDashboard, AskCap };
