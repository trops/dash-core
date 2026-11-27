/**
 * checkCost.js — a check's rough cost and time (DASH-127), so cheap checks
 * can go first: the checks window's list and the team diagram's panel use
 * the same words.
 *
 *   a rule or built-in check   "Free · instant rule"
 *   a command (or repo) check  "No AI cost · ~2 min"   (its last run's time)
 *   a bot-review check         "AI · ~$0.05 a run"     (its recent average)
 *   you approve                "Free · waits for you"
 *
 * Stats come from the bot's jobs (`checkStats`): how long each step took
 * the last time it ran, and what the reviewer's runs for this bot's jobs
 * cost. Without them, the line says the time or cost isn't known yet.
 *
 * Pure: no React, no IPC.
 */

import { stepTone } from "./checksView";

// A reviewer's average is over its last few runs for this bot's jobs.
export const RECENT_RUNS = 10;

const msOf = (v) =>
  typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;

/** "~2 min", "~40 s", "~1 h 5 min". */
export function roughTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `~${Math.max(1, s)} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `~${h} h ${rest} min` : `~${h} h`;
}

/** "~$0.05", "~$1.20", "<$0.01". */
export function roughUsd(usd) {
  if (!Number.isFinite(usd) || usd < 0) return null;
  if (usd < 0.01) return "<$0.01";
  return `~$${usd.toFixed(2)}`;
}

/** A run's cost in dollars (an API key's, else a subscription's equivalent). */
function runUsd(run) {
  const c = run && run.cost;
  if (!c || typeof c !== "object") return null;
  if (Number.isFinite(c.usd) && c.usd > 0) return c.usd;
  if (Number.isFinite(c.equivalentUsd) && c.equivalentUsd > 0) {
    return c.equivalentUsd;
  }
  return Number.isFinite(c.usd) ? c.usd : null;
}

/**
 * What each of a bot's checks took, from its jobs.
 *
 * @param {object[]} goals  the team's goals (useGoals / goals.list): its
 *   jobs carry `flow.botId` and `tasks[0].history` (one record per step,
 *   with `stepId` and `at`).
 * @param {string} botId
 * @param {Object<string, object[]>} [runsByBot]  a reviewer's runs
 *   (bots.getRuns) by its id: those marked `checks.state: "review"` for
 *   one of this bot's jobs count toward its cost.
 * @returns {Object<string, { ms?: number, usd?: number }>} by step id
 */
export function checkStats(goals, botId, runsByBot = {}) {
  const jobs = (goals || [])
    .filter(
      (g) =>
        g &&
        g.flow &&
        String(g.flow.botId) === String(botId) &&
        Array.isArray(g.tasks),
    )
    .sort((a, b) => (msOf(a.createdAt) || 0) - (msOf(b.createdAt) || 0));
  const out = {};
  const reviewerOf = {};
  for (const g of jobs) {
    for (const s of (g.flow && g.flow.steps) || []) {
      if (s && s.kind === "bot" && s.judgment && s.botId) {
        reviewerOf[s.id] = String(s.botId);
      }
    }
    const history = ((g.tasks || [])[0] || {}).history || [];
    history.forEach((r, i) => {
      if (!r || !r.stepId || r.by === "you" || i === 0) return;
      if (r.status !== "passed" && r.status !== "failed") return;
      const ms = msOf(r.at) - msOf(history[i - 1] && history[i - 1].at);
      if (!Number.isFinite(ms) || ms < 0) return;
      // Later jobs come later: the last run's time wins.
      out[r.stepId] = { ...(out[r.stepId] || {}), ms };
    });
  }
  const jobIds = new Set(jobs.map((g) => String(g.id)));
  for (const [stepId, reviewerId] of Object.entries(reviewerOf)) {
    const runs = ((runsByBot && runsByBot[reviewerId]) || []).filter(
      (r) =>
        r &&
        r.checks &&
        r.checks.state === "review" &&
        jobIds.has(String(r.checks.goalId)),
    );
    const costs = runs
      .map(runUsd)
      .filter((u) => u !== null)
      .slice(-RECENT_RUNS);
    if (costs.length) {
      const usd = costs.reduce((a, b) => a + b, 0) / costs.length;
      out[stepId] = { ...(out[stepId] || {}), usd };
    }
  }
  return out;
}

/** The reviewer bots a bot's checks name (whose runs give their cost). */
export function reviewerIds(checks) {
  return [
    ...new Set(
      ((checks && checks.steps) || [])
        .filter((s) => s && s.kind === "reviewer" && s.botId)
        .map((s) => String(s.botId)),
    ),
  ];
}

/**
 * A check's rough cost and time, in a line.
 * @param {object} step  a step of bot.checks
 * @param {{ ms?: number, usd?: number }} [stat]  checkStats()[step.id]
 */
export function checkCost(step, stat = null) {
  const tone = stepTone(step);
  const time = stat && Number.isFinite(stat.ms) ? roughTime(stat.ms) : null;
  if (tone === "you") return "Free · waits for you";
  if (tone === "reviewer") {
    const usd = stat && Number.isFinite(stat.usd) ? roughUsd(stat.usd) : null;
    if (!usd) return "AI · cost not known yet";
    return `AI · ${usd} a run${time ? `, ${time}` : ""}`;
  }
  if (tone === "command") {
    return `No AI cost · ${time || "time not known yet"}`;
  }
  // The PR's CI: free, but it waits for CI to finish.
  if (step && step.check && step.check.kind === "pr-ci") {
    return `Free · waits for CI${time ? `, ${time}` : ""}`;
  }
  return "Free · instant rule";
}
