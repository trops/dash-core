/**
 * goalTools — the goals ledger as bot tools (goals-ledger PRD).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { tempDir } = require("../testUtils/tempDir");
const { createGoalStore } = require("./goalStore");
const { GOAL_TOOLS, handleGoalTool } = require("./goalTools");

function setup() {
  const store = createGoalStore({ root: tempDir("dash-goaltools-") });
  const ctx = (botId, extra = {}) => ({
    workspaceId: "7",
    botId,
    botName: botId,
    goal: { goalId: null, taskId: null },
    ...extra,
  });
  return { store, ctx };
}

const idIn = (text, prefix) =>
  (text.match(new RegExp(`${prefix}_[a-z0-9]+`)) || [])[0];

describe("goal tools", () => {
  it("declares six tools with input schemas", () => {
    assert.deepEqual(
      GOAL_TOOLS.map((t) => t.name),
      [
        "create_goal",
        "add_task",
        "list_tasks",
        "read_task",
        "claim_task",
        "write_done",
      ],
    );
    for (const t of GOAL_TOOLS) assert.equal(t.inputSchema.type, "object");
  });

  it("a bot on no dashboard has no ledger", () => {
    const { store, ctx } = setup();
    const r = handleGoalTool(
      store,
      ctx("a", { workspaceId: null }),
      "list_tasks",
      {},
    );
    assert.equal(r.isError, true);
    assert.match(r.text, /belong to a dashboard/);
  });

  it("walks a task from new to ready across three bots", () => {
    const { store, ctx } = setup();
    const reader = ctx("reader", { conversationId: "plan_9" });
    let r = handleGoalTool(store, reader, "create_goal", {
      title: "Ship DASH-123",
      source: { kind: "ticket", label: "DASH-123" },
    });
    const goalId = idIn(r.text, "goal");
    assert.ok(goalId);
    assert.equal(reader.goal.goalId, goalId);
    assert.equal(store.getGoal(goalId).conversationId, "plan_9");
    r = handleGoalTool(store, reader, "add_task", { goalId, title: "Build" });
    const taskId = idIn(r.text, "task");

    const builder = ctx("builder");
    r = handleGoalTool(store, builder, "list_tasks", { status: "new" });
    assert.match(r.text, new RegExp(taskId));
    r = handleGoalTool(store, builder, "claim_task", { taskId });
    assert.equal(r.isError, false);
    assert.deepEqual(builder.goal, { goalId, taskId });
    r = handleGoalTool(store, builder, "write_done", {
      taskId,
      status: "passed",
      summary: "PR opened",
      evidence: [{ label: "PR", value: "https://example.com/pr/1" }],
    });
    assert.match(r.text, /now 'built'/);

    const checker = ctx("checker");
    assert.equal(
      handleGoalTool(store, checker, "claim_task", { taskId }).isError,
      false,
    );
    r = handleGoalTool(store, checker, "write_done", {
      taskId,
      status: "failed",
      summary: "Tests are missing",
    });
    assert.match(r.text, /round 2 of 3/);
    r = handleGoalTool(store, checker, "read_task", { taskId });
    assert.match(r.text, /Tests are missing/);
    assert.match(r.text, /PR: https:\/\/example\.com\/pr\/1/);
  });

  it("only sees its own dashboard's goals", () => {
    const { store, ctx } = setup();
    const { goal } = store.createGoal({ workspaceId: "8", title: "Other" });
    const { task } = store.addTask(goal.id, { title: "T" });
    const me = ctx("a");
    assert.equal(
      handleGoalTool(store, me, "read_task", { taskId: task.id }).isError,
      true,
    );
    assert.equal(
      handleGoalTool(store, me, "claim_task", { taskId: task.id }).isError,
      true,
    );
    assert.equal(
      handleGoalTool(store, me, "add_task", { goalId: goal.id, title: "x" })
        .isError,
      true,
    );
    assert.match(handleGoalTool(store, me, "list_tasks", {}).text, /No tasks/);
  });

  it("can't write a done record for a task it didn't claim", () => {
    const { store, ctx } = setup();
    const { goal } = store.createGoal({ workspaceId: "7", title: "G" });
    const { task } = store.addTask(goal.id, { title: "T" });
    const r = handleGoalTool(store, ctx("a"), "write_done", {
      taskId: task.id,
      status: "passed",
      summary: "done",
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /Claim the task/);
  });
});
