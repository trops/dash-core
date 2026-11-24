/**
 * checkJobs.test.js — a bot's own checks (bot-checks PRD, DASH-9), end to
 * end through the real ledger, flow runner, checks and event publisher,
 * with stand-in bot runs:
 *
 *   Writer runs (its schedule, its lead, you) → its work is held as a job →
 *   "No TODOs" (rules, no AI) → [Reviewer] → [You approve] → it goes on
 *
 * A bot with no checks goes straight on, as before. A fail goes back to the
 * writer with what failed and its answer is recorded for it; past its tries
 * the job waits for you; "stop" closes it. Only work that passed is handed
 * on: its held results, then its `completed` event under the first run's
 * cause. The lead's wait hears where the work is.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createGoalStore } = require("../goals/goalStore");
const { createFlowRunner } = require("../flows/flowRunner");
const { runCheck } = require("../checks/checkRunner");
const BotEventPublisher = require("./BotEventPublisher");
const { createCheckJobs } = require("./checkJobs");
const { WORK_STEP } = require("./botChecks");
const { lastAnswers } = require("./lastAnswers");

const settle = () => new Promise((r) => setImmediate(r));
async function until(fn, tries = 300) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await settle();
  }
  return false;
}

const NO_TODOS = {
  kind: "check",
  name: "No TODOs",
  check: {
    kind: "rules",
    rules: [{ type: "banned", field: "input.answer", words: ["todo"] }],
  },
};

let dir;
let goals;
let runner;
let jobs;
let publisher;
let bots;
let runs;
let sent;
let saved;
let notices;
let answers;
let reviewerSays;
let started;
let retryResults;
let onRetry;
let clock;

function bot(id, extra = {}) {
  bots[id] = { id, name: id, workspaceId: "ws1", ...extra };
  return bots[id];
}

/** A run of `botId` ends the way botController's _run ends it. */
function endRun(botId, opts, record) {
  const full = {
    trigger: opts.trigger || "manual",
    startedAt: `t${++clock}`,
    ...(opts.goal && opts.goal.goalId
      ? { goalId: opts.goal.goalId, taskId: opts.goal.taskId || null }
      : {}),
    ...record,
  };
  (runs[botId] = runs[botId] || []).push({ ...full });
  const held = jobs.afterRun({ botId, opts, record: full });
  if (!held) publisher.endRun(bots[botId], full);
  return full;
}

/** A run the user (or a schedule, or a lead) starts. */
function userRun(botId, answer, opts = {}) {
  publisher.startRun(botId, undefined, {
    hold: jobs.holdsRun(bots[botId], opts),
  });
  publisher.onRunEvent(botId, { type: "text", text: answer });
  return endRun(
    botId,
    { prompt: "Write the brief", ...opts },
    {
      status: "completed",
      output: answer,
    },
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-check-jobs-"));
  bots = {};
  runs = {};
  sent = [];
  saved = [];
  notices = [];
  answers = [];
  reviewerSays = "passed";
  started = [];
  retryResults = [];
  onRetry = null;
  clock = 0;
  publisher = new BotEventPublisher({
    publish: (msg) => sent.push(msg),
    providerType: () => null,
    saveResult: (b, payload) => saved.push({ botId: b.id, payload }),
  });
  goals = createGoalStore({
    root: path.join(dir, "goals"),
    onChange: (change) => {
      jobs.onChange(change);
      runner.schedule();
    },
  });
  jobs = createCheckJobs({
    goals: () => goals,
    getBot: (id) => bots[id] || null,
    publisher,
    patchRun: (id, startedAt, patch) => {
      const run = (runs[id] || []).find((r) => r.startedAt === startedAt);
      if (run) Object.assign(run, patch);
    },
    getRuns: (id) => runs[id] || [],
    notify: (botId, info) => notices.push({ botId, ...info }),
  });
  // The runner starts the writer again (or the reviewer) for a job.
  runner = createFlowRunner({
    store: goals,
    runCheck: (check, input, ctx) => runCheck(check, input, ctx),
    runBot: async (botId, opts) => {
      started.push({ botId, opts });
      publisher.startRun(botId, undefined, {
        hold: jobs.holdsRun(bots[botId], opts),
      });
      if (botId === "bot_reviewer") {
        const { taskId } = opts.goal;
        goals.claimTask(taskId, { botId, botName: "Reviewer" });
        goals.writeDone(taskId, {
          botId,
          status: reviewerSays,
          summary: reviewerSays === "passed" ? "Reads well" : "Too vague",
        });
        return endRun(botId, opts, { status: "completed", output: "ok" });
      }
      const answer = answers.shift() || "Fixed brief";
      if (retryResults.length) {
        publisher.sendResult(bots[botId], retryResults.shift());
      }
      if (onRetry) onRetry();
      return endRun(botId, opts, { status: "completed", output: answer });
    },
  });
  runner.start();
});

afterEach(() => {
  runner.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const completedEvents = () =>
  sent.filter((m) => /\.completed$/.test(m.eventType));
const failedEvents = () => sent.filter((m) => /\.failed$/.test(m.eventType));
const onlyJob = () => goals.listGoals({ workspaceId: "ws1" })[0] || null;

describe("a bot with no checks", () => {
  it("goes straight on, with no job", () => {
    bot("bot_w");
    userRun("bot_w", "The brief");
    assert.equal(completedEvents().length, 1);
    assert.equal(completedEvents()[0].content.output, "The brief");
    assert.equal(onlyJob(), null);
  });
});

describe("a bot with checks", () => {
  it("holds its work as a job until it passes, then hands it on", async () => {
    bot("bot_w", { checks: { steps: [NO_TODOS] } });
    const record = userRun("bot_w", "The brief, all done");
    assert.equal(completedEvents().length, 0, "nothing goes out while held");
    assert.ok(record.checks && record.checks.goalId);
    assert.equal(runs.bot_w[0].checks.state, "checking");
    assert.ok(await until(() => completedEvents().length === 1));
    assert.equal(completedEvents()[0].content.output, "The brief, all done");
    const job = onlyJob();
    assert.equal(job.tasks[0].status, "done");
    assert.equal(job.flow.kind, "bot-checks");
    assert.equal(runs.bot_w[0].checks.state, "passed");
    assert.deepEqual(
      notices.map((n) => n.state),
      ["checking", "passed"],
    );
    assert.equal(started.length, 0, "it passed first time: no new run");
  });

  it("sends a fail back with what failed, records the new answer, then passes", async () => {
    bot("bot_w", { checks: { steps: [NO_TODOS], maxTries: 3 } });
    answers.push("The brief, no loose ends");
    userRun("bot_w", "The brief. TODO: add the dentist");
    assert.ok(await until(() => completedEvents().length === 1));
    assert.equal(started.length, 1);
    const retry = started[0].opts;
    assert.equal(retry.trigger, "flow");
    assert.match(retry.prompt, /"No TODOs" failed: .*Banned words: todo/);
    assert.match(retry.prompt, /Your last answer:\nThe brief\. TODO/);
    assert.match(retry.prompt, /What you were asked:\nWrite the brief/);
    assert.doesNotMatch(retry.prompt, /claim_task/);
    assert.equal(
      completedEvents()[0].content.output,
      "The brief, no loose ends",
    );
    const task = onlyJob().tasks[0];
    const work = task.history.filter((r) => r.stepId === WORK_STEP);
    assert.equal(work.length, 2);
    assert.equal(work[1].said, "bot");
    assert.equal(work[1].botId, "bot_w");
    assert.deepEqual(
      runs.bot_w.map((r) => r.checks.state),
      ["replaced", "passed"],
    );
    // Only the passed answer reads back as the bot's last answer.
    const timed = runs.bot_w.map((r, i) => ({
      ...r,
      endedAt: new Date(Date.UTC(2026, 10, 17, 9, i)).toISOString(),
    }));
    const read = lastAnswers(timed, 3);
    assert.deepEqual(
      read.map((a) => a.output),
      ["The brief, no loose ends"],
    );
  });

  it("fails after its last try: nothing handed on, its failed event says why (DASH-12)", async () => {
    bot("bot_w", { checks: { steps: [NO_TODOS], maxTries: 2 } });
    answers.push("Still a TODO");
    userRun("bot_w", "A TODO here");
    assert.ok(
      await until(() => {
        const t = onlyJob() && onlyJob().tasks[0];
        return t && t.status === "closed";
      }),
    );
    assert.equal(completedEvents().length, 0);
    assert.equal(failedEvents().length, 1);
    assert.match(
      failedEvents()[0].content.error,
      /Didn't pass "No TODOs" on try 2: .*Banned words: todo/,
    );
    // Dash closed it, and marked its close as a fail.
    const close = onlyJob().tasks[0].history.find((r) => r.status === "close");
    assert.equal(close.dash, true);
    assert.equal(close.failed, true);
    // After a restart, another change to it doesn't send failed again.
    const again = createCheckJobs({
      goals: () => goals,
      getBot: (id) => bots[id] || null,
      publisher,
      patchRun: () => {},
      getRuns: (id) => runs[id] || [],
    });
    again.onChange({ goalId: onlyJob().id, type: "updated" });
    assert.equal(failedEvents().length, 1);
    assert.equal(jobs.stateOf(onlyJob().id).state, "stopped");
    // Both tries ran, and you weren't asked.
    const history = onlyJob().tasks[0].history;
    assert.equal(history.filter((r) => r.stepId === WORK_STEP).length, 2);
    assert.equal(
      history.some((r) => r.by === "you" && r.status !== "close"),
      false,
    );
  });

  it('on "you", a fail comes straight to you', async () => {
    bot("bot_w", { checks: { steps: [NO_TODOS], onFail: "you" } });
    userRun("bot_w", "TODO");
    assert.ok(await until(() => onlyJob().tasks[0].status === "needs-you"));
    assert.equal(started.length, 0);
    // Not failed yet: it waits for you.
    assert.equal(failedEvents().length, 0);
    // Your Close fails it, and says so.
    goals.userAction(onlyJob().tasks[0].id, "close");
    assert.ok(await until(() => failedEvents().length === 1));
    assert.match(
      failedEvents()[0].content.error,
      /Didn't pass "No TODOs" on try 1/,
    );
  });

  it('on "stop", a fail closes the job and nothing goes on', async () => {
    bot("bot_w", { checks: { steps: [NO_TODOS], onFail: "stop" } });
    userRun("bot_w", "TODO");
    assert.ok(await until(() => onlyJob().tasks[0].status === "closed"));
    assert.equal(completedEvents().length, 0);
    // It failed: its failed event goes out with the check and why.
    assert.equal(failedEvents().length, 1);
    assert.match(
      failedEvents()[0].content.error,
      /Didn't pass "No TODOs" on try 1/,
    );
    assert.equal(runs.bot_w[0].checks.state, "stopped");
    assert.equal(notices[notices.length - 1].state, "stopped");
  });

  it("holds the results it sent and saves them only once it passes", async () => {
    bot("bot_w", {
      checks: { steps: [NO_TODOS] },
      publishes: [{ name: "brief" }],
    });
    publisher.startRun("bot_w", undefined, {
      hold: jobs.holdsRun(bots.bot_w, {}),
    });
    publisher.sendResult(bots.bot_w, { name: "brief", items: [] });
    assert.equal(sent.length, 0);
    assert.ok(publisher.holding("bot_w"));
    endRun(
      "bot_w",
      { prompt: "Write it" },
      { status: "completed", output: "Done" },
    );
    assert.ok(await until(() => completedEvents().length === 1));
    const names = sent.map((m) => m.eventType.split("].")[1]);
    assert.deepEqual(names, ["result.brief", "completed"]);
    assert.equal(saved.length, 1);
  });

  it("a failed run isn't checked: it goes out as before", () => {
    bot("bot_w", { checks: { steps: [NO_TODOS] } });
    publisher.startRun("bot_w", undefined, { hold: true });
    endRun(
      "bot_w",
      { prompt: "Write it" },
      { status: "failed", error: "No calendar" },
    );
    assert.equal(onlyJob(), null);
    assert.match(sent[0].eventType, /\.failed$/);
  });
});

describe("a reviewer and your approval", () => {
  it("runs the reviewer on the work, waits for you, and goes on when you approve", async () => {
    bot("bot_reviewer");
    bot("bot_w", {
      checks: {
        steps: [
          NO_TODOS,
          { kind: "reviewer", name: "Reads clearly", botId: "bot_reviewer" },
          { kind: "you", name: "You approve" },
        ],
      },
    });
    userRun("bot_w", "A clear brief");
    assert.ok(await until(() => onlyJob().tasks[0].status === "ready"));
    const review = started.find((s) => s.botId === "bot_reviewer");
    assert.ok(review, "the reviewer ran");
    // The reviewer read the writer's work, not its own record.
    assert.match(review.opts.prompt, /A clear brief/);
    // The reviewer's own run isn't handed on, nor shown as an answer.
    assert.equal(completedEvents().length, 0);
    assert.equal(runs.bot_reviewer[0].checks.state, "review");
    const job = onlyJob();
    assert.equal((await jobs.waitFor(job.id, 1000)).state, "waiting");
    goals.userAction(job.tasks[0].id, "done");
    assert.ok(await until(() => completedEvents().length === 1));
    assert.equal(completedEvents()[0].content.botId, "bot_w");
  });

  it("Send back runs the writer again with your reason", async () => {
    bot("bot_w", {
      checks: { steps: [{ kind: "you", name: "You approve" }] },
    });
    answers.push("Brief with the pickup time");
    userRun("bot_w", "Brief");
    assert.ok(await until(() => onlyJob().tasks[0].status === "ready"));
    const { tasks } = onlyJob();
    const r = goals.userAction(tasks[0].id, {
      type: "send-back",
      reason: "Add the school pickup time",
    });
    assert.ok(!r.error, r.error);
    assert.ok(await until(() => started.length === 1));
    assert.match(
      started[0].opts.prompt,
      /The user sent it back: Add the school pickup time/,
    );
    assert.ok(await until(() => onlyJob().tasks[0].status === "ready"));
    goals.userAction(onlyJob().tasks[0].id, "done");
    assert.ok(await until(() => completedEvents().length === 1));
    assert.equal(
      completedEvents()[0].content.output,
      "Brief with the pickup time",
    );
  });
});

describe("held work after review", () => {
  it("hands on only the results of the try that passed", async () => {
    bot("bot_w", {
      checks: { steps: [NO_TODOS] },
      publishes: [{ name: "brief" }, { name: "draft" }],
    });
    retryResults.push({ name: "brief", label: "try 2", items: [] });
    publisher.startRun("bot_w", undefined, { hold: true });
    publisher.sendResult(bots.bot_w, {
      name: "draft",
      label: "try 1",
      items: [],
    });
    endRun(
      "bot_w",
      { prompt: "Write it" },
      { status: "completed", output: "TODO" },
    );
    assert.ok(await until(() => completedEvents().length === 1));
    const names = sent.map((m) => m.eventType.split("].")[1]);
    assert.deepEqual(names, ["result.brief", "completed"]);
    assert.deepEqual(
      saved.map((s) => s.payload.label),
      ["try 2"],
    );
  });

  it("drops what a stopped run sent: it was never checked", () => {
    bot("bot_w", {
      checks: { steps: [NO_TODOS] },
      publishes: [{ name: "brief" }],
    });
    publisher.startRun("bot_w", undefined, { hold: true });
    publisher.sendResult(bots.bot_w, { name: "brief", items: [] });
    endRun("bot_w", { prompt: "Write it" }, { status: "stopped" });
    assert.equal(sent.length, 0);
    assert.equal(saved.length, 0);
    assert.equal(onlyJob(), null);
  });

  it("a bot with checks used as a step in another flow isn't held", () => {
    const b = bot("bot_w", { checks: { steps: [NO_TODOS] } });
    assert.equal(
      jobs.holdsRun(b, { trigger: "flow", goal: { goalId: "goal_other1" } }),
      false,
    );
    assert.equal(jobs.holdsRun(b, { trigger: "schedule" }), true);
    assert.equal(jobs.holdsRun(bot("bot_plain"), { trigger: "ask" }), false);
  });

  it("a job deleted while the bot answers again: nothing goes out, its first run isn't left checking", async () => {
    bot("bot_w", { checks: { steps: [NO_TODOS] } });
    onRetry = () => {
      const g = onlyJob();
      if (g) goals.deleteGoal(g.id);
    };
    userRun("bot_w", "TODO");
    assert.ok(await until(() => onlyJob() === null && started.length === 1));
    await settle();
    assert.equal(completedEvents().length, 0);
    assert.equal(runs.bot_w[0].checks.state, "stopped");
  });

  it("a job that already went out isn't handed on again (after a restart)", async () => {
    bot("bot_w", { checks: { steps: [NO_TODOS] } });
    userRun("bot_w", "Fine");
    assert.ok(await until(() => completedEvents().length === 1));
    // A fresh start: nothing in memory, the ledger and runs as they were.
    const again = createCheckJobs({
      goals: () => goals,
      getBot: (id) => bots[id] || null,
      publisher,
      patchRun: () => {},
      getRuns: (id) => runs[id] || [],
    });
    again.onChange({ type: "task", goalId: onlyJob().id });
    assert.equal(completedEvents().length, 1);
  });
});

describe("the lead's wait", () => {
  it("hears the checked answer, or where the work is after the wait", async () => {
    bot("bot_w", { checks: { steps: [{ kind: "you", name: "You approve" }] } });
    const record = userRun("bot_w", "Brief", { via: "lead:bot_lead" });
    const job = onlyJob();
    assert.equal(job.source.kind, "lead");
    const info = await jobs.waitFor(record.checks.goalId, 5000);
    assert.equal(info.state, "waiting");
    assert.equal(info.title, "bot_w: Write the brief");
  });

  it("times out with the work still being checked", async () => {
    bot("bot_w", {
      checks: {
        steps: [{ kind: "reviewer", name: "Review", botId: "bot_slow" }],
      },
    });
    // A reviewer that never answers: the job stays at its step.
    bot("bot_slow");
    const record = userRun("bot_w", "Brief");
    runner.stop();
    const info = await jobs.waitFor(record.checks.goalId, 10);
    assert.equal(info.state, "checking");
  });
});

describe("nothing to hand on (DASH-65)", () => {
  // A script check runs in its own process: wait by the clock, not by
  // ticks (a slow CI machine takes longer than a few thousand ticks).
  async function waitFor(fn, ms = 10000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return fn();
  }
  const NOTHING = {
    kind: "check",
    name: "A ticket to take",
    check: {
      kind: "script",
      script:
        "function check(input) {\n" +
        "  const t = String(input.input.answer || '');\n" +
        "  if (/no ticket/i.test(t)) return { pass: true, handOn: false, reason: 'No ticket to take' };\n" +
        "  return { pass: true, reason: 'A ticket' };\n" +
        "}",
    },
  };
  const REVIEW = {
    kind: "reviewer",
    name: "Reviewer approves",
    botId: "bot_reviewer",
  };

  it("ends the work: no completed, no failed, no results, the rest of its checks don't run", async () => {
    bot("bot_reviewer");
    bot("bot_t", { checks: { steps: [NOTHING, REVIEW] } });
    retryResults = [];
    userRun("bot_t", "No ticket matched.");
    assert.ok(await waitFor(() => notices.some((n) => n.state === "passed")));
    const last = notices[notices.length - 1];
    assert.equal(last.handOn, false);
    assert.equal(last.reason, "No ticket to take");
    assert.equal(completedEvents().length, 0);
    assert.equal(failedEvents().length, 0);
    assert.equal(started.length, 0, "the reviewer never ran");
    const task = onlyJob().tasks[0];
    assert.equal(task.status, "done");
    assert.equal(task.history[task.history.length - 1].handOn, false);
  });

  it("a pass without it hands on as before", async () => {
    bot("bot_reviewer");
    bot("bot_t", { checks: { steps: [NOTHING, REVIEW] } });
    userRun("bot_t", "DASH-1: take it");
    assert.ok(await waitFor(() => completedEvents().length === 1));
    assert.equal(started.length, 1, "the reviewer ran");
  });
});
