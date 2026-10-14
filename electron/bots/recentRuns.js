/**
 * recentRuns.js — the Bot monitor's "Recent" list (bot-teams TEAM-011 AC9):
 * the latest runs across every bot, newest first, each tagged with its bot's
 * name and dashboard. Pure; the controller passes the store's (decrypting)
 * getRuns.
 */
"use strict";

const MAX = 50;

function runTime(run) {
  const iso = run && (run.endedAt || run.at || run.startedAt);
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

/**
 * @param {{ bots: object[], getRuns: (botId: string) => object[], limit?: number }} args
 * @returns {{ botId: string, botName: string, workspaceId: string|null, run: object }[]}
 */
function recentRuns({ bots, getRuns, limit = 10 }) {
  const n = Math.max(1, Math.min(MAX, Number(limit) || 1));
  const all = [];
  for (const bot of bots || []) {
    if (!bot || !bot.id) continue;
    let runs = [];
    try {
      runs = getRuns(bot.id) || [];
    } catch (_e) {
      continue; // one unreadable bot shouldn't hide the rest
    }
    for (const run of runs) {
      if (!run || run.skipped) continue;
      const t = runTime(run);
      if (t === null) continue;
      all.push({
        t,
        botId: bot.id,
        botName: bot.name || bot.id,
        workspaceId:
          bot.workspaceId === null || bot.workspaceId === undefined
            ? null
            : String(bot.workspaceId),
        run,
      });
    }
  }
  all.sort((a, b) => b.t - a.t);
  return all.slice(0, n).map(({ t: _t, ...rest }) => rest);
}

const LINE_MAX = 160;

/** The first non-empty line of a run's answer or error, clipped. */
function firstLine(text) {
  const line =
    String(text || "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) || "";
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line;
}

/**
 * Each bot's latest run, for the Bots dock's contacts list (bot-teams
 * TEAM-015): when it last did something and what — every bot, however quiet
 * (listRecentRuns only covers the newest runs across all bots).
 * @param {{ bots: object[], getRuns: (botId: string) => object[] }} args
 * @returns {{ [botId: string]: { at: string, trigger: string|null,
 *   status: string|null, text: string, error: string } }}
 */
function lastRuns({ bots, getRuns }) {
  const out = {};
  for (const bot of bots || []) {
    if (!bot || !bot.id) continue;
    let runs = [];
    try {
      runs = getRuns(bot.id) || [];
    } catch (_e) {
      continue;
    }
    let best = null;
    let bestT = null;
    for (const run of runs) {
      if (!run || run.skipped) continue;
      const t = runTime(run);
      if (t === null) continue;
      if (bestT === null || t >= bestT) {
        best = run;
        bestT = t;
      }
    }
    if (!best) continue;
    out[bot.id] = {
      at: new Date(bestT).toISOString(),
      trigger: best.trigger || null,
      status: best.status || null,
      text: firstLine(best.output),
      error: firstLine(best.error),
    };
  }
  return out;
}

module.exports = { recentRuns, lastRuns };
