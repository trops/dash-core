/**
 * flowMoves.js
 *
 * Where a goal's task goes as it travels its flow (flows PRD). The task
 * keeps the ledger's statuses (taskStatus.js) and the step it's at:
 *
 *   entering a bot step     new (or "checked", right after a check passed)
 *   entering a check step   built   (Dash runs the check)
 *   entering a you step     ready   (waits for the user)
 *   past the last step      done
 *
 * A failed step sends the work back along its fail edge for the next round,
 * or — once the rounds are used up, or with nowhere to send it — to
 * needs-you. Rounds are driven by the ledger, never by bots asking each
 * other again, so the event chain's limits stay as they are (G4).
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const {
  stepById,
  nextStep,
  prevStep,
  failTarget,
  sendBackTarget,
  youModeOf,
  firstWorkStep,
  inputStep,
} = require("./flowModel");

/** The status a task has as it reaches `step`. */
function statusEntering(flow, step) {
  if (!step) return "done";
  if (step.kind === "check") return "built";
  if (step.kind === "you") return "ready";
  const before = prevStep(flow, step.id);
  return before && before.kind === "check" ? "checked" : "new";
}

/** Where a new goal's work starts. */
function startOf(flow) {
  const step = firstWorkStep(flow);
  if (!step) return { error: "This flow has no steps to work through." };
  return { stepId: step.id, status: statusEntering(flow, step) };
}

/**
 * Where a step's outcome takes the task.
 * @param {object} flow   the flow the goal follows (its own copy)
 * @param {{ stepId, round, maxRounds }} task
 * @param {"passed"|"failed"|"needs-you"} outcome
 * @returns {{ stepId, status, round?, stopped?, retryStepId?, error? }}
 */
function afterStep(flow, task, outcome) {
  const step = stepById(flow, task && task.stepId);
  if (!step) return { error: "This task isn't at a step of its flow." };
  if (outcome === "passed") {
    const next = nextStep(flow, step.id);
    if (!next) return { stepId: null, status: "done" };
    return { stepId: next.id, status: statusEntering(flow, next) };
  }
  if (outcome === "needs-you") {
    return { stepId: step.id, status: "needs-you", retryStepId: step.id };
  }
  if (outcome === "failed") {
    const back = failTarget(flow, step.id);
    // Nowhere to send it back: the user decides. Another round retries
    // the step that made the work.
    const retry = back || inputStep(flow, step.id) || step;
    const round = (task && task.round) || 1;
    const max = (task && task.maxRounds) || (flow && flow.maxRounds) || 3;
    if (!back || round >= max) {
      return {
        stepId: step.id,
        status: "needs-you",
        stopped: !!back,
        retryStepId: retry.id,
      };
    }
    return {
      stepId: back.id,
      status: back.kind === "bot" ? "new" : statusEntering(flow, back),
      round: round + 1,
    };
  }
  return { error: "status must be passed, failed or needs-you." };
}

/**
 * The user's own moves on a flow task: done (at a you step), send back
 * (at a you step, with a reason: the step before runs again with it), one
 * more round, close.
 */
function afterUserInFlow(flow, task, action) {
  if (!task) return { error: "No such task." };
  if (action === "send-back") {
    const step = stepById(flow, task.stepId);
    if (task.status !== "ready" || !step || step.kind !== "you") {
      return { error: "Only work waiting for you can be sent back." };
    }
    if (youModeOf(step) !== "approve") {
      return { error: "This step is marked done, not approved or sent back." };
    }
    const target = sendBackTarget(flow, step.id);
    if (!target)
      return {
        error: "There's no bot step before this one to send it back to.",
      };
    const round = (task.round || 1) + 1;
    return {
      stepId: target.id,
      status: statusEntering(flow, target),
      round,
      maxRounds: Math.max(task.maxRounds || 3, round),
    };
  }
  if (task.status === "done" || task.status === "closed") {
    return { error: "This task is finished." };
  }
  if (action === "done") {
    const step = stepById(flow, task.stepId);
    if (task.status !== "ready" || !step || step.kind !== "you") {
      return { error: "Only a task waiting for you can be marked done." };
    }
    return afterStep(flow, task, "passed");
  }
  if (action === "one-more-round") {
    if (task.status !== "needs-you") {
      return { error: "Only a task waiting for you can get another round." };
    }
    const target =
      stepById(flow, task.retryStepId) || stepById(flow, task.stepId);
    if (!target) return { error: "This task isn't at a step of its flow." };
    const round = (task.round || 1) + 1;
    return {
      stepId: target.id,
      status: target.kind === "you" ? "ready" : statusEntering(flow, target),
      round,
      maxRounds: Math.max(task.maxRounds || 3, round),
    };
  }
  if (action === "close") return { stepId: task.stepId, status: "closed" };
  return { error: "Unknown action." };
}

module.exports = { statusEntering, startOf, afterStep, afterUserInFlow };
