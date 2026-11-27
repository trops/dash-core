/**
 * teamSetupStatus.js — is a team ready to take work (DASH-119)?
 *
 * One status per team, shown wherever the team appears: a badge on the
 * Bots tree's team row and in the dashboard's Bots view header, a banner at
 * the top of the team page and the Bots view ("This team can't take work
 * yet"), "Needs setup" on those bots in the diagram, and the reason a Run
 * or a task can't start. Each links to the first thing to fix: that bot's
 * Settings tab.
 *
 * It counts bots, not team fields (DASH-136: settings belong to bots):
 *   - bots with a required setting still empty (botSettings.botSetupStatus),
 *   - plus what the last Check setup found that a bot's settings can't say
 *     (a provider that doesn't start, a repo it can't read, an AI login),
 *     when that check is known. Its setting problems are left out: the
 *     bots' settings, as saved now, say those (filling one in clears it
 *     without another check).
 *
 * Pure, no imports beyond botSettings.
 */
import { botSetupStatus } from "./botSettings";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

const READY = Object.freeze({
  ready: true,
  bots: [],
  other: [],
  count: 0,
  first: null,
  badge: null,
  short: null,
});

/**
 * @param {object} p
 * @param {object[]} p.bots   the team's bots, as saved (leads and Dash team
 *   bots are left out)
 * @param {object|null} [p.team]  its team settings ({ declared, values })
 * @param {object|null} [p.check] the last Check setup result
 *   ({ ok, problems: [{ kind, bot?, botId?, message }] }), if known
 * @returns {{ ready: boolean,
 *   bots: { botId, name, missing: object[], problems: string[] }[],
 *   other: string[], count: number, first: { botId, name } | null,
 *   badge: string|null, short: string|null }}
 *   count: how many bots need something; other: problems on no one bot.
 */
export function teamSetupStatus({ bots = [], team = null, check = null } = {}) {
  const list = (Array.isArray(bots) ? bots : []).filter(Boolean);
  const byId = new Map();
  const out = [];
  for (const b of botSetupStatus(list, team)) {
    const row = { ...b, problems: [] };
    byId.set(String(b.botId), row);
    out.push(row);
  }
  const other = [];
  const problems =
    isObj(check) && check.ok === false && Array.isArray(check.problems)
      ? check.problems
      : [];
  const members = list.filter(
    (b) => b.role !== "lead" && b.system !== "dash-team",
  );
  const findBot = (p) =>
    (p.botId != null &&
      members.find((b) => String(b.id) === String(p.botId))) ||
    (p.bot && members.find((b) => b.name === p.bot)) ||
    null;
  for (const p of problems) {
    if (!p || p.kind === "setting") continue;
    const message = String(p.message || "").trim();
    if (!message) continue;
    const bot = findBot(p);
    if (!bot) {
      if (!other.includes(message)) other.push(message);
      continue;
    }
    let row = byId.get(String(bot.id));
    if (!row) {
      row = {
        botId: bot.id,
        name: bot.name || bot.id,
        missing: [],
        problems: [],
      };
      byId.set(String(bot.id), row);
      out.push(row);
    }
    if (!row.problems.includes(message)) row.problems.push(message);
  }
  // In the team's order (the bots as given), so "first" is the first bot.
  const order = new Map(list.map((b, i) => [String(b.id), i]));
  out.sort(
    (a, b) =>
      (order.get(String(a.botId)) ?? 1e9) - (order.get(String(b.botId)) ?? 1e9),
  );
  const count = out.length;
  if (!count && !other.length) return { ...READY };
  const badge = count
    ? `Setup · ${plural(count, "bot needs", "bots need")} you`
    : `Setup · ${plural(other.length, "problem", "problems")} to fix`;
  const short = count
    ? `Setup · ${count}`
    : `Setup · ${plural(other.length, "problem", "problems")}`;
  return {
    ready: false,
    bots: out,
    other,
    count,
    first: count ? { botId: out[0].botId, name: out[0].name } : null,
    badge,
    short,
  };
}

const quoted = (s) => `“${s}”`;

/** "Workspace Bot needs “Work folder”" / "…needs “A” and “B”". */
function botNeeds(row) {
  const labels = (row.missing || []).map((m) => quoted(m.label || m.name));
  if (labels.length) {
    const said =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
    return `${row.name} needs ${said} filled in`;
  }
  const n = (row.problems || []).length;
  return `${row.name} has ${plural(n, "problem", "problems")} from Check setup`;
}

/**
 * What the banner says under "This team can't take work yet": the bots and
 * what each needs, then what to do after.
 *   "Ticket Bot needs “Where tickets come from” filled in, and Workspace
 *    Bot needs “Work folder” filled in. Then run Check setup and a
 *    self-test."
 */
export function setupSentence(status) {
  if (!status || status.ready) return "";
  const parts = (status.bots || []).map(botNeeds);
  const otherCount = (status.other || []).length;
  if (otherCount) {
    parts.push(
      `Check setup found ${plural(otherCount, "problem", "problems")} on no one bot`,
    );
  }
  const joined =
    parts.length <= 1
      ? parts.join("")
      : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `${joined}. Then run Check setup and a self-test.`;
}

/**
 * Why a Run or a task can't start on this team (null when it can):
 * "This team can't take work yet: Workspace Bot needs “Work folder”
 *  filled in."
 */
export function cantStartText(status) {
  if (!status || status.ready) return null;
  const parts = (status.bots || []).map(botNeeds);
  const otherCount = (status.other || []).length;
  if (otherCount) {
    parts.push(
      `Check setup found ${plural(otherCount, "problem", "problems")}`,
    );
  }
  return `This team can't take work yet: ${parts.join("; ")}.`;
}

/** The ids of bots that show "Needs setup" (a Set of strings). */
export function needsSetupIds(status) {
  return new Set(((status && status.bots) || []).map((b) => String(b.botId)));
}

export default teamSetupStatus;
