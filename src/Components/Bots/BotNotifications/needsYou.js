/**
 * needsYou.js — what needs the user, from every dashboard (lead-workspace
 * release 4, frames 22 and 27–29): a bot waiting for an OK, a bot whose
 * latest run failed, and a plan waiting for a yes in a conversation. Each
 * item says which bot asks and which dashboard it's on, and what it opens.
 * Pure.
 */
import { approvalText } from "../DashTeamApprovals";
import { errorNextSteps, readableError } from "../botConversation";

// A failure older than this isn't news any more.
const FAILURE_DAYS = 7;
// A plan nobody built after this long is left be.
const PLAN_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

const ms = (t) => (typeof t === "number" ? t : Date.parse(t) || 0);
const firstLine = (t) =>
  String(t || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) || "";
const clip = (t, max) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** A run's error as a person reads it, short: no engine wrapper. */
export function errorLine(error, max = 140) {
  const line = firstLine(readableError(error || "")).replace(
    /^(Claude Code|The engine) returned an error( result)?:\s*/i,
    "",
  );
  return clip(line, max);
}

/** "9:12 AM", or "Yesterday", or "Oct 21". */
export function whenText(at, now = Date.now()) {
  const t = ms(at);
  if (!t) return "";
  const d = new Date(t);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay)
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now - DAY);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Where a bot belongs, in words and as the conversation to open: a
 * dashboard's bot → its lead's; the Dash team → the Dash Lead; a bot on no
 * dashboard → itself.
 */
function placeOf(bot, { leads, dashboards }) {
  if (!bot) return { dashboard: null, name: "", open: null };
  if (bot.system || bot.dashTeam)
    return {
      dashboard: null,
      name: "Dash team",
      open: { key: "role:dashlead" },
    };
  const id = bot.workspaceId == null ? null : String(bot.workspaceId);
  if (!id) return { dashboard: null, name: "", open: { botId: bot.id } };
  const lead = (leads || []).find((l) => String(l.dashboardId) === id);
  return {
    dashboard: id,
    name:
      (dashboards && dashboards[id]) ||
      (lead && (lead.dashboardName || lead.dashboardLabel)) ||
      "",
    open: lead ? { key: `lead:${lead.botId}` } : { botId: bot.id },
  };
}

/**
 * What needs the user, newest first.
 * @param {object} p
 * @param {object[]} p.approvals   listApprovals()
 * @param {object[]} p.bots        the user's bots and the Dash team's
 * @param {object} p.lastRuns      { [botId]: { at, status, error, text } }
 * @param {object[]} p.running     ids of bots running now
 * @param {object[]} p.recents     listCreateRecent() summaries
 * @param {object[]} p.leads       useTeamLeads()
 * @param {object} p.dashboards    { [id]: name }
 * @param {string|null} p.current  the dashboard shown
 * @param {number} p.now
 * @param {number} p.seenAt        when the user last looked (for NEW)
 * @returns {object[]} items: { id, kind: "approval" | "failed" | "plan",
 *   at, who, where, title, text, convo?, isNew, open, … }
 */
export function needsYou({
  approvals = [],
  bots = [],
  lastRuns = {},
  running = [],
  recents = [],
  leads = [],
  dashboards = {},
  current = null,
  now = Date.now(),
  seenAt = 0,
} = {}) {
  const byId = new Map((bots || []).map((b) => [String(b.id), b]));
  const here = current == null ? null : String(current);
  const items = [];
  const tagged = (place) =>
    place.dashboard && place.dashboard !== here ? place.name : "";

  for (const a of approvals || []) {
    const req = (a && a.request) || {};
    const bot = byId.get(String(req.botId)) || null;
    const name = (bot && bot.name) || "A bot";
    const place = placeOf(bot, { leads, dashboards });
    items.push({
      id: `approval:${a.id}`,
      kind: "approval",
      approvalId: a.id,
      botId: req.botId,
      at: ms(a.createdAt) || now,
      who: place.name ? `${name} · ${place.name}` : name,
      where: tagged(place),
      // What it wants to do (frame 22): "Inbox Watch wants to use …".
      title: approvalText(req, name).replace(/\.$/, ""),
      text: req.reason ? String(req.reason) : "It waits for your answer.",
      open: place.open,
    });
  }

  // listRunning: [{ id, name, workspaceId, startedAt }].
  const busy = new Set(
    (running || []).map((r) =>
      String(r && typeof r === "object" ? r.id || r.botId : r),
    ),
  );
  for (const bot of bots || []) {
    const run = lastRuns && lastRuns[bot.id];
    if (!run || run.status !== "failed") continue;
    // Leads answer in their conversations; the Dash team in theirs.
    if (bot.role === "lead" || bot.system || bot.dashTeam) continue;
    if (busy.has(String(bot.id))) continue;
    const at = ms(run.at);
    if (!at || now - at > FAILURE_DAYS * DAY) continue;
    const error = errorLine(run.error || run.text || "");
    const place = placeOf(bot, { leads, dashboards });
    // A connection problem is fixed on the Providers page, not by trying again.
    const reconnect = errorNextSteps(error).some(
      (s) => s.action === "open-settings",
    );
    const servers = Array.isArray(bot.mcpServers) ? bot.mcpServers : [];
    items.push({
      id: `failed:${bot.id}:${at}`,
      kind: "failed",
      botId: bot.id,
      at,
      who: place.name ? `${bot.name} · ${place.name}` : bot.name,
      where: tagged(place),
      title: reconnect ? `${bot.name} couldn't run` : `${bot.name} failed`,
      text: error || "Its last run didn't finish.",
      reconnect,
      provider: reconnect && servers.length === 1 ? servers[0] : null,
      // Fixed on the bot's own page (its model, its connections).
      open: { botId: bot.id },
    });
  }

  for (const r of recents || []) {
    if (!r || r.kind !== "question" || !r.planned) continue;
    // Built, or building: nothing to say yes to any more.
    if (r.built && r.built !== "removed") continue;
    // When the plan came in — chatting on in its conversation isn't news.
    const at = ms(r.plannedAt) || ms(r.updatedAt);
    if (!at || now - at > PLAN_DAYS * DAY) continue;
    const key = r.with || "role:dashlead";
    const lead = key.startsWith("lead:")
      ? (leads || []).find((l) => `lead:${l.botId}` === key) || null
      : null;
    const leadName = lead ? lead.leadName : r.to || "Dash Lead";
    const dashboard = lead ? String(lead.dashboardId) : null;
    items.push({
      id: `plan:${r.id}`,
      kind: "plan",
      at,
      who: lead
        ? `Planner · Dash team, for ${leadName}`
        : "Planner · Dash team",
      where:
        dashboard && dashboard !== here
          ? (dashboards && dashboards[dashboard]) || lead.dashboardName || ""
          : "",
      title: `A plan is ready: ${clip(r.planName || r.title || "your plan", 48)}`,
      text: "It's waiting for your yes.",
      convo: `In your conversation with ${leadName} · “${clip(r.title || "Plan", 60)}”`,
      open: { key, recentId: r.id },
    });
  }

  return items
    .map((it) => ({ ...it, isNew: !!seenAt && it.at > seenAt }))
    .sort((a, b) => b.at - a.at);
}

export default needsYou;
