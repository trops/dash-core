/**
 * checkJobs.js
 *
 * A bot's work held for its checks (bot-checks PRD, DASH-9). When a bot
 * with checks finishes a run, nothing goes out: its answer becomes a job on
 * the dashboard's ledger, following the small flow its checks make
 * (botChecks.checksFlow), and the flow runner takes it from there — checks,
 * tries again with what failed, waits for you. Once the job is done the
 * held work goes on, under the cause of the run that made it: its results,
 * then its `completed` event (its next bots run, its widgets show it).
 *
 *   afterRun   a run ended: hold it as a new job, record an answer given
 *              again, or say it isn't held (it goes on as before)
 *   onChange   the ledger changed: release a passed job; fail one that
 *              ran out of tries (or "It fails"), or that you closed —
 *              its `failed` event goes out with why (DASH-12)
 *   waitFor    how a job ends, or where it is after a wait (the lead's ask)
 *
 * Held work lives in memory: after a restart, a job that passes goes on
 * without the results its first run sent.
 *
 * Injected, no Electron.
 */
"use strict";

const { rootCause } = require("./botEvents");
const { refusalsOf } = require("./refusals");
const {
  checksFlow,
  isChecksFlow,
  jobTitle,
  jobSource,
  workOutput,
  passedWork,
  handedOn,
  WORK_STEP,
} = require("./botChecks");

const MAX_BODY = 4000;
const NOT_DONE = ["failed", "stopped", "interrupted"];

/**
 * @param {{ goals: () => object|null,
 *           getBot: (botId) => object|null,
 *           publisher: { holdRun: Function, release: Function,
 *                        fail: Function, holding: Function },
 *           patchRun: (botId, startedAt, patch) => void,
 *           getRuns: (botId) => object[],
 *           notify?: (botId, info) => void,
 *           setTimer?: Function, clearTimer?: Function }} deps
 */
function createCheckJobs(deps) {
  const {
    goals,
    getBot,
    publisher,
    patchRun,
    getRuns,
    notify = () => {},
    // A bot's team uses handoffs (DASH-101): { handoff: true, tables }, or
    // null. Its checks flow starts with the built-in Handoff check.
    handoffFor = () => null,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = deps;
  const flowFor = (bot) => {
    let opts = null;
    try {
      opts = bot ? handoffFor(bot) : null;
    } catch (_e) {
      opts = null;
    }
    return checksFlow(bot, opts || {});
  };
  // goalId → what goes out when the job passes.
  const held = new Map();
  // goalIds already let go (released or stopped), so a change twice is once.
  const settled = new Set();
  // goalId → [resolve] for waitFor.
  const waiters = new Map();

  const store = () => {
    try {
      return goals();
    } catch (_e) {
      return null;
    }
  };

  /** The job a goal id names, with its task, or null. */
  function jobOf(goalId) {
    const s = store();
    if (!s || !goalId) return null;
    const goal = s.getGoal ? s.getGoal(goalId) : null;
    if (!goal || !isChecksFlow(goal.flow)) return null;
    const task = (goal.tasks || [])[0] || null;
    return { goal, task };
  }

  /** Where a job is, in a word, with what the lead or a widget needs. */
  function stateOf(goalId) {
    const job = jobOf(goalId);
    if (!job) return { state: "gone" };
    const { goal, task } = job;
    const base = { goalId, title: goal.title, round: task ? task.round : 1 };
    if (!task) return { ...base, state: "checking" };
    const lastFail = [...(task.history || [])]
      .reverse()
      .find((r) => r && r.status === "failed");
    const reason = lastFail ? lastFail.summary || "" : "";
    if (task.status === "done") {
      // A check passed it with nothing to hand on (DASH-65): done, and
      // nothing goes out.
      const last = (task.history || [])[(task.history || []).length - 1];
      if (last && last.handOn === false) {
        return {
          ...base,
          state: "passed",
          handOn: false,
          reason: last.summary || "",
          // A handoff's "none" or "split" (DASH-101).
          ...(last.ended ? { ended: last.ended } : {}),
        };
      }
      return {
        ...base,
        state: "passed",
        output: handedOn(goal.flow, passedWork(task)),
      };
    }
    if (goal.closed || task.status === "closed") {
      return { ...base, state: "stopped", reason };
    }
    if (task.status === "ready") return { ...base, state: "waiting" };
    if (task.status === "needs-you") {
      const last = (task.history || [])[task.history.length - 1];
      // Its handoff asked a person (DASH-101): their answer is what's
      // needed, not a judgment on the work.
      if (last && last.ask) {
        return {
          ...base,
          state: "needs-you",
          ask: last.ask,
          reason: `It asks: ${last.ask}`,
        };
      }
      return {
        ...base,
        state: "needs-you",
        reason: reason || (last && last.summary) || "",
      };
    }
    return { ...base, state: "checking" };
  }

  /**
   * Whether a bot's checks are still trying one of its runs (DASH-73): a
   * new run of it would mix with that work, so a hand-on waits for it.
   * Waiting on the user doesn't count: that can take any time.
   */
  function checkingFor(botId) {
    for (const [goalId, entry] of held) {
      if (!entry || entry.botId !== botId || settled.has(goalId)) continue;
      if (stateOf(goalId).state === "checking") return true;
    }
    return false;
  }

  /** Whether a run of this bot should hold the results it sends. */
  function holdsRun(bot, opts = {}) {
    if (!bot) return false;
    // A run for a flow: held only when the flow is a job's (a bot used as a
    // step in another flow publishes as it always did).
    if (opts.trigger === "flow") {
      return !!jobOf(opts.goal && opts.goal.goalId);
    }
    return !!flowFor(bot) && bot.workspaceId != null;
  }

  function mark(botId, record, goalId, state) {
    if (!record || !record.startedAt) return;
    try {
      patchRun(botId, record.startedAt, { checks: { goalId, state } });
    } catch (_e) {
      // The run's mark is for the views; the job goes on without it.
    }
  }

  /**
   * A run ended (after BotRunner wrote its record). Returns true when its
   * work is held — the caller then publishes nothing.
   * @param {{ botId: string, opts: object, record: object }} p
   */
  function afterRun({ botId, opts = {}, record, jobId = null }) {
    // Its checks filled in with the rows of its team's tables this answer
    // (or its input, or its job) picked (DASH-84).
    const bot = getBot(botId, {
      jobId,
      prompt: opts.prompt,
      output: record && record.output,
    });
    if (!bot || !record || record.skipped) return false;
    const s = store();
    if (!s) return false;
    // A run for a job (an answer given again, or a reviewer's verdict):
    // the job decides what goes out, so nothing does now.
    if (opts.trigger === "flow") {
      // Started held for a job: whatever happened since (the job deleted
      // meanwhile), nothing of this run goes out on its own.
      const startedHeld = publisher.holding(botId);
      const job = jobOf(record.goalId || (opts.goal && opts.goal.goalId));
      if (!job) {
        if (!startedHeld) return false;
        publisher.holdRun(botId);
        return true;
      }
      const kept = publisher.holdRun(botId);
      const own = job.goal.flow.botId === botId;
      const done = !NOT_DONE.includes(record.status);
      mark(botId, record, job.goal.id, own ? "checking" : "review");
      const { task } = job;
      if (own && done && task && task.stepId === WORK_STEP) {
        // This try's answer replaces the last one, and so do its results.
        const entry = held.get(job.goal.id);
        if (entry) entry.results = (kept && kept.results) || [];
        try {
          s.writeStepRecord(task.id, {
            stepId: WORK_STEP,
            status: "passed",
            summary: `Answered again (try ${task.round || 1})`,
            output: workOutput(record.output, refusalsOf(record)),
            bot: { botId, botName: bot.name },
          });
        } catch (_e) {
          // Not recorded: the runner starts it once more, then asks you.
        }
      }
      return true;
    }
    const flow = flowFor(bot);
    if (!flow || bot.workspaceId == null) return false;
    // Failed or stopped: nothing to check, it goes on as before.
    if (NOT_DONE.includes(record.status)) return false;
    const kept = publisher.holdRun(botId) || {
      cause: rootCause(),
      results: [],
    };
    const prompt = String(opts.prompt || "");
    let r = null;
    try {
      r = s.createGoal({
        workspaceId: bot.workspaceId,
        title: jobTitle(bot, { prompt, trigger: opts.trigger }),
        body: prompt.slice(0, MAX_BODY),
        source: jobSource({ trigger: opts.trigger, via: opts.via }),
        ...(opts.conversationId
          ? { conversationId: String(opts.conversationId) }
          : {}),
        createdBy: { botId, botName: bot.name },
        flow,
        startAfter: {
          stepId: WORK_STEP,
          botId,
          botName: bot.name,
          summary: "Did the work",
          output: workOutput(record.output, refusalsOf(record)),
        },
      });
    } catch (_e) {
      r = null;
    }
    if (!r || r.error || !r.goal) {
      // Couldn't make the job: the work goes on unchecked, as before.
      publisher.release(bot, {
        cause: kept.cause,
        results: kept.results,
        trigger: record.trigger || null,
        output: record.output || "",
      });
      return true;
    }
    const goalId = r.goal.id;
    held.set(goalId, {
      botId,
      cause: kept.cause,
      results: kept.results,
      trigger: record.trigger || null,
      // What it was given and its picks (DASH-92), for its `failed` event.
      input: kept.input || prompt,
      picks: kept.picks || null,
    });
    mark(botId, record, goalId, "checking");
    // The caller (the lead's ask) reads where its answer went.
    record.checks = { goalId, state: "checking", title: r.goal.title };
    notify(botId, { goalId, state: "checking" });
    return true;
  }

  /**
   * The bot's runs that made the job's work, newest last: marked with the
   * job when they ended (the first run was started before its job was).
   */
  function jobRuns(botId, goalId) {
    let runs = [];
    try {
      runs = getRuns(botId) || [];
    } catch (_e) {
      runs = [];
    }
    return runs.filter(
      (r) =>
        r &&
        r.checks &&
        r.checks.goalId === goalId &&
        r.checks.state !== "review",
    );
  }

  /**
   * Why a job ended without passing, for its `failed` event: the check it
   * didn't pass on its last try, why it couldn't go on, or that you closed
   * it.
   */
  function failReason(goal, task) {
    const history = (task && task.history) || [];
    const tries = history.filter((r) => r && r.stepId === WORK_STEP).length;
    const closedBy = history[history.length - 1];
    const before = [...history]
      .reverse()
      .find((r) => r && !(r.by === "you" && r.status === "close"));
    if (before && before.status === "failed") {
      const step = (goal.flow.steps || []).find((s) => s.id === before.stepId);
      const name = (step && step.name) || before.botName || "A check";
      return `Didn't pass "${name}" on try ${Math.max(1, tries)}${
        before.summary ? `: ${before.summary}` : ""
      }`;
    }
    if (before && before.ask) {
      return `It asked "${before.ask}", and was closed without an answer`;
    }
    if (before && before.status === "needs-you" && before.summary) {
      return `It couldn't finish: ${before.summary}`;
    }
    return closedBy && closedBy.by === "you"
      ? "You closed it before it was handed on"
      : "It was closed before it was handed on";
  }

  function settle(goalId, info) {
    settled.add(goalId);
    held.delete(goalId);
    const list = waiters.get(goalId) || [];
    waiters.delete(goalId);
    for (const resolve of list) resolve(info);
  }

  /** The ledger changed: a job that passed goes on; one that stopped doesn't. */
  function onChange(change) {
    if (!change || !change.goalId || settled.has(change.goalId)) return;
    if (change.type === "deleted") {
      // Its first run (not removed with the job's own runs) isn't shown as
      // being checked any more.
      const entry = held.get(change.goalId);
      const botId = (entry && entry.botId) || change.botId;
      if (botId) {
        for (const run of jobRuns(botId, change.goalId)) {
          mark(botId, run, change.goalId, "stopped");
        }
        notify(botId, { goalId: change.goalId, state: "stopped" });
      }
      settle(change.goalId, { goalId: change.goalId, state: "gone" });
      return;
    }
    const job = jobOf(change.goalId);
    if (!job) return;
    const { goal } = job;
    const info = stateOf(goal.id);
    const botId = goal.flow.botId;
    const bot = getBot(botId);
    // A question waits for its answer (DASH-101), whatever onFail says.
    if (info.state === "needs-you" && !info.ask && goal.flow.onFail !== "you") {
      // Out of tries, or "It fails": closed — it failed (below), nothing
      // handed on. Only "It comes to you" waits for you.
      const s = store();
      if (s && job.task)
        s.userAction(job.task.id, { type: "close", dash: true });
      return; // The close comes back as its own change.
    }
    if (info.state === "passed") {
      const entry = held.get(goal.id) || {
        cause: rootCause(),
        results: [],
        trigger: null,
      };
      const runs = jobRuns(botId, goal.id);
      // Already handed on (before a restart): never twice.
      if (runs.some((r) => r.checks.state === "passed")) {
        settle(goal.id, info);
        return;
      }
      runs.forEach((run, i) =>
        mark(
          botId,
          run,
          goal.id,
          i === runs.length - 1 ? "passed" : "replaced",
        ),
      );
      // Nothing to hand on (DASH-65): no results, no `completed`, no
      // `failed`. What it held is let go.
      if (info.handOn === false) {
        settle(goal.id, info);
        notify(botId, {
          goalId: goal.id,
          state: "passed",
          handOn: false,
          reason: info.reason || "",
          ...(info.ended ? { ended: info.ended } : {}),
        });
        return;
      }
      if (bot) {
        publisher.release(bot, {
          cause: entry.cause,
          results: entry.results,
          trigger: entry.trigger,
          output: info.output,
        });
      }
      settle(goal.id, info);
      notify(botId, { goalId: goal.id, state: "passed" });
      return;
    }
    if (info.state === "stopped") {
      const runs = jobRuns(botId, goal.id);
      // Already failed (before a restart), or closed before failing sent
      // anything (no mark on its close): never sent again.
      const close = [...((job.task && job.task.history) || [])]
        .reverse()
        .find((r) => r && r.status === "close");
      if (
        runs.some((r) => r.checks.state === "stopped") ||
        !(close && close.failed)
      ) {
        for (const run of runs) mark(botId, run, goal.id, "stopped");
        settle(goal.id, info);
        return;
      }
      for (const run of runs) {
        mark(botId, run, goal.id, "stopped");
      }
      // It failed: its `failed` event goes out with why, under the cause
      // of the run that started it (whatever listens for failures runs).
      const entry = held.get(goal.id) || { cause: rootCause(), trigger: null };
      const reason = failReason(goal, job.task);
      if (bot) {
        publisher.fail(bot, {
          cause: entry.cause,
          trigger: entry.trigger,
          error: reason,
          // What it was given (DASH-92): kept with the held work, else the
          // job's body (it's the input, after a restart too).
          input: entry.input || (goal && goal.body) || "",
          picks: entry.picks || null,
        });
      }
      settle(goal.id, { ...info, reason });
      // It failed out (DASH-122): the job's step fails, saying why.
      notify(botId, {
        goalId: goal.id,
        state: "stopped",
        failed: true,
        reason,
      });
      return;
    }
    // Waiting for the user: someone waiting on it hears now.
    if (info.state === "waiting" || info.state === "needs-you") {
      const list = waiters.get(goal.id) || [];
      waiters.delete(goal.id);
      for (const resolve of list) resolve(info);
      notify(botId, { goalId: goal.id, state: info.state });
    }
  }

  /**
   * How a job ends, or where it is: resolves when it passes, stops, or
   * waits for the user — or after `ms` with it still being checked.
   */
  function waitFor(goalId, ms) {
    const now = stateOf(goalId);
    if (now.state !== "checking") return Promise.resolve(now);
    return new Promise((resolve) => {
      let timer = null;
      const done = (info) => {
        if (timer) clearTimer(timer);
        resolve(info);
      };
      const list = waiters.get(goalId) || [];
      list.push(done);
      waiters.set(goalId, list);
      timer = setTimer(
        () => {
          const rest = (waiters.get(goalId) || []).filter((f) => f !== done);
          if (rest.length) waiters.set(goalId, rest);
          else waiters.delete(goalId);
          resolve(stateOf(goalId));
        },
        Math.max(0, Number(ms) || 0),
      );
    });
  }

  return { afterRun, onChange, waitFor, stateOf, holdsRun, checkingFor };
}

module.exports = { createCheckJobs };
