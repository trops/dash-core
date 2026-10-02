/**
 * teamUtils.js
 *
 * Renderer helpers for bot teams (bot-teams PRD TEAM-001): a dashboard's team
 * is the bots whose `workspaceId` is that dashboard; bots without one are
 * Unassigned. Mirrors electron/bots/teams.js (ids compared as strings).
 *
 * Pure: no React, no IPC.
 */

const norm = (id) =>
  id === undefined || id === null || id === "" ? null : String(id);

export function sameWorkspace(a, b) {
  return norm(a) === norm(b);
}

/** Dashboard choices; same-named dashboards are numbered so they're distinct. */
export function dashboardOptions(workspaces) {
  if (!Array.isArray(workspaces)) return [];
  const list = workspaces.filter((w) => w && norm(w.id) !== null);
  const totals = {};
  for (const w of list) {
    const n = w.name || `Dashboard ${w.id}`;
    totals[n] = (totals[n] || 0) + 1;
  }
  const seen = {};
  return list.map((w) => {
    const n = w.name || `Dashboard ${w.id}`;
    let label = n;
    if (totals[n] > 1) {
      seen[n] = (seen[n] || 0) + 1;
      label = `${n} (${seen[n]})`;
    }
    return { value: norm(w.id), label };
  });
}

/**
 * Bots grouped by team, in dashboard order, with Unassigned last. Bots whose
 * dashboard no longer exists are shown as Unassigned. Empty teams are omitted.
 * @returns {Array<{ workspaceId: string|null, label: string, bots: object[] }>}
 */
export function groupBotsByTeam(bots, workspaces) {
  const list = Array.isArray(bots) ? bots : [];
  const groups = dashboardOptions(workspaces).map((o) => ({
    workspaceId: o.value,
    label: o.label,
    bots: [],
  }));
  const unassigned = { workspaceId: null, label: "Unassigned", bots: [] };
  for (const bot of list) {
    const g = groups.find(
      (x) => x.workspaceId === norm(bot && bot.workspaceId),
    );
    (g || unassigned).bots.push(bot);
  }
  return [...groups, unassigned].filter((g) => g.bots.length);
}

/** "On a schedule · on 2 events" — how a bot gets started, in plain words. */
export function triggerSummary(bot) {
  const scheduled = ((bot && bot.schedules) || []).some((s) => s && s.cron);
  const events = ((bot && bot.subscriptions) || []).length;
  const parts = [];
  if (scheduled) parts.push("On a schedule");
  if (events) parts.push(`on ${events} event${events === 1 ? "" : "s"}`);
  if (!parts.length) return "Runs manually";
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Widget-event subscriptions from a dashboard other than the bot's team.
 * A bot on a team only hears its own dashboard's events (eventMatcher), so
 * these won't fire. Unassigned bots hear every dashboard.
 */
export function offTeamSubscriptions(subscriptions, teamWorkspaceId) {
  if (norm(teamWorkspaceId) === null) return [];
  return (subscriptions || []).filter(
    (s) =>
      s &&
      s.source &&
      s.source.kind === "widget" &&
      norm(s.source.workspaceId) !== null &&
      !sameWorkspace(s.source.workspaceId, teamWorkspaceId),
  );
}
