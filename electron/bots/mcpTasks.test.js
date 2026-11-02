/**
 * mcpTasks.test.js — tasks via MCP (bot-teams TEAM-016): the passphrase is
 * compared loosely, 5 wrong tries lock, a task waits 10 minutes, and Dash
 * closing marks a running task as not finished.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createMcpTasks,
  normalizePassphrase,
  checkPassphrase,
  cleanFrom,
  TASK_EXPIRES_MS,
  LOCK_MS,
  taskNoteFor,
} = require("./mcpTasks");

function setup({ passphrase = "purple otter" } = {}) {
  const state = { tasks: null, lock: null, passphrase };
  let t = Date.parse("2026-11-01T09:14:00.000Z");
  let n = 0;
  const tasks = createMcpTasks({
    store: {
      loadTasks: () => state.tasks,
      saveTasks: (list) => {
        state.tasks = list;
      },
      getPassphrase: () => state.passphrase,
      getLock: () => state.lock,
      saveLock: (l) => {
        state.lock = l;
      },
    },
    now: () => t,
    newId: () => `task_${++n}`,
  });
  return {
    tasks,
    state,
    advance: (ms) => {
      t += ms;
    },
  };
}

const team = { id: 7, name: "Room Design", leadId: "lead_7" };

describe("the passphrase", () => {
  it("ignores case, punctuation and extra spaces (voice-to-text)", () => {
    assert.equal(normalizePassphrase("  Purple, Otter. "), "purple otter");
    const { tasks } = setup();
    assert.deepEqual(tasks.verify("Purple   otter!"), { ok: true });
  });

  it("needs 4 letters, and says when it's short", () => {
    assert.equal(checkPassphrase("cat").ok, false);
    // Refused, never cut: a cut phrase would never match the spoken one.
    assert.deepEqual(checkPassphrase("a ".repeat(101)), {
      ok: false,
      error: "Keep it under 200 characters.",
    });
    assert.deepEqual(checkPassphrase("otter"), { ok: true, short: true });
    assert.deepEqual(checkPassphrase("purple otter"), {
      ok: true,
      short: false,
    });
  });

  it("isn't set → says so", () => {
    const { tasks } = setup({ passphrase: null });
    assert.deepEqual(tasks.verify("anything"), { notSet: true });
  });

  it("5 wrong tries lock for 15 minutes, even the right one", () => {
    const { tasks, advance } = setup();
    for (let i = 1; i <= 4; i++) {
      assert.deepEqual(tasks.verify("blue whale"), {
        wrong: true,
        triesLeft: 5 - i,
      });
    }
    const fifth = tasks.verify("blue whale");
    assert.equal(fifth.triesLeft, 0);
    assert.ok(fifth.locked);
    assert.ok(tasks.verify("purple otter").locked);
    advance(LOCK_MS);
    assert.deepEqual(tasks.verify("purple otter"), { ok: true });
  });

  it("a right one resets the count; unlock clears a lock", () => {
    const { tasks } = setup();
    tasks.verify("x");
    tasks.verify("x");
    tasks.verify("purple otter");
    for (let i = 0; i < 4; i++) tasks.verify("x");
    assert.equal(tasks.lockedUntil(), null);
    tasks.verify("x");
    assert.ok(tasks.lockedUntil());
    tasks.unlock();
    assert.equal(tasks.lockedUntil(), null);
  });

  it("an empty one is wrong, not a match for an empty setting", () => {
    const { tasks } = setup();
    assert.equal(tasks.verify("").wrong, true);
  });
});

describe("tasks", () => {
  it("wait for the passphrase, then expire after 10 minutes", () => {
    const { tasks, advance } = setup();
    const task = tasks.create({
      task: "Design the guest bedroom, boho",
      team,
      from: "ha-bridge",
    });
    assert.equal(task.status, "waiting");
    assert.equal(task.teamName, "Room Design");
    assert.equal(task.from, "ha-bridge");
    advance(TASK_EXPIRES_MS);
    assert.equal(tasks.get(task.id).status, "expired");
  });

  it("run, finish and fail", () => {
    const { tasks } = setup();
    const a = tasks.create({ task: "a", team });
    const b = tasks.create({ task: "b", team });
    assert.equal(tasks.running(a.id).status, "running");
    assert.equal(tasks.done(a.id, { summary: "Done." }).summary, "Done.");
    assert.equal(tasks.failed(b.id, "Busy").error, "Busy");
    // A run that ran and failed keeps which run it was.
    const d = tasks.create({ task: "d", team });
    assert.equal(
      tasks.failed(d.id, "Stopped", { runAt: "2026-11-01T09:00:00.000Z" })
        .runAt,
      "2026-11-01T09:00:00.000Z",
    );
    assert.equal(tasks.get(a.id).needsYou, undefined);
    const c = tasks.create({ task: "c", team });
    assert.equal(
      tasks.done(c.id, { summary: "Part.", needsYou: "Designer is paused." })
        .needsYou,
      "Designer is paused.",
    );
    assert.deepEqual(
      tasks.list().map((t) => t.id),
      [c.id, d.id, b.id, a.id],
    );
  });

  it("Dash closing marks a running task as not finished", () => {
    const { tasks } = setup();
    const a = tasks.create({ task: "a", team });
    tasks.running(a.id);
    tasks.recover();
    assert.equal(tasks.get(a.id).status, "failed");
    assert.match(tasks.get(a.id).error, /Dash closed/);
  });

  it("lists by team, and keeps an agent's name short and plain", () => {
    const { tasks } = setup();
    tasks.create({ task: "a", team });
    tasks.create({ task: "b", team: { id: 8, name: "Home Projects" } });
    assert.equal(tasks.list({ teamId: 7 }).length, 1);
    assert.equal(cleanFrom("<b>ha-bridge</b>"), "bha-bridgeb");
    assert.equal(cleanFrom(""), null);
  });

  it("over 50, drops the oldest finished — never a waiting or running one", () => {
    const { tasks } = setup();
    const first = tasks.create({ task: "first", team });
    tasks.running(first.id);
    const second = tasks.create({ task: "second", team });
    tasks.failed(second.id, "x");
    for (let i = 0; i < 49; i++) tasks.create({ task: `t${i}`, team });
    assert.equal(tasks.get(first.id).status, "running");
    assert.equal(tasks.get(second.id), null);
  });

  it("never stores the passphrase in a task", () => {
    const { tasks, state } = setup();
    tasks.create({ task: "a", team });
    tasks.verify("purple otter");
    assert.doesNotMatch(JSON.stringify(state.tasks), /otter/);
    assert.doesNotMatch(JSON.stringify(state.lock), /otter/);
  });

  it("a bot that didn't run says what the user can do — or nothing when it's not theirs", () => {
    assert.equal(
      taskNoteFor("Designer", "this bot is paused"),
      "Designer is paused. Turn it on in this team's Bots view, then ask for the rest again.",
    );
    assert.match(
      taskNoteFor("Designer", "all bots are paused"),
      /^All bots are paused/,
    );
    assert.match(
      taskNoteFor("Designer", "this bot is over its budget"),
      /Raise it in Settings › Bots/,
    );
    assert.match(
      taskNoteFor("Designer", "this bot isn't in the active profile"),
      /Switch profiles/,
    );
    assert.equal(taskNoteFor("Designer", "a run is already in progress"), null);
    assert.equal(
      taskNoteFor(
        "Designer",
        "you've asked your bots as many times as one answer allows",
      ),
      null,
    );
  });
});
