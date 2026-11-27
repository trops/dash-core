/**
 * botsBadge — the count on a dashboard's "Bots" switch, and what it says.
 *
 * It counts two things on this dashboard's team, the same ones the Bot
 * notifications panel lists under "Needs you":
 *  - asks waiting for an OK (approvals). They can't be dismissed: they wait
 *    for Allow or Deny, so the label says so.
 *  - bots whose last run failed. Dismissing that card in the panel (×) takes
 *    it off the badge too, until the bot fails again; a bot that runs again
 *    and passes, or is running now, isn't counted either.
 *
 * `target` is what clicking the badge opens: the first bot that waits for an
 * OK, else the first failed one, on its Activity tab. Pure.
 */
import { isDismissed } from "./BotNotifications/dismissedNeeds";

const DAY = 24 * 60 * 60 * 1000;
// Same window as the panel's failure cards: older isn't news any more.
const FAILURE_DAYS = 7;

function runTime(run) {
  const iso = run && (run.endedAt || run.at || run.startedAt);
  const t = typeof iso === "number" ? iso : iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function names(list) {
  return list.map((b) => b.name).join(", ");
}

/**
 * @param {object} p
 * @param {object[]} p.bots           the team (lead and members)
 * @param {object[]} p.approvals      pending approvals ({ request: { botId } })
 * @param {object} p.lastRunByBot     { [botId]: run }
 * @param {string[]} p.running        ids of bots running now
 * @param {object} p.dismissed        the panel's dismissed cards
 * @param {number} p.now
 * @returns {{ count: number, approvals: {botId, name}[],
 *   failed: {botId, name}[], label: string,
 *   target: { botId, tab } | null }}
 */
export function botsBadge({
  bots = [],
  approvals = [],
  lastRunByBot = {},
  running = [],
  dismissed = {},
  now = Date.now(),
} = {}) {
  const team = (bots || []).filter((b) => b && b.id != null);
  const byId = new Map(team.map((b) => [String(b.id), b]));
  const nameOf = (id) => {
    const b = byId.get(String(id));
    return (b && b.name) || "A bot";
  };

  const waiting = [];
  for (const a of approvals || []) {
    const id = a && a.request ? a.request.botId : null;
    if (id == null || !byId.has(String(id))) continue;
    waiting.push({ botId: id, name: nameOf(id) });
  }

  const busy = new Set(
    (running || []).map((r) => String(r && typeof r === "object" ? r.id : r)),
  );
  const failed = [];
  for (const bot of team) {
    const run = lastRunByBot ? lastRunByBot[bot.id] : null;
    if (!run || run.status !== "failed") continue;
    if (busy.has(String(bot.id))) continue;
    const at = runTime(run);
    if (at && now - at > FAILURE_DAYS * DAY) continue;
    if (isDismissed({ kind: "failed", botId: bot.id, at }, dismissed)) {
      continue;
    }
    failed.push({ botId: bot.id, name: nameOf(bot.id) });
  }

  const parts = [];
  if (waiting.length) {
    const n = waiting.length;
    parts.push(
      `${n} ${n === 1 ? "ask waits" : "asks wait"} for your OK: ${names(waiting)} (answer Allow or Deny)`,
    );
  }
  if (failed.length) {
    const n = failed.length;
    parts.push(
      `${n} ${n === 1 ? "bot's" : "bots'"} last run failed: ${names(failed)}`,
    );
  }
  const first = waiting[0] || failed[0] || null;
  return {
    count: waiting.length + failed.length,
    approvals: waiting,
    failed,
    label: parts.join(" · "),
    target: first ? { botId: first.botId, tab: "activity" } : null,
  };
}
