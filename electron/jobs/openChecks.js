/**
 * openChecks.js — which of a job's steps still have checks open, so
 * stopping the job closes them (DASH-165 follow-up). A step whose checks
 * are being run ("checking") and one whose checks wait for the user
 * ("needs-you": an approval, or work that came to the user) both have an
 * open check job; left open, a stopped job's approval kept its bot's box
 * saying "1 needs you" with nothing in Needs you.
 *
 *   openCheckGoals(steps)   the goal ids to close, once each
 *   endedJobGoals(job)      every check job of an ended job (all its tries),
 *                           to close any it left open: when it ends, and
 *                           when the app starts (an approval a stop left
 *                           open before this fix)
 */
"use strict";

const OPEN = new Set(["checking", "needs-you"]);

/** @param {object[]} steps  the job's steps @returns {string[]} */
function openCheckGoals(steps) {
  const out = [];
  for (const s of Array.isArray(steps) ? steps : []) {
    if (s && s.goalId && OPEN.has(s.status) && !out.includes(s.goalId)) {
      out.push(s.goalId);
    }
  }
  return out;
}

const FINAL = new Set(["done", "failed", "stopped"]);

/** @param {object} job @returns {string[]} */
function endedJobGoals(job) {
  if (!job || !FINAL.has(job.status)) return [];
  const steps = [
    ...(Array.isArray(job.tries) ? job.tries : []).flatMap((t) =>
      t && Array.isArray(t.steps) ? t.steps : [],
    ),
    ...(Array.isArray(job.steps) ? job.steps : []),
  ];
  const out = [];
  for (const s of steps) {
    if (s && s.goalId && !out.includes(s.goalId)) out.push(s.goalId);
  }
  return out;
}

module.exports = { openCheckGoals, endedJobGoals };
