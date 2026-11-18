/**
 * flowRunner.test.js — the runner moving a bot's checks job on, through the
 * real ledger, goal tools and checks, with stand-in bots:
 *
 *   Brief writer (its work) → "All events in it" (rules check, no AI)
 *     → Reviewer → You
 *
 * The job starts with the writer's answer as its first record; the check
 * reads it; a fail sends the work back to the writer with what failed, or —
 * at its last try — waits for you; the reviewer is told what to judge. Also:
 * a paused bot is waited for, a reviewer that ends without a record is
 * started once more, then left for you, and a goal that isn't a bot's
 * checks job is left alone.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createGoalStore } = require("../goals/goalStore");
const { handleGoalTool } = require("../goals/goalTools");
const { createFlowRunner } = require("./flowRunner");
const { runCheck } = require("../checks/checkRunner");
const { checksFlow, workOutput, WORK_STEP } = require("../bots/botChecks");

const settle = () => new Promise((r) => setImmediate(r));
async function until(fn, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await settle();
  }
  return false;
}

let dir;
let goals;
let runner;
let botRuns;
let writerBehaviour;
let reviewerBehaviour;

const GOOD = "Standup at 9 (e1), dentist at 4 (e2).";
const MISSES = "Standup at 9 (e1).";

const WRITER = {
  id: "bot_writer",
  name: "Brief writer",
  workspaceId: "ws1",
  checks: {
    steps: [
      {
        id: "step_events",
        kind: "check",
        name: "All events in it",
        check: {
          kind: "rules",
          rules: [{ type: "words", field: "input.answer", min: 6 }],
        },
      },
      {
        id: "step_review",
        kind: "reviewer",
        name: "Reviewer",
        botId: "bot_rev",
      },
      { id: "step_you", kind: "you", name: "You approve" },
    ],
    onFail: "retry",
    maxTries: 3,
  },
};

const flow = checksFlow(WRITER);
const stepName = (stepId) => flow.steps.find((s) => s.id === stepId).name;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-flow-run-"));
  goals = createGoalStore({ root: path.join(dir, "goals") });
  botRuns = [];
  writerBehaviour = "good";
  reviewerBehaviour = "passes";
  const ctx = (botId, botName, goal) => ({
    workspaceId: "ws1",
    botId,
    botName,
    goal,
  });
  // Stand-in bots. The writer answers again (Dash records its answer, as
  // checkJobs does); the reviewer claims and writes its verdict.
  const runBot = async (botId, opts) => {
    botRuns.push({ botId, opts });
    const { taskId } = opts.goal;
    if (botId === "bot_writer") {
      if (writerBehaviour === "paused")
        return { skipped: true, reason: "paused" };
      goals.writeStepRecord(taskId, {
        stepId: WORK_STEP,
        status: "passed",
        summary: "Answered again",
        output: workOutput(writerBehaviour === "misses" ? MISSES : GOOD),
        bot: { botId, botName: "Brief writer" },
      });
      return { status: "completed" };
    }
    if (botId === "bot_rev") {
      const c = ctx("bot_rev", "Reviewer", { ...opts.goal });
      handleGoalTool(goals, c, "claim_task", { taskId });
      if (reviewerBehaviour === "silent") return { status: "completed" };
      handleGoalTool(goals, c, "write_done", {
        taskId,
        status: "passed",
        summary: "Every event is in it",
        evidence: [{ label: "ids", value: "e1, e2" }],
      });
    }
    return { status: "completed" };
  };
  runner = createFlowRunner({
    store: goals,
    runBot,
    runCheck: (check, input, c) => runCheck(check, input, c),
    checkContext: () => ({ fetchStatus: async () => 200 }),
  });
});

afterEach(() => {
  runner.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The writer's run ended: its answer is held as a job (checkJobs). */
function jobStarts(answer = GOOD) {
  const r = goals.createGoal({
    workspaceId: "ws1",
    title: "Brief writer: today's brief",
    body: "Write today's brief.",
    createdBy: { botId: WRITER.id, botName: WRITER.name },
    flow,
    startAfter: {
      stepId: WORK_STEP,
      botId: WRITER.id,
      botName: WRITER.name,
      summary: "Did the work",
      output: workOutput(answer),
    },
  });
  assert.ok(r.goal, r.error);
  return r.goal;
}

const taskOf = (goal) => goals.getGoal(goal.id).tasks[0];

async function drive(goal, until_) {
  for (let i = 0; i < 20; i++) {
    runner.pass();
    await until(() => false, 5);
    if (until_(taskOf(goal))) return taskOf(goal);
  }
  return taskOf(goal);
}

describe("a bot's checks job", () => {
  it("starts past the work, at the first check", () => {
    const goal = jobStarts();
    const task = goal.tasks[0];
    assert.equal(stepName(task.stepId), "All events in it");
    assert.equal(task.history[0].output.answer, GOOD);
  });

  it("check passes with proof → reviewer → waits for you → you mark it done", async () => {
    const goal = jobStarts();
    const task = await drive(goal, (t) => t.status === "ready");
    assert.equal(task.status, "ready");
    assert.equal(stepName(task.stepId), "You approve");
    const check = task.history.find((r) => r.said === "dash");
    assert.equal(check.status, "passed");
    assert.equal(check.kind, "rules");
    // The reviewer was told what it judges, and to claim the task.
    const run = botRuns.find((r) => r.botId === "bot_rev");
    assert.match(run.opts.prompt, /claim_task task_/);
    assert.match(run.opts.prompt, /You judge the work/);
    assert.equal(run.opts.trigger, "flow");
    assert.equal(run.opts.via, `flow:${flow.id}`);
    const done = goals.userAction(task.id, "done");
    assert.equal(done.task.status, "done");
    assert.equal(goals.getGoal(goal.id).status, "done");
  });

  it("a failed check sends the work back with what failed, then stops at its last try", async () => {
    writerBehaviour = "misses";
    const goal = jobStarts(MISSES);
    const task = await drive(goal, (t) => t.status === "needs-you");
    assert.equal(task.status, "needs-you");
    assert.equal(task.round, 3);
    const checks = task.history.filter((r) => r.said === "dash");
    assert.equal(checks.length, 3);
    assert.ok(checks.every((c) => c.status === "failed"));
    assert.equal(checks[2].stopped, true);
    // The writer answered again, told what failed (retryPrompt).
    const again = botRuns.filter((r) => r.botId === "bot_writer")[0].opts;
    assert.match(again.prompt, /It came back: try 2 of 3/);
    assert.match(again.prompt, /"All events in it" failed/);
    // One more round goes back to the writer.
    writerBehaviour = "good";
    const more = goals.userAction(task.id, "one-more-round");
    assert.equal(more.task.stepId, WORK_STEP);
    const after = await drive(goal, (t) => t.status === "ready");
    assert.equal(after.status, "ready");
  });

  it("a paused bot is waited for, not failed", async () => {
    writerBehaviour = "paused";
    const goal = jobStarts(MISSES);
    await drive(goal, () => runner.waitingFor(taskOf(goal).id));
    const t = taskOf(goal);
    assert.equal(t.stepId, WORK_STEP);
    assert.deepEqual(runner.waitingFor(t.id).why, "paused");
    // Not retried at once.
    const runs = botRuns.length;
    runner.pass();
    await until(() => false, 5);
    assert.equal(botRuns.length, runs);
  });

  it("a reviewer that ends twice without a record leaves it for you", async () => {
    reviewerBehaviour = "silent";
    const goal = jobStarts();
    const task = await drive(goal, (t) => t.status === "needs-you");
    assert.equal(task.status, "needs-you");
    assert.match(task.history.at(-1).summary, /without a done record/);
    assert.equal(botRuns.filter((r) => r.botId === "bot_rev").length, 2);
  });

  it("only the bot at the task's step may claim it", async () => {
    const goal = jobStarts();
    await drive(goal, (t) => t.stepId === "step_review");
    const r = handleGoalTool(
      goals,
      { workspaceId: "ws1", botId: "bot_other", botName: "Other" },
      "claim_task",
      { taskId: goal.tasks[0].id },
    );
    assert.equal(r.isError, true);
  });
});

describe("goals that aren't a bot's checks job", () => {
  it("are left alone, even with a flow of their own", async () => {
    const other = { ...flow, id: "flow_abcdef", kind: undefined };
    const r = goals.createGoal({
      workspaceId: "ws1",
      title: "Old flow work",
      flow: other,
    });
    assert.ok(r.goal, r.error);
    const plain = goals.createGoal({ workspaceId: "ws1", title: "Plain" });
    assert.ok(plain.goal, plain.error);
    runner.pass();
    await until(() => false, 10);
    assert.equal(botRuns.length, 0);
    assert.equal(goals.getGoal(r.goal.id).tasks[0].history.length, 0);
  });
});
