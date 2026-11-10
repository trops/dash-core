/**
 * botCopy.js — a copy of one of the user's bots, for the bot form (making a
 * bot in Create, "Copy one of your bots"). The copy is its own bot: what it
 * does comes along; what belongs to the original — its runs, its "Always
 * allow" approvals, its record — doesn't. Nothing is saved here. Pure.
 */

// What a bot does: copied (deeply — the copy shares nothing with it).
const COPIED = [
  "instructions",
  "provider",
  "model",
  "modelSelection",
  "engine",
  "style",
  "runLimits",
  "approvalPolicy",
  "whilePaused",
  "mcpServers",
  "toolSelections",
  "allowedTools",
  "schedules",
  "subscriptions",
  "publishes",
];

const norm = (id) =>
  id === undefined || id === null || id === "" ? null : String(id);

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// A trigger from a dashboard's widgets or bots fires only there.
const fromDashboard = (s) =>
  !!(s && s.source && (s.source.kind === "widget" || s.source.kind === "bot"));

/**
 * @param {object} bot  the bot to copy
 * @param {{ workspaceId?, dashboardName?, fromDashboardName? }} where  the
 *   dashboard the copy goes on (null: none), and the original's dashboard
 * @returns {{ initial: object, note: string }}  `initial` for BotDetail;
 *   `note` says what came along and what didn't
 */
export function botCopy(
  bot,
  { workspaceId = null, dashboardName = "", fromDashboardName = "" } = {},
) {
  const target = norm(workspaceId);
  const source = norm(bot && bot.workspaceId);
  const sameDashboard = target !== null && target === source;
  const initial = {};
  for (const k of COPIED) {
    if (bot && bot[k] !== undefined) initial[k] = clone(bot[k]);
  }
  const subs = Array.isArray(initial.subscriptions)
    ? initial.subscriptions
    : [];
  const kept = sameDashboard ? subs : subs.filter((s) => !fromDashboard(s));
  initial.subscriptions = kept;
  initial.name = `${(bot && bot.name) || "Bot"} (${
    !sameDashboard && target !== null && dashboardName ? dashboardName : "copy"
  })`;
  initial.workspaceId = target;

  const name = (bot && bot.name) || "the bot";
  const from = fromDashboardName ? ` on ${fromDashboardName}` : "";
  const what = [
    "instructions",
    "model",
    "providers and tools",
    "schedule",
    "approval policy",
    ...(sameDashboard && subs.length ? ["triggers"] : []),
  ].join(", ");
  const notCopied = sameDashboard
    ? "its runs and approvals you said to always allow"
    : `its runs, approvals you said to always allow, and triggers from ${
        fromDashboardName ? `${fromDashboardName}'s` : "other"
      } widgets and bots`;
  return {
    initial,
    note: `Copied from ${name}${from}: ${what}. Not copied: ${notCopied}. Nothing is saved until you click Create.`,
  };
}

/**
 * The bots a copy can start from, grouped by the dashboard they're on (by
 * name), then those on no dashboard. Leads and the Dash team aren't listed
 * — each dashboard has its own lead. `query` narrows by name.
 * @returns {Array<{ label: string, bots: object[] }>}
 */
export function copyCandidates(bots, dashboards, query = "") {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const names = new Map(
    (dashboards || [])
      .filter((d) => d && d.id !== undefined && d.id !== null)
      .map((d) => [String(d.id), d.name || "Dashboard"]),
  );
  const groups = new Map();
  const lone = [];
  for (const b of bots || []) {
    if (!b || !b.id || b.role === "lead" || b.system === "dash-team") continue;
    if (
      q &&
      !String(b.name || "")
        .toLowerCase()
        .includes(q)
    )
      continue;
    const ws = norm(b.workspaceId);
    if (ws !== null && names.has(ws)) {
      if (!groups.has(ws)) groups.set(ws, []);
      groups.get(ws).push(b);
    } else {
      lone.push(b);
    }
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const out = [...groups.entries()]
    .map(([id, list]) => ({
      label: `On ${names.get(id)}`,
      workspaceId: id,
      bots: list.sort(byName),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (lone.length) {
    out.push({
      label: "On no dashboard",
      workspaceId: null,
      bots: lone.sort(byName),
    });
  }
  return out;
}
