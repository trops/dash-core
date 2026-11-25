/**
 * jobTracker.js — a job is one chain of work that goes through a team lead
 * (DASH-28, DASH-31): the lead's run, the bots it asks, their checks, and
 * every hand-on they set off, until none is still going.
 *
 *   job:  { id, workspaceId, leadId, leadName, title, startedBy,
 *           conversationId, status, steps, createdAt, updatedAt, endedAt }
 *   step: { id, botId, botName, status, why, runAt, startedAt, endedAt,
 *           summary, goalId, conversationId }
 *
 * Step statuses: queued (a hand-on about to start), running, checking (its
 * checks are trying the work), needs-you (waiting on the user: a paused
 * bot, checks that need a look), done, failed, stopped, skipped.
 *
 * A job is running while any step is queued, running or checking — and for
 * a moment after the last one ends, because hand-ons start a tick after the
 * bot that sets them off (botController defers bot→bot dispatch). Then it
 * is done, failed or stopped, from its steps. Needs-you wins over running,
 * so a job stuck on the user says so.
 *
 * Pure apart from the injected store, clock and timers.
 */
"use strict";

const SETTLE_MS = 2000;
const MAX_STEPS = 100;
const MAX_TITLE = 200;
const MAX_SUMMARY = 600;
// What was asked, kept so the job can be run again.
const MAX_REQUEST = 4000;

const ACTIVE = new Set(["queued", "running", "checking"]);
const WAITING = new Set(["queued", "needs-you"]);
const FINAL = new Set(["done", "failed", "stopped"]);

const clip = (s, n) => {
  const t = String(s == null ? "" : s)
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** A job's status from its steps (settling: a step just ended). */
function jobStatus(steps, settling = false) {
  const list = steps || [];
  // Just made: its lead's run is about to start.
  if (!list.length) return "running";
  if (list.some((s) => s.status === "needs-you")) return "needs-you";
  if (settling || list.some((s) => ACTIVE.has(s.status))) return "running";
  if (list.some((s) => s.status === "failed")) return "failed";
  if (list.some((s) => s.status === "stopped")) return "stopped";
  // Nothing ran at all (its lead was busy): stopped, not done.
  if (list.every((s) => s.status === "skipped")) return "stopped";
  return "done";
}

/** A finished run's status, as a step's. */
function stepStatusOf(record) {
  const s = record && record.status;
  if (s === "completed") return "done";
  if (s === "failed" || s === "error") return "failed";
  if (s === "skipped") return "skipped";
  return "stopped";
}

/** What a run's record says, short. */
function summaryOf(record) {
  if (!record) return "";
  if (record.status === "failed" || record.status === "error") {
    return clip(record.error || "It failed.", MAX_SUMMARY);
  }
  if (record.status === "skipped") {
    return clip(
      record.reason || record.skipped || "It didn't run.",
      MAX_SUMMARY,
    );
  }
  return clip(record.output || "", MAX_SUMMARY);
}

/**
 * @param {{
 *   store: ReturnType<import("./jobStore").createJobStore>,
 *   now?: () => number,
 *   random?: () => number,
 *   onChange?: (job: object) => void,
 *   setTimer?: Function, clearTimer?: Function, settleMs?: number,
 * }} deps
 */
function createJobTracker({
  store,
  now = Date.now,
  random = Math.random,
  onChange = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  settleMs = SETTLE_MS,
}) {
  const iso = () => new Date(now()).toISOString();
  const newId = (prefix) =>
    `${prefix}_${now().toString(36)}${Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, "0")}`;
  const settling = new Map(); // jobId → timer
  const waiters = new Map(); // jobId → [resolve]
  // goalId → jobId: a step's checks, found without reading every job ever
  // kept (jobs are never pruned on their own).
  let byGoal = null;
  const goalIndex = () => {
    if (!byGoal) {
      byGoal = new Map();
      for (const j of store.list()) {
        for (const st of j.steps || []) {
          if (st.goalId) byGoal.set(st.goalId, j.id);
        }
      }
    }
    return byGoal;
  };

  function commit(job) {
    job.status = jobStatus(job.steps, settling.has(job.id));
    job.updatedAt = iso();
    if (FINAL.has(job.status)) job.endedAt = job.endedAt || job.updatedAt;
    else job.endedAt = null;
    try {
      store.save(job);
    } catch (_e) {
      // Kept in memory; written on its next change.
    }
    try {
      onChange(job);
    } catch (_e) {
      // A listener never stops the job.
    }
    if (FINAL.has(job.status)) {
      const list = waiters.get(job.id) || [];
      waiters.delete(job.id);
      for (const resolve of list) resolve(job);
    }
    return job;
  }

  function settle(job) {
    const t = settling.get(job.id);
    if (t) clearTimer(t);
    settling.set(
      job.id,
      setTimer(() => {
        settling.delete(job.id);
        const current = store.get(job.id);
        if (current) commit(current);
      }, settleMs),
    );
  }

  function unsettle(jobId) {
    const t = settling.get(jobId);
    if (t) clearTimer(t);
    settling.delete(jobId);
  }

  const jobOf = (jobId) => (jobId ? store.get(jobId) : null);

  /** Start a job for a lead's run. */
  function startJob({
    workspaceId = null,
    leadId = null,
    leadName = "",
    title = "",
    request = "",
    startedBy = { kind: "you" },
    conversationId = null,
  } = {}) {
    const at = iso();
    const job = {
      id: newId("job"),
      workspaceId: workspaceId == null ? null : String(workspaceId),
      leadId: leadId || null,
      leadName: leadName || "",
      title: clip(title, MAX_TITLE) || "A job",
      request: String(request || title || "").slice(0, MAX_REQUEST),
      startedBy: { kind: "you", ...startedBy },
      conversationId: conversationId || null,
      status: "running",
      steps: [],
      createdAt: at,
      updatedAt: at,
      endedAt: null,
    };
    return commit(job);
  }

  function addStep(job, step) {
    if (job.steps.length >= MAX_STEPS) return null;
    const s = {
      id: newId("step"),
      botId: step.botId,
      botName: step.botName || step.botId,
      status: step.status,
      why: step.why || null,
      runAt: step.runAt || null,
      startedAt: step.status === "running" ? iso() : null,
      endedAt: null,
      summary: step.summary ? clip(step.summary, MAX_SUMMARY) : "",
      goalId: step.goalId || null,
      conversationId: step.conversationId || null,
    };
    job.steps.push(s);
    return s;
  }

  /**
   * A bot's run in the job starts. A hand-on that was waiting for it (queued,
   * or for the user to turn the bot on) becomes this run.
   */
  function startStep(jobId, { botId, botName, runAt, why, conversationId }) {
    const job = jobOf(jobId);
    if (!job) return null;
    unsettle(job.id);
    let step = job.steps.find(
      (s) => s.botId === botId && WAITING.has(s.status),
    );
    if (step) {
      step.status = "running";
      step.waiting = null;
      step.runAt = runAt || null;
      step.startedAt = iso();
      step.summary = "";
      if (conversationId) step.conversationId = conversationId;
    } else {
      step = addStep(job, {
        botId,
        botName,
        status: "running",
        why,
        runAt,
        conversationId,
      });
    }
    commit(job);
    return step;
  }

  /** A hand-on that can't start yet: waiting on the user (a paused bot). */
  function waitStep(jobId, { botId, botName, why, summary, waiting = null }) {
    const job = jobOf(jobId);
    if (!job) return null;
    unsettle(job.id);
    const step =
      job.steps.find((s) => s.botId === botId && WAITING.has(s.status)) ||
      addStep(job, { botId, botName, status: "needs-you", why });
    if (!step) return null;
    step.status = "needs-you";
    step.summary = clip(summary || "", MAX_SUMMARY);
    // What it waits on: "paused" (Turn on) or "budget".
    step.waiting = waiting || null;
    commit(job);
    return step;
  }

  /**
   * A hand-on waiting for its bot to finish another run (DASH-73). Queued
   * counts as going, so the job stays open; startStep turns it into the run.
   */
  function queueStep(jobId, { botId, botName, why, summary }) {
    const job = jobOf(jobId);
    if (!job) return null;
    unsettle(job.id);
    const step = addStep(job, {
      botId,
      botName,
      status: "queued",
      why,
      summary,
    });
    if (step) step.waiting = "busy";
    commit(job);
    return step;
  }

  /** A hand-on that won't run (its bot drops events while paused). */
  function skipStep(jobId, { botId, botName, why, summary }) {
    const job = jobOf(jobId);
    if (!job) return null;
    const step = addStep(job, {
      botId,
      botName,
      status: "skipped",
      why,
      summary,
    });
    if (step) step.endedAt = iso();
    settle(job);
    commit(job);
    return step;
  }

  const stepOfRun = (job, botId, runAt) =>
    job.steps.find((s) => s.botId === botId && s.runAt && s.runAt === runAt) ||
    // The run's start time is only known once it has begun; the newest
    // running step of that bot is this run.
    [...job.steps]
      .reverse()
      .find((s) => s.botId === botId && s.status === "running");

  /**
   * A bot's run in the job ended. `checking` + goalId: its checks are trying
   * the work (bot-checks), so the step goes on until they pass.
   */
  function endStep(jobId, { botId, runAt, record, checking = null }) {
    const job = jobOf(jobId);
    if (!job) return null;
    const step = stepOfRun(job, botId, runAt);
    if (!step) return null;
    if (record && record.startedAt) step.runAt = record.startedAt;
    if (checking && checking.goalId) {
      step.status = "checking";
      step.goalId = checking.goalId;
      goalIndex().set(checking.goalId, job.id);
      step.summary = summaryOf(record);
    } else {
      step.status = stepStatusOf(record);
      step.summary = summaryOf(record);
      step.endedAt = iso();
    }
    settle(job);
    commit(job);
    return step;
  }

  /** The checks on a step's work moved on (checkJobs' state for its goal). */
  function checksMoved(goalId, state, summary = null) {
    if (!goalId) return null;
    const job = jobOf(goalIndex().get(goalId));
    const step = job && job.steps.find((s) => s.goalId === goalId);
    if (!step) return null;
    const next =
      state === "passed"
        ? "done"
        : state === "needs-you" || state === "waiting"
          ? "needs-you"
          : state === "stopped" || state === "gone"
            ? "stopped"
            : "checking";
    if (step.status === next) return step;
    // Passed is final: a mark that lands after it (the reviewer's run ends
    // a moment after its verdict passed the work) never reopens the step.
    if (step.status === "done") return step;
    step.status = next;
    if (summary) step.summary = clip(summary, MAX_SUMMARY);
    if (FINAL.has(next)) step.endedAt = iso();
    if (!ACTIVE.has(next)) settle(job);
    else unsettle(job.id);
    commit(job);
    return step;
  }

  /** The job a goal's work belongs to (a check retry joins it). */
  function jobForGoal(goalId) {
    if (!goalId) return null;
    return goalIndex().get(goalId) || null;
  }

  /** Still going (or waiting on the user): a hand-on may join it. */
  function isOpen(jobId) {
    const job = jobOf(jobId);
    return !!job && !FINAL.has(job.status);
  }

  /**
   * Hand-ons still waiting for a bot that won't take them: its queued
   * events ran (a newer one replaced theirs) or it was deleted. They're
   * skipped, said why, so their jobs can end.
   */
  function releaseWaiting(botId, summary) {
    for (const job of store.list()) {
      if (FINAL.has(job.status)) continue;
      const waiting = job.steps.filter(
        (st) => st.botId === botId && WAITING.has(st.status),
      );
      if (!waiting.length) continue;
      for (const st of waiting) {
        st.status = "skipped";
        st.summary = clip(summary, MAX_SUMMARY);
        st.endedAt = iso();
      }
      settle(job);
      commit(job);
    }
  }

  /** Stop job: its waiting hand-ons won't start. */
  function stopWaiting(jobId) {
    const job = jobOf(jobId);
    if (!job) return null;
    for (const st of job.steps) {
      if (WAITING.has(st.status)) {
        st.status = "stopped";
        st.summary = "Stopped before it started.";
        st.endedAt = iso();
      }
    }
    settle(job);
    return commit(job);
  }

  /** Resolves with the job once it has finished (done, failed or stopped). */
  function waitForEnd(jobId) {
    const job = jobOf(jobId);
    if (!job) return Promise.resolve(null);
    if (FINAL.has(job.status) && !settling.has(job.id)) {
      return Promise.resolve(job);
    }
    return new Promise((resolve) => {
      const list = waiters.get(job.id) || [];
      list.push(resolve);
      waiters.set(job.id, list);
    });
  }

  /**
   * After a restart: what was still going when Dash closed is stopped, said
   * plainly. Runs don't survive a restart.
   */
  function interruptLeftovers() {
    for (const job of store.list()) {
      if (FINAL.has(job.status)) continue;
      // Made for a task whose lead never started before Dash closed.
      if (!job.steps.length) {
        const st = addStep(job, {
          botId: job.leadId,
          botName: job.leadName,
          status: "stopped",
          why: job.startedBy,
          summary: "Dash closed before it started.",
        });
        st.endedAt = iso();
        commit(job);
        continue;
      }
      let changed = false;
      for (const s of job.steps) {
        if (ACTIVE.has(s.status) || s.status === "needs-you") {
          s.status = "stopped";
          s.summary = "Dash closed while this was going.";
          s.endedAt = s.endedAt || iso();
          changed = true;
        }
      }
      if (changed || job.status !== jobStatus(job.steps)) commit(job);
    }
  }

  function remove(jobId) {
    unsettle(jobId);
    // Anyone waiting for it (a task) hears it was stopped, never nothing.
    const job = jobOf(jobId);
    const list = waiters.get(jobId) || [];
    waiters.delete(jobId);
    for (const resolve of list) {
      resolve(job ? { ...job, status: "stopped" } : null);
    }
    if (byGoal) {
      for (const [g, j] of byGoal) if (j === jobId) byGoal.delete(g);
    }
    return store.remove(jobId);
  }

  /** Delete finished jobs that ended before `cutoff` (ISO); how many went. */
  function clearEndedBefore(cutoff) {
    let n = 0;
    for (const job of store.list()) {
      if (!FINAL.has(job.status) || settling.has(job.id)) continue;
      if (job.endedAt && job.endedAt < cutoff) {
        if (remove(job.id)) n += 1;
      }
    }
    return n;
  }

  function list({ workspaceId } = {}) {
    const all = store.list();
    return workspaceId == null
      ? all
      : all.filter((j) => String(j.workspaceId) === String(workspaceId));
  }

  return {
    startJob,
    startStep,
    waitStep,
    queueStep,
    skipStep,
    endStep,
    checksMoved,
    jobForGoal,
    isOpen,
    clearEndedBefore,
    releaseWaiting,
    stopWaiting,
    waitForEnd,
    interruptLeftovers,
    remove,
    list,
    get: (id) => store.get(id),
  };
}

module.exports = { createJobTracker, jobStatus, SETTLE_MS };
