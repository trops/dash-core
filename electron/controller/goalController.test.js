/**
 * goalController — the goals ledger's main-process side (goals-ledger PRD):
 * deleting a goal removes its runs too, a deleted dashboard's goals go, and
 * a goal a bot is working on is kept.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { tempDir } = require("../testUtils/tempDir");
const goalController = require("./goalController");

function setup() {
  goalController.init({ dataDir: tempDir("dash-goalctl-") });
  const removed = [];
  const forgot = [];
  goalController.useRuns({
    runsFor: (goalId) => [{ goalId, botId: "b", status: "completed" }],
    removeRuns: (goalId) => {
      removed.push(goalId);
      return 1;
    },
    forget: (goalId) => forgot.push(goalId),
  });
  const store = goalController.store();
  return { store, removed, forgot };
}

describe("goalController", () => {
  it("lists a dashboard's goals and opens one with its runs", () => {
    const { store } = setup();
    const { goal } = store.createGoal({ workspaceId: "7", title: "G" });
    assert.equal(goalController.list("7").length, 1);
    assert.deepEqual(goalController.list(null), []);
    assert.equal(goalController.get(goal.id).runs.length, 1);
  });

  it("deleting a goal removes its runs; a busy one is kept", () => {
    const { store, removed } = setup();
    const a = store.createGoal({ workspaceId: "7", title: "A" }).goal;
    const b = store.createGoal({ workspaceId: "7", title: "B" }).goal;
    const { task } = store.addTask(b.id, { title: "T" });
    store.claimTask(task.id, { botId: "bot_1" });
    const r = goalController.delete([a.id, b.id]);
    assert.deepEqual(r.deleted, [a.id]);
    assert.equal(r.kept[0].goalId, b.id);
    assert.deepEqual(removed, [a.id]);
  });

  it("runs still going forget a deleted goal before its runs are removed", () => {
    const { store, removed, forgot } = setup();
    const a = store.createGoal({ workspaceId: "7", title: "A" }).goal;
    goalController.delete([a.id]);
    assert.deepEqual(forgot, [a.id]);
    assert.deepEqual(removed, [a.id]);
    goalController.forgetWorkspace("7");
  });

  it("a deleted dashboard's goals go, with their runs", () => {
    const { store, removed } = setup();
    const a = store.createGoal({ workspaceId: "7", title: "A" }).goal;
    store.createGoal({ workspaceId: "8", title: "B" });
    assert.deepEqual(goalController.forgetWorkspace("7"), [a.id]);
    assert.deepEqual(removed, [a.id]);
    assert.equal(goalController.list("8").length, 1);
  });

  it("the user's moves come back as ok or an error", () => {
    const { store } = setup();
    const { goal } = store.createGoal({ workspaceId: "7", title: "G" });
    const { task } = store.addTask(goal.id, { title: "T" });
    assert.match(goalController.taskAction(task.id, "done").error, /ready/);
    assert.equal(goalController.taskAction(task.id, "close").ok, true);
    assert.equal(goalController.close(goal.id).ok, true);
  });
});

describe("old flow jobs (DASH-13)", () => {
  it("are deleted at startup; a bot's checks jobs and plain goals stay", () => {
    const { store } = setup();
    const { checksFlow } = require("../bots/botChecks");
    const flowController = require("./flowController");
    const old = store.createGoal({
      workspaceId: "7",
      title: "Old flow job",
      flow: {
        id: "flow_1",
        name: "Old",
        steps: [{ id: "step_a", kind: "bot", name: "A", botId: "b" }],
        edges: [],
      },
    }).goal;
    const checks = store.createGoal({
      workspaceId: "7",
      title: "Writer: its run",
      flow: checksFlow({
        id: "b",
        name: "Writer",
        workspaceId: "7",
        checks: {
          steps: [
            {
              id: "step_c1",
              kind: "check",
              name: "Has a title",
              check: { kind: "rules", rules: [] },
            },
          ],
        },
      }),
    }).goal;
    const plain = store.createGoal({ workspaceId: "7", title: "Plain" }).goal;
    assert.ok(old && checks && plain);
    const dropped = flowController.dropOldFlowJobs();
    assert.deepEqual(dropped, [old.id]);
    const left = goalController
      .list("7")
      .map((g) => g.id)
      .sort();
    assert.deepEqual(left, [checks.id, plain.id].sort());
  });
});
