/**
 * sendBack.test.js — the you step (polish batch): what you do there
 * (approve or send back, read it, something else), and Send back with a
 * reason, which runs the bot step before it again with that reason.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { normalizeFlow, sendBackTarget } = require("./flowModel");
const { createGoalStore } = require("../goals/goalStore");
const { buildInput } = require("../checks/stepInput");

const box = { seal: (s) => s, open: (s) => s };

function flowOf(you = {}) {
  return normalizeFlow({
    id: "flow_t1",
    steps: [
      { id: "step_w", kind: "bot", name: "Writer" },
      {
        id: "step_c",
        kind: "check",
        name: "Lint",
        check: { kind: "rules", rules: [] },
      },
      { id: "step_y", kind: "you", name: "You approve", ...you },
    ],
    edges: [
      { from: "step_w", to: "step_c", kind: "next" },
      { from: "step_c", to: "step_y", kind: "next" },
      { from: "step_c", to: "step_w", kind: "fail" },
    ],
  });
}

/** A goal on `flow` whose task is waiting at the you step. */
function waiting(flow) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-sendback-"));
  let t = 1000;
  const store = createGoalStore({ root, box, now: () => ++t });
  const { goal } = store.createGoal({
    workspaceId: "7",
    title: "A list",
    flow,
  });
  let task = store.listTasks({ goalId: goal.id })[0];
  task = store.writeStepRecord(task.id, { status: "passed" }).task;
  task = store.writeStepRecord(task.id, { status: "passed" }).task;
  return { root, store, goal, task };
}

describe("the you step's mode", () => {
  it("defaults to approve; an old step that named its own action is custom", () => {
    assert.equal(flowOf().steps[2].mode, "approve");
    assert.equal(flowOf().steps[2].action, "Approve");
    const old = flowOf({ action: "Merge the PR" }).steps[2];
    assert.equal(old.mode, "custom");
    assert.equal(old.action, "Merge the PR");
    assert.equal(flowOf({ mode: "read" }).steps[2].action, "Read it");
  });

  it("sends back to the nearest bot step before it, or the one it names", () => {
    assert.equal(sendBackTarget(flowOf(), "step_y").id, "step_w");
    const named = flowOf({ sendBackTo: "step_c" });
    // A check can't be sent back to: the nearest bot instead.
    assert.equal(sendBackTarget(named, "step_y").id, "step_w");
  });
});

describe("review fixes", () => {
  it('reads "Approve…" as approve and "Read…" as read', () => {
    assert.equal(
      flowOf({ action: "Approve the send" }).steps[2].mode,
      "approve",
    );
    assert.equal(flowOf({ action: "Read it" }).steps[2].mode, "read");
  });

  it("never sends back to a source step", () => {
    const flow = normalizeFlow({
      steps: [
        { id: "step_s", kind: "source", name: "Reader" },
        { id: "step_y", kind: "you", name: "You", sendBackTo: "step_s" },
      ],
      edges: [{ from: "step_s", to: "step_y", kind: "next" }],
    });
    assert.equal(sendBackTarget(flow, "step_y"), null);
  });

  it("a step you only mark done can't be sent back", () => {
    const { root, store, task } = waiting(flowOf({ mode: "read" }));
    const r = store.userAction(task.id, { type: "send-back", reason: "No" });
    assert.match(r.error, /marked done/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("Send back", () => {
  it("needs a reason", () => {
    const { root, store, task } = waiting(flowOf());
    assert.equal(task.status, "ready");
    const r = store.userAction(task.id, { type: "send-back", reason: "  " });
    assert.match(r.error, /Say why/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs the bot step again, next round, with your reason as the fix", () => {
    const flow = flowOf();
    const { root, store, goal, task } = waiting(flow);
    const r = store.userAction(task.id, {
      type: "send-back",
      reason: "Group it by store section.",
    });
    assert.equal(r.task.stepId, "step_w");
    assert.equal(r.task.status, "new");
    assert.equal(r.task.round, 2);
    const last = r.task.history[r.task.history.length - 1];
    assert.equal(last.by, "you");
    assert.equal(last.status, "send-back");
    assert.equal(last.summary, "Group it by store section.");
    const input = buildInput({
      goal: store.getGoal(goal.id),
      task: r.task,
      flow,
      stepId: "step_w",
    });
    assert.equal(input.fix.reason, "Group it by store section.");
    assert.equal(input.fix.byYou, true);
    assert.equal(input.fix.step, "You approve");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("only works on something waiting for you", () => {
    const flow = flowOf();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-sendback-"));
    const store = createGoalStore({ root, box });
    const { goal } = store.createGoal({ workspaceId: "7", title: "x", flow });
    const task = store.listTasks({ goalId: goal.id })[0];
    const r = store.userAction(task.id, { type: "send-back", reason: "No" });
    assert.match(r.error, /waiting for you/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
