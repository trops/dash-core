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

module.exports = { recentRuns };
