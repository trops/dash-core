/**
 * activityLog.js — what the bots did, for the notifications panel's
 * Activity (lead-workspace release 4, frames 22 and 29): a line per run,
 * newest first, from this dashboard's bots or from every dashboard (each
 * tagged). A lead's run opens its conversation. Pure.
 */
import { errorLine, whenText } from "./needsYou";

const ms = (t) => (typeof t === "number" ? t : Date.parse(t) || 0);
const firstLine = (t, max = 110) => {
  const line =
    String(t || "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) || "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** What a run did, in a line: its answer's first line, or why it stopped. */
function runLine(run) {
  const r = run || {};
  if (r.status === "failed")
    return `failed — ${errorLine(r.error, 80) || "no details"}`;
  if (r.status === "stopped") return "was stopped";
  if (r.status === "interrupted") return "was interrupted when Dash closed";
  const said = firstLine(r.output);
  return said || "ran";
}

/**
 * @param {object} p
 * @param {object[]} p.runs    listRecentRuns(): [{ botId, botName,
 *   workspaceId, run }] newest first
 * @param {object[]} p.bots    for roles (a lead's run opens its conversation)
 * @param {object} p.dashboards  { [id]: name }
 * @param {string|null} p.current  the dashboard shown
 * @param {"here"|"all"} p.scope
 * @param {number} p.now
 * @returns {{ id, at, time, who, text, tone, where, open }[]}
 *   tone: "ok" | "bad" | "idle"
 */
export function activityLog({
  runs = [],
  bots = [],
  dashboards = {},
  current = null,
  scope = "here",
  now = Date.now(),
} = {}) {
  const byId = new Map((bots || []).map((b) => [String(b.id), b]));
  const here = current == null ? null : String(current);
  return (runs || [])
    .filter((e) => e && e.run)
    .filter(
      (e) =>
        scope === "all" ||
        (here != null &&
          e.workspaceId != null &&
          String(e.workspaceId) === here),
    )
    .map((e, i) => {
      const run = e.run;
      const at = ms(run.endedAt || run.startedAt);
      const bot = byId.get(String(e.botId)) || null;
      const isLead = !!bot && bot.role === "lead";
      const ws = e.workspaceId == null ? null : String(e.workspaceId);
      return {
        id: `${e.botId}:${at}:${i}`,
        at,
        time: whenText(at, now),
        who: e.botName || (bot && bot.name) || "A bot",
        text: runLine(run),
        tone:
          run.status === "failed"
            ? "bad"
            : run.status === "completed"
              ? "ok"
              : "idle",
        // Under All, which other dashboard it's on (frame 29).
        where: scope === "all" && ws && ws !== here ? dashboards[ws] || "" : "",
        open: isLead ? { key: `lead:${e.botId}` } : null,
      };
    })
    .sort((a, b) => b.at - a.at);
}

export default activityLog;
