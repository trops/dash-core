/**
 * flowRunner.test.js — UC6, the daily brief, end to end through the real
 * ledger, goal tools and checks, with stand-in bots:
 *
 *   Calendar + email (source) → Brief writer → "All events in it" (rules
 *   check, no AI) → You
 *
 * The source starts a goal with today's events; the runner hands the work
 * to the writer; the check compares event ids with the calendar; the goal
 * shows passed with proof, or goes back to the writer with the fix list,
 * or — at the round limit — waits for you. Also: a record missing a
 * required field is refused, a paused bot is waited for, and a bot that
 * ends without a record is started once more, then left for you.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createGoalStore } = require("../goals/goalStore");
const { handleGoalTool } = require("../goals/goalTools");
const { createFlowStore } = require("./flowStore");
const { createFlowRunner } = require("./flowRunner");
const { starterProposal } = require("./starterFlows");
const { proposalToFlow } = require("./proposals");
const { runCheck } = require("../checks/checkRunner");
const { proveCriteria } = require("../goals/criteria");

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
let flows;
let flow;
let runner;
let botRuns;
let writerBehaviour;

const EVENTS = [
  { id: "e1", title: "Standup" },
  { id: "e2", title: "Dentist" },
];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-flow-run-"));
  goals = createGoalStore({ root: path.join(dir, "goals") });
  flows = createFlowStore({ root: path.join(dir, "flows") });
  const made = { source: "bot_src", writer: "bot_writer" };
  flow = flows.create({
    ...proposalToFlow(starterProposal("daily-brief"), made, "ws1"),
  }).flow;
  botRuns = [];
  writerBehaviour = "good";
  const ctx = (botId, botName, goal) => ({
    workspaceId: "ws1",
    botId,
    botName,
    goal,
    flows: {
      resolve: (q) => flows.resolve(q),
      proveCriteria: (list, f) => proveCriteria(list, f),
    },
  });
  // The stand-in writer: claims, then writes its record the way it's told.
  const runBot = async (botId, opts) => {
    botRuns.push({ botId, opts });
    if (botId !== "bot_writer") return { status: "completed" };
    if (writerBehaviour === "paused")
      return { skipped: true, reason: "paused" };
    const { taskId } = opts.goal;
    const c = ctx("bot_writer", "Brief writer", { ...opts.goal });
    handleGoalTool(goals, c, "claim_task", { taskId });
    if (writerBehaviour === "silent") return { status: "completed" };
    const ids = writerBehaviour === "misses" ? ["e1"] : ["e1", "e2"];
    const output =
      writerBehaviour === "noText"
        ? { eventIds: ids }
        : { text: "Standup at 9, dentist at 4.", eventIds: ids };
    const r = handleGoalTool(goals, c, "write_done", {
      taskId,
      status: "passed",
      summary: "Wrote the brief",
      output,
    });
    botRuns[botRuns.length - 1].result = r;
    return { status: "completed" };
  };
  runner = createFlowRunner({
    store: goals,
    runBot,
    runCheck: (check, input, c) => runCheck(check, input, c),
    checkContext: () => ({ fetchStatus: async () => 200 }),
  });
  // What the app wires: every ledger change runs a pass.
  runner.ctx = ctx;
});

afterEach(() => {
  runner.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The source bot starts today's goal, as its scheduled run would. */
function sourceStarts() {
  const c = runner.ctx("bot_src", "Calendar + email", {
    goalId: null,
    taskId: null,
  });
  const r = handleGoalTool(goals, c, "create_goal", {
    title: "Brief for today",
    output: { events: EVENTS, emails: [] },
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /follows the "Daily brief" flow/);
  return goals.listGoals({ workspaceId: "ws1" })[0];
}

const taskOf = (goal) => goals.getGoal(goal.id).tasks[0];
const stepName = (stepId) => flow.steps.find((s) => s.id === stepId).name;

async function drive(goal, until_) {
  for (let i = 0; i < 20; i++) {
    runner.pass();
    await until(() => false, 5);
    if (until_(taskOf(goal))) return taskOf(goal);
  }
  return taskOf(goal);
}

describe("UC6: the daily brief as a flow", () => {
  it("the source's goal follows its flow, with what it read as the first record", () => {
    const goal = sourceStarts();
    assert.equal(goal.flowId, flow.id);
    const task = goal.tasks[0];
    assert.equal(stepName(task.stepId), "Brief writer");
    assert.equal(task.history[0].output.events.length, 2);
  });

  it("writer → check passes with proof → waits for you → you mark it done", async () => {
    const goal = sourceStarts();
    const task = await drive(goal, (t) => t.status === "ready");
    assert.equal(task.status, "ready");
    assert.equal(stepName(task.stepId), "You");
    const check = task.history.find((r) => r.said === "dash");
    assert.equal(check.status, "passed");
    assert.equal(check.kind, "rules");
    assert.match(check.summary, /All 2 passed/);
    // The writer's own record stays "said by the bot".
    assert.equal(
      task.history.find((r) => r.botId === "bot_writer").said,
      "bot",
    );
    // The writer was told what it gets and what to fill.
    const prompt = botRuns.find((r) => r.botId === "bot_writer").opts.prompt;
    assert.match(prompt, /claim_task task_/);
    assert.match(prompt, /must fill: text \(text\), eventIds \(list\)/);
    assert.match(prompt, /"e2"/);
    const done = goals.userAction(task.id, "done");
    assert.equal(done.task.status, "done");
    assert.equal(goals.getGoal(goal.id).status, "done");
  });

  it("a missed event sends it back with the fix list, then stops at the round limit", async () => {
    writerBehaviour = "misses";
    const goal = sourceStarts();
    const task = await drive(goal, (t) => t.status === "needs-you");
    assert.equal(task.status, "needs-you");
    assert.equal(task.round, 3);
    const checks = task.history.filter((r) => r.said === "dash");
    assert.equal(checks.length, 3);
    assert.ok(checks.every((c) => c.status === "failed"));
    assert.deepEqual(checks[0].details[0].details, ["e2"]);
    assert.equal(checks[2].stopped, true);
    // Round 2's writer was told why it came back.
    const second = botRuns.filter((r) => r.botId === "bot_writer")[1].opts
      .prompt;
    assert.match(second, /It came back from "All events in it": 1 of 2 passed/);
    // One more round goes back to the writer.
    writerBehaviour = "good";
    const more = goals.userAction(task.id, "one-more-round");
    assert.equal(stepName(more.task.stepId), "Brief writer");
    const after = await drive(goal, (t) => t.status === "ready");
    assert.equal(after.status, "ready");
  });

  it("a record missing a required field is refused, and the task doesn't move", async () => {
    writerBehaviour = "noText";
    const goal = sourceStarts();
    runner.pass();
    await until(() => botRuns.some((r) => r.result), 50);
    const run = botRuns.find((r) => r.result);
    assert.equal(run.result.isError, true);
    assert.match(run.result.text, /missing text/);
    assert.equal(stepName(taskOf(goal).stepId), "Brief writer");
  });

  it("a paused bot is waited for, not failed", async () => {
    writerBehaviour = "paused";
    const goal = sourceStarts();
    runner.pass();
    await until(() => runner.waitingFor(taskOf(goal).id), 50);
    const t = taskOf(goal);
    assert.equal(t.status, "new");
    assert.deepEqual(runner.waitingFor(t.id).why, "paused");
    // Not retried at once.
    const runs = botRuns.length;
    runner.pass();
    await until(() => false, 5);
    assert.equal(botRuns.length, runs);
  });

  it("a bot that ends twice without a record leaves it for you", async () => {
    writerBehaviour = "silent";
    const goal = sourceStarts();
    const task = await drive(goal, (t) => t.status === "needs-you");
    assert.equal(task.status, "needs-you");
    assert.match(task.history.at(-1).summary, /without a done record/);
    assert.equal(botRuns.filter((r) => r.botId === "bot_writer").length, 2);
  });

  it("a goal keeps the flow it started with when the flow changes", async () => {
    const goal = sourceStarts();
    flows.update(flow.id, { ...flow, maxRounds: 5, name: "Morning brief v2" });
    assert.equal(goals.getGoal(goal.id).flow.name, "Daily brief");
    assert.equal(goals.getGoal(goal.id).flow.version, 1);
  });

  it("only the bot at the task's step may claim it", () => {
    const goal = sourceStarts();
    const r = handleGoalTool(
      goals,
      runner.ctx("bot_other", "Other", { goalId: null, taskId: null }),
      "claim_task",
      { taskId: goal.tasks[0].id },
    );
    assert.equal(r.isError, true);
    assert.match(r.text, /another bot works on it there/);
  });

  it("a ticket already in the flow isn't started twice", () => {
    const c = runner.ctx("bot_src", "Calendar + email", {
      goalId: null,
      taskId: null,
    });
    const args = { title: "T", source: { kind: "ticket", ref: "DASH-1" } };
    handleGoalTool(goals, c, "create_goal", args);
    const again = handleGoalTool(goals, c, "create_goal", args);
    assert.match(again.text, /Already in "Daily brief"/);
    assert.equal(goals.listGoals({ workspaceId: "ws1" }).length, 1);
  });
});

describe("two flows on one dashboard", () => {
  it("run their goals side by side", async () => {
    const other = flows.create({
      ...proposalToFlow(starterProposal("blank"), {}, "ws1"),
      name: "Second",
    }).flow;
    flows.update(other.id, {
      ...other,
      steps: other.steps.map((s) =>
        s.kind === "bot" ? { ...s, botId: "bot_writer2" } : s,
      ),
    });
    const second = goals.createGoal({
      workspaceId: "ws1",
      title: "Other work",
      flow: flows.get(other.id),
    });
    const brief = sourceStarts();
    runner.pass();
    await until(() => false, 10);
    assert.equal(
      taskOf(brief).status !== "new" ||
        botRuns.some((r) => r.botId === "bot_writer"),
      true,
    );
    assert.ok(botRuns.some((r) => r.botId === "bot_writer2"));
    assert.equal(goals.getGoal(second.goal.id).flowId, other.id);
  });
});
