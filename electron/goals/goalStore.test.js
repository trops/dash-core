/**
 * goalStore — the goals ledger on disk (goals-ledger PRD).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tempDir } = require("../testUtils/tempDir");
const { createGoalStore } = require("./goalStore");

// A keychain stand-in: sealed text is reversible and recognisable.
const box = {
  seal: (s) => `sealed:${Buffer.from(s).toString("base64")}`,
  open: (s) =>
    s.startsWith("sealed:")
      ? Buffer.from(s.slice(7), "base64").toString()
      : null,
};

function fresh(opts = {}) {
  const root = tempDir("dash-goals-");
  let t = 1000;
  const store = createGoalStore({ root, box, now: () => ++t, ...opts });
  return { root, store };
}

function goalWithTask(store, ws = "7") {
  const { goal } = store.createGoal({ workspaceId: ws, title: "Ship it" });
  const { task } = store.addTask(goal.id, { title: "Build it" });
  return { goal, task };
}

describe("goals on disk", () => {
  it("a goal is a folder with its record, tasks, evidence and work", () => {
    const { root, store } = fresh();
    const { goal, task } = goalWithTask(store);
    const dir = path.join(root, goal.id);
    assert.ok(fs.existsSync(path.join(dir, "goal.json")));
    assert.ok(fs.existsSync(path.join(dir, "tasks", `${task.id}.json`)));
    assert.ok(fs.existsSync(path.join(dir, "evidence")));
    assert.ok(fs.existsSync(path.join(dir, "work")));
  });

  it("records are sealed at rest", () => {
    const { root, store } = fresh();
    const { goal } = goalWithTask(store);
    const raw = fs.readFileSync(path.join(root, goal.id, "goal.json"), "utf8");
    assert.doesNotMatch(raw, /Ship it/);
    assert.match(JSON.parse(raw).sealed, /^sealed:/);
  });

  it("survives a reload (a restart)", () => {
    const { root, store } = fresh();
    const { goal, task } = goalWithTask(store);
    store.claimTask(task.id, { botId: "b1" });
    store.writeDone(task.id, { botId: "b1", status: "passed", summary: "ok" });
    const again = createGoalStore({ root, box });
    const loaded = again.getGoal(goal.id);
    assert.equal(loaded.title, "Ship it");
    assert.equal(loaded.tasks[0].status, "built");
    assert.equal(loaded.tasks[0].history[0].summary, "ok");
  });

  it("a task held when the app stopped is let go on load (no run survives)", () => {
    const { root, store } = fresh();
    const { goal, task } = goalWithTask(store);
    store.claimTask(task.id, { botId: "b1" });
    const again = createGoalStore({ root, box });
    const t = again.getTask(task.id);
    assert.equal(t.holder, null);
    assert.equal(t.status, "new");
    assert.ok(again.claimTask(task.id, { botId: "b2" }).task);
    // …and it can be deleted.
    again.release("b2");
    assert.equal(again.deleteGoal(goal.id).ok, true);
  });

  it("a folder left without goal.json (a deleted goal) is removed on load", () => {
    const { root } = fresh();
    const ghost = path.join(root, "goal_abcdef123", "work");
    fs.mkdirSync(ghost, { recursive: true });
    createGoalStore({ root, box });
    assert.equal(fs.existsSync(path.join(root, "goal_abcdef123")), false);
  });

  it("every change names its dashboard", () => {
    const seen = [];
    const { store } = fresh({ onChange: (c) => seen.push(c) });
    const { task } = goalWithTask(store, "7");
    store.claimTask(task.id, { botId: "a" });
    assert.ok(seen.length >= 3);
    for (const c of seen) assert.equal(c.workspaceId, "7");
  });

  it("a goal sealed by another keychain is kept, not overwritten", () => {
    const { root, store } = fresh();
    const { goal } = goalWithTask(store);
    const locked = createGoalStore({ root, box: { ...box, open: () => null } });
    assert.equal(locked.getGoal(goal.id), null);
    assert.ok(fs.existsSync(path.join(root, goal.id, "goal.json")));
  });

  it("refuses a goal with no title or no dashboard", () => {
    const { store } = fresh();
    assert.ok(store.createGoal({ workspaceId: "7" }).error);
    assert.ok(store.createGoal({ title: "x" }).error);
  });
});

describe("claiming", () => {
  it("two bots can't hold the same task", () => {
    const { store } = fresh();
    const { task } = goalWithTask(store);
    assert.ok(store.claimTask(task.id, { botId: "a" }).task);
    assert.match(store.claimTask(task.id, { botId: "b" }).error, /Another bot/);
    // The holder may claim it again.
    assert.ok(store.claimTask(task.id, { botId: "a" }).task);
  });

  it("a task on another dashboard can't be claimed", () => {
    const { store } = fresh();
    const { task } = goalWithTask(store, "7");
    assert.match(
      store.claimTask(task.id, { botId: "a", workspaceId: "8" }).error,
      /another dashboard/,
    );
  });

  it("a run that ends without a done record lets its task go", () => {
    const { store } = fresh();
    const { task } = goalWithTask(store);
    store.claimTask(task.id, { botId: "a" });
    assert.deepEqual(store.release("a"), [task.id]);
    const t = store.getTask(task.id);
    assert.equal(t.status, "new");
    assert.equal(t.holder, null);
    assert.ok(store.claimTask(task.id, { botId: "b" }).task);
  });
});

describe("done records", () => {
  it("moves the task on and keeps the record with its evidence", () => {
    const { store } = fresh();
    const { task } = goalWithTask(store);
    store.claimTask(task.id, { botId: "a" });
    const r = store.writeDone(task.id, {
      botId: "a",
      botName: "Builder",
      status: "passed",
      summary: "Opened the PR",
      evidence: [{ label: "PR", value: "https://example.com/pr/1" }, "exit 0"],
    });
    assert.equal(r.task.status, "built");
    assert.equal(r.task.holder, null);
    assert.equal(r.record.said, "bot");
    assert.deepEqual(r.record.evidence, [
      { label: "PR", value: "https://example.com/pr/1" },
      { label: "", value: "exit 0" },
    ]);
  });

  it("needs the task claimed by the bot writing it", () => {
    const { store } = fresh();
    const { task } = goalWithTask(store);
    assert.match(
      store.writeDone(task.id, { botId: "a", status: "passed" }).error,
      /Claim the task/,
    );
  });

  it("the next bot picks up by status (a missed event loses nothing)", () => {
    const { store } = fresh();
    const { task } = goalWithTask(store);
    store.claimTask(task.id, { botId: "builder" });
    store.writeDone(task.id, { botId: "builder", status: "passed" });
    const waiting = store.listTasks({ workspaceId: "7", status: "built" });
    assert.deepEqual(
      waiting.map((t) => t.id),
      [task.id],
    );
    assert.ok(store.claimTask(task.id, { botId: "checker" }).task);
  });

  it("fails go round, then stop for the user", () => {
    const { store } = fresh();
    const { goal } = store.createGoal({ workspaceId: "7", title: "G" });
    const { task } = store.addTask(goal.id, { title: "T", maxRounds: 2 });
    store.claimTask(task.id, { botId: "a" });
    let r = store.writeDone(task.id, { botId: "a", status: "failed" });
    assert.equal(r.task.status, "new");
    assert.equal(r.task.round, 2);
    store.claimTask(task.id, { botId: "a" });
    r = store.writeDone(task.id, { botId: "a", status: "failed" });
    assert.equal(r.task.status, "needs-you");
    assert.equal(r.record.stopped, true);
    assert.equal(store.getGoal(goal.id).status, "needs-you");
  });

  it("keeps at most 50 records per task", () => {
    const { store } = fresh();
    const { goal } = store.createGoal({ workspaceId: "7", title: "G" });
    const { task } = store.addTask(goal.id, { title: "T", maxRounds: 10 });
    for (let i = 0; i < 60; i++) {
      store.claimTask(task.id, { botId: "a" });
      store.writeDone(task.id, { botId: "a", status: "needs-you" });
      store.userAction(task.id, "one-more-round");
    }
    assert.equal(store.getTask(task.id).history.length, 50);
  });
});

describe("the user's moves", () => {
  it("done, one more round and close", () => {
    const { store } = fresh();
    const { task } = goalWithTask(store);
    store.claimTask(task.id, { botId: "a" });
    store.writeDone(task.id, { botId: "a", status: "needs-you" });
    assert.equal(
      store.userAction(task.id, "one-more-round").task.status,
      "new",
    );
    assert.equal(store.userAction(task.id, "close").task.status, "closed");
    assert.ok(store.userAction(task.id, "done").error);
  });

  it("a closed goal's tasks can't be restarted (nothing would pick them up)", () => {
    const { store } = fresh();
    const { goal, task } = goalWithTask(store);
    store.claimTask(task.id, { botId: "a" });
    store.writeDone(task.id, { botId: "a", status: "needs-you" });
    store.closeGoal(goal.id);
    assert.match(store.userAction(task.id, "one-more-round").error, /closed/);
  });
});

describe("deleting", () => {
  it("removes the goal's folder", () => {
    const { root, store } = fresh();
    const { goal } = goalWithTask(store);
    fs.writeFileSync(path.join(root, goal.id, "work", "draft.md"), "hi");
    assert.deepEqual(store.deleteGoal(goal.id), { ok: true, goalId: goal.id });
    assert.equal(fs.existsSync(path.join(root, goal.id)), false);
    assert.equal(store.getGoal(goal.id), null);
  });

  it("refuses while a bot holds one of its tasks", () => {
    const { store } = fresh();
    const { goal, task } = goalWithTask(store);
    store.claimTask(task.id, { botId: "a" });
    assert.match(store.deleteGoal(goal.id).error, /still working/);
  });

  it("refuses an id that isn't a goal (no path tricks)", () => {
    const { store } = fresh();
    assert.ok(store.deleteGoal("../x").error);
    assert.equal(store.paths("../x"), null);
  });

  it("finds a conversation's goals, and a dashboard's go with it", () => {
    const { store } = fresh();
    const a = store.createGoal({
      workspaceId: "7",
      title: "A",
      conversationId: "plan_1",
    }).goal;
    store.createGoal({ workspaceId: "8", title: "B" });
    assert.deepEqual(
      store.goalsForConversation("plan_1").map((g) => g.id),
      [a.id],
    );
    assert.deepEqual(store.deleteForWorkspace("7"), [a.id]);
    assert.equal(store.listGoals().length, 1);
  });
});
