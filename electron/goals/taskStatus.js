/**
 * taskStatus.js
 *
 * The status a task on the goals ledger can be in, and the moves between
 * them (goals-ledger PRD, GOAL-001). A task goes
 *
 *   new → claimed → built → checked → ready → done
 *
 * one step per done record. A failed record sends it back to `new` for its
 * next round, or — once its rounds are used up — to `needs-you`. Only the
 * user moves a task from `ready` to `done`, gives it one more round, or
 * closes it.
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const STATUSES = [
  "new",
  "claimed",
  "built",
  "checked",
  "ready",
  "done",
  "needs-you",
  "closed",
];

const DEFAULT_MAX_ROUNDS = 3;
const MAX_ROUNDS_CAP = 10;

// A passed done record moves the task one step on.
const NEXT = { claimed: "built", built: "checked", checked: "ready" };

// Where a bot may pick a task up: work not yet started, or a step's output
// waiting for the next step.
const CLAIMABLE = ["new", "built", "checked"];

const FINISHED = ["done", "closed"];

const isStatus = (s) => STATUSES.includes(s);

function clampRounds(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return DEFAULT_MAX_ROUNDS;
  return Math.min(v, MAX_ROUNDS_CAP);
}

/**
 * Where a done record takes the task.
 * @param {{status: string, round: number, maxRounds: number}} task
 * @param {"passed"|"failed"|"needs-you"} outcome
 * @returns {{ status?: string, round?: number, error?: string }}
 */
function afterDone(task, outcome) {
  if (!task || FINISHED.includes(task.status)) {
    return { error: "This task is finished." };
  }
  if (outcome === "needs-you") return { status: "needs-you" };
  if (outcome === "failed") {
    const round = task.round || 1;
    if (round >= (task.maxRounds || DEFAULT_MAX_ROUNDS)) {
      return { status: "needs-you", stopped: true };
    }
    return { status: "new", round: round + 1 };
  }
  if (outcome === "passed") {
    const next = NEXT[task.status];
    if (!next) {
      return {
        error:
          task.status === "ready"
            ? "This task is ready — only the user can mark it done."
            : `A task that is '${task.status}' can't be passed — claim it first.`,
      };
    }
    return { status: next };
  }
  return { error: "status must be passed, failed or needs-you." };
}

/**
 * What the user may do with a task, and where it goes.
 * @param {{status: string, round: number, maxRounds: number}} task
 * @param {"done"|"one-more-round"|"close"} action
 */
function afterUser(task, action) {
  if (!task) return { error: "No such task." };
  if (FINISHED.includes(task.status)) {
    return { error: "This task is finished." };
  }
  if (action === "done") {
    if (task.status !== "ready") {
      return { error: "Only a ready task can be marked done." };
    }
    return { status: "done" };
  }
  if (action === "one-more-round") {
    if (task.status !== "needs-you") {
      return { error: "Only a task waiting for you can get another round." };
    }
    const round = (task.round || 1) + 1;
    return {
      status: "new",
      round,
      maxRounds: Math.max(task.maxRounds || DEFAULT_MAX_ROUNDS, round),
    };
  }
  if (action === "close") return { status: "closed" };
  return { error: "Unknown action." };
}

/** A goal's status, from its tasks. */
function goalStatus(goal, tasks = []) {
  if (goal && goal.closed) return "closed";
  // Held before it starts (a criterion can't be proven yet): the user's move.
  if (goal && goal.waiting) return "needs-you";
  if (!tasks.length) return "open";
  if (tasks.some((t) => t.status === "needs-you")) return "needs-you";
  if (tasks.every((t) => FINISHED.includes(t.status))) {
    return tasks.some((t) => t.status === "done") ? "done" : "closed";
  }
  if (tasks.every((t) => t.status === "ready" || FINISHED.includes(t.status))) {
    return "ready";
  }
  return "working";
}

module.exports = {
  STATUSES,
  CLAIMABLE,
  FINISHED,
  DEFAULT_MAX_ROUNDS,
  isStatus,
  clampRounds,
  afterDone,
  afterUser,
  goalStatus,
};
