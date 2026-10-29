/**
 * botsTree.js — the Bots page, teams first (lead-workspace release 5,
 * frames 23–26): the Dash team, then each dashboard's team (its lead, then
 * its bots), "Dashboards with no bots" as one group, and "On no dashboard".
 * Teams start closed; the picked team, and any that needs the user, start
 * open. A search or a status filter opens only the teams that match. Pure.
 */
import { approvalText } from "../Bots/DashTeamApprovals";

export const DASH_KEY = "team:dash";
export const EMPTY_KEY = "team:empty";
export const LONE_KEY = "team:lone";
export const teamKeyOf = (workspaceId) => `team:${workspaceId}`;

// The status filter's values → botStatus()'s words.
const FILTER_STATUS = {
  needs: "Needs approval",
  running: "Running",
  paused: "Paused",
};

const idOf = (v) =>
  v === undefined || v === null || v === "" ? null : String(v);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const wsName = (w) => (w && (w.name || w.label)) || `Dashboard ${w && w.id}`;

/**
 * @param {object} p
 * @param {object[]} p.bots        the user's bots (leads included)
 * @param {object[]} p.dashTeam    the Dash team's role bots
 * @param {object[]} p.workspaces  dashboards
 * @param {(id) => string} p.statusOf
 * @param {string} [p.query]
 * @param {"all"|"needs"|"running"|"paused"} [p.filter]
 * @param {object} [p.open]        { [teamKey]: boolean } — the user's toggles
 * @param {string|null} [p.selected]  "team:<key>" | "bot:<id>"
 * @returns {object[]} teams: { key, kind: "dash"|"team"|"empty"|"lone",
 *   name, sub, open, lead, members, allMembers, needs, running,
 *   workspace?, dashboards? }
 */
export function botsTree({
  bots = [],
  dashTeam = [],
  workspaces = [],
  statusOf = () => "Idle",
  query = "",
  filter = "all",
  open = {},
  selected = null,
} = {}) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const hit = (s) =>
    !!q &&
    String(s || "")
      .toLowerCase()
      .includes(q);
  const want = FILTER_STATUS[filter] || null;
  const fits = (b) => !want || statusOf(b.id) === want;
  const narrowed = !!q || !!want;
  const selBot =
    selected && selected.startsWith("bot:") ? selected.slice(4) : null;
  const count = (list, status) =>
    list.filter((b) => b && statusOf(b.id) === status).length;

  const teams = [];
  const push = (t) => {
    const everyone = [t.lead, ...t.allMembers].filter(Boolean);
    const needs = count(everyone, "Needs approval");
    const running = count(everyone, "Running");
    // Searching: a team whose name (or lead) matches keeps every bot;
    // otherwise only the bots that match.
    const teamHit = hit(t.name) || (t.lead && hit(t.lead.name));
    let members = t.allMembers;
    if (q && !teamHit) members = members.filter((b) => hit(b.name));
    members = members.filter(fits);
    const leadShown = !!t.lead && (!want || fits(t.lead));
    if (narrowed && !members.length && !(leadShown && (teamHit || want)))
      return;
    const picked =
      selected === t.key ||
      (!!selBot && everyone.some((b) => String(b.id) === selBot));
    teams.push({
      ...t,
      members,
      // Under a status filter, the lead shows only if it fits too.
      lead: leadShown ? t.lead : null,
      needs,
      running,
      // "On no dashboard" starts open (frame 23): its bots are talked to
      // directly.
      open: narrowed
        ? true
        : open[t.key] !== undefined
          ? !!open[t.key]
          : needs > 0 || picked || t.kind === "lone",
    });
  };

  // The Dash team: the Dash Lead, then its roles.
  const team = (dashTeam || []).filter(Boolean);
  if (team.length) {
    const lead = team.find((b) => b.role === "dashlead") || null;
    const members = team.filter((b) => b !== lead);
    push({
      key: DASH_KEY,
      kind: "dash",
      name: "Dash team",
      sub: `${plural(members.length, "bot", "bots")}${lead ? ` · ${lead.name || "Dash Lead"}` : ""}`,
      lead,
      allMembers: members,
    });
  }

  const own = (bots || []).filter(Boolean);
  const known = new Set((workspaces || []).map((w) => idOf(w && w.id)));
  const empty = [];
  for (const w of workspaces || []) {
    const id = idOf(w && w.id);
    if (!id) continue;
    const here = own.filter((b) => idOf(b.workspaceId) === id);
    const lead = here.find((b) => b.role === "lead") || null;
    const members = here.filter((b) => b.role !== "lead");
    if (!members.length) {
      empty.push({ id, name: wsName(w), lead, workspace: w });
      continue;
    }
    push({
      key: teamKeyOf(id),
      kind: "team",
      name: wsName(w),
      sub: `${plural(members.length, "bot", "bots")}${lead ? ` · ${lead.name}` : ""}`,
      lead,
      allMembers: members,
      workspace: w,
    });
  }

  // Dashboards with no bots — one folded group. Its leads can still need
  // the user (or be running): counted, and kept under a filter they fit.
  if (empty.length) {
    const leads = empty.map((d) => d.lead).filter(Boolean);
    const shown = empty.filter(
      (d) =>
        (!q || hit(d.name) || (d.lead && hit(d.lead.name))) &&
        (!want || (d.lead && fits(d.lead))),
    );
    if (shown.length) {
      const needs = count(leads, "Needs approval");
      teams.push({
        key: EMPTY_KEY,
        kind: "empty",
        name: "Dashboards with no bots",
        sub: `${plural(shown.length, "dashboard", "dashboards")} · their leads are ready when you add bots`,
        lead: null,
        members: [],
        allMembers: [],
        dashboards: shown,
        needs,
        running: count(leads, "Running"),
        open: narrowed
          ? true
          : open[EMPTY_KEY] !== undefined
            ? !!open[EMPTY_KEY]
            : needs > 0 || selected === EMPTY_KEY,
      });
    }
  }

  // On no dashboard: talked to directly. A lead whose dashboard is gone
  // shows here too, so it can be removed.
  const lone = own.filter((b) => !known.has(idOf(b.workspaceId)));
  if (lone.length) {
    push({
      key: LONE_KEY,
      kind: "lone",
      name: "On no dashboard",
      sub: `${plural(lone.length, "bot", "bots")} · you talk to ${lone.length === 1 ? "it" : "them"} directly`,
      lead: null,
      allMembers: lone,
    });
  }
  return teams;
}

/**
 * Waiting approvals for the tree's Needs you box (frame 23): what each bot
 * wants, and which team it's on.
 * @returns {{ id, botId, text, where, teamKey }[]}
 */
export function treeNeeds({
  approvals = [],
  bots = [],
  dashTeam = [],
  workspaces = [],
} = {}) {
  const all = [...(bots || []), ...(dashTeam || [])].filter(Boolean);
  const names = new Map(
    (workspaces || []).map((w) => [idOf(w && w.id), wsName(w)]),
  );
  return (approvals || [])
    .filter((a) => a && a.request)
    .map((a) => {
      const bot = all.find((b) => String(b.id) === String(a.request.botId));
      const name = (bot && bot.name) || "A bot";
      const isDash = !!bot && (dashTeam || []).includes(bot);
      const ws = bot ? idOf(bot.workspaceId) : null;
      const hasTeam =
        !!ws &&
        (bots || []).some(
          (b) => b && b.role !== "lead" && idOf(b.workspaceId) === ws,
        );
      return {
        id: a.id,
        botId: a.request.botId,
        text: approvalText(a.request, name).replace(/\.$/, ""),
        where: isDash ? "Dash team" : (ws && names.get(ws)) || "",
        teamKey: isDash
          ? DASH_KEY
          : ws && names.has(ws)
            ? hasTeam
              ? teamKeyOf(ws)
              : EMPTY_KEY
            : LONE_KEY,
      };
    });
}

export default botsTree;
