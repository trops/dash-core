/**
 * jobTracker.test.js — a job follows one chain of work through a lead
 * (DASH-28, DASH-31): lead → asked bot → its checks → hand-ons, done only
 * when none is still going. Jobs are kept on disk and never deleted by
 * themselves.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createJobStore } = require("./jobStore");
const { createJobTracker, jobStatus } = require("./jobTracker");

let dir;
let clock;
let timers;
let changes;

function make() {
  const store = createJobStore({ root: dir });
  return createJobTracker({
    store,
    now: () => clock,
    onChange: (j) => changes.push(j.status),
    setTimer: (fn) => {
      const t = { fn };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.cleared = true;
    },
  });
}
// The settle moment passes.
const settle = () => {
  for (const t of timers.splice(0)) if (!t.cleared) t.fn();
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-jobs-"));
  clock = Date.parse("2026-11-21T11:38:00Z");
  timers = [];
  changes = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const done = (output) => ({ status: "completed", output });

describe("a job through the lead", () => {
  it("lead → Designer → hand-on Drafter: running until the Drafter is done", async () => {
    const t = make();
    const job = t.startJob({
      workspaceId: "ws1",
      leadId: "lead1",
      leadName: "Woodworking Lead",
      title: "Walnut U desk, 60 inches wide",
      startedBy: { kind: "task", label: "Slack", taskId: "task_1" },
    });
    assert.equal(job.status, "running");
    const ended = t.waitForEnd(job.id);

    t.startStep(job.id, {
      botId: "lead1",
      botName: "Woodworking Lead",
      why: { kind: "task" },
    });
    t.startStep(job.id, {
      botId: "des",
      botName: "Designer",
      why: { kind: "asked", by: "Woodworking Lead" },
    });
    t.endStep(job.id, { botId: "lead1", record: done("Asked the Designer.") });
    t.endStep(job.id, { botId: "des", record: done("Designed it.") });
    // The Drafter's hand-on starts a tick later: still running meanwhile.
    assert.equal(t.get(job.id).status, "running");
    t.startStep(job.id, {
      botId: "dra",
      botName: "Drafter",
      why: { kind: "handon", by: "Designer" },
    });
    settle(); // the earlier settle timers were cleared by the new step
    assert.equal(t.get(job.id).status, "running");
    t.endStep(job.id, { botId: "dra", record: done("Drawn: 3 sheets.") });
    assert.equal(t.get(job.id).status, "running");
    settle();
    const final = await ended;
    assert.equal(final.status, "done");
    assert.deepEqual(
      final.steps.map((s) => [s.botName, s.status]),
      [
        ["Woodworking Lead", "done"],
        ["Designer", "done"],
        ["Drafter", "done"],
      ],
    );
    assert.equal(final.steps[2].summary, "Drawn: 3 sheets.");
    assert.ok(final.endedAt);
  });

  it("checks are a stage of the step; a retry joins the same job", () => {
    const t = make();
    const job = t.startJob({ leadId: "lead1", title: "Brief" });
    t.startStep(job.id, { botId: "w", botName: "Writer" });
    t.endStep(job.id, {
      botId: "w",
      record: done("Draft"),
      checking: { goalId: "goal_1" },
    });
    settle();
    assert.equal(t.get(job.id).status, "running");
    assert.equal(t.get(job.id).steps[0].status, "checking");
    assert.equal(t.jobForGoal("goal_1"), job.id);
    t.checksMoved("goal_1", "passed");
    assert.equal(t.get(job.id).status, "running");
    settle();
    assert.equal(t.get(job.id).status, "done");
  });

  it("a step that passed its checks stays done when the reviewer's run ends after", () => {
    const t = make();
    const job = t.startJob({ leadId: null, title: "Ticket" });
    t.startStep(job.id, { botId: "c", botName: "Coder" });
    t.endStep(job.id, {
      botId: "c",
      record: done("Coded"),
      checking: { goalId: "goal_r" },
    });
    t.checksMoved("goal_r", "passed");
    // The reviewer's run is marked "review" when it ends, after the pass.
    t.checksMoved("goal_r", "review");
    settle();
    assert.equal(t.get(job.id).steps[0].status, "done");
    assert.equal(t.get(job.id).status, "done");
  });

  it("a hand-on waiting on a paused bot: needs you, then running once it's on", () => {
    const t = make();
    const job = t.startJob({ leadId: "lead1", title: "Spool shelf" });
    t.startStep(job.id, { botId: "des", botName: "Designer" });
    t.endStep(job.id, { botId: "des", record: done("Designed.") });
    t.waitStep(job.id, {
      botId: "dra",
      botName: "Drafter",
      summary: "Drafter is paused, so it hasn't started.",
    });
    settle();
    assert.equal(t.get(job.id).status, "needs-you");
    t.startStep(job.id, { botId: "dra", botName: "Drafter" });
    const steps = t.get(job.id).steps;
    assert.equal(steps.length, 2, "the waiting step became the run");
    assert.equal(steps[1].status, "running");
    assert.equal(t.get(job.id).status, "running");
  });

  it("a failed step fails the job once nothing else is going", () => {
    const t = make();
    const job = t.startJob({ leadId: "lead1" });
    t.startStep(job.id, { botId: "a", botName: "Inbox Reader" });
    t.endStep(job.id, {
      botId: "a",
      record: { status: "failed", error: "Gmail sign-in expired." },
    });
    settle();
    const j = t.get(job.id);
    assert.equal(j.status, "failed");
    assert.equal(j.steps[0].summary, "Gmail sign-in expired.");
  });

  it("kept on disk; after a restart, what was going is stopped and said so", () => {
    const t = make();
    const job = t.startJob({ leadId: "lead1", title: "Long one" });
    t.startStep(job.id, { botId: "a", botName: "A" });
    const again = make();
    again.interruptLeftovers();
    const j = again.get(job.id);
    assert.equal(j.status, "stopped");
    assert.match(j.steps[0].summary, /Dash closed/);
    // Only the user deletes a job.
    assert.equal(again.list().length, 1);
    assert.equal(again.remove(job.id), true);
    assert.equal(make().list().length, 0);
  });

  it("lists by dashboard, newest change first", () => {
    const t = make();
    const a = t.startJob({ workspaceId: "1", leadId: "l" });
    clock += 1000;
    const b = t.startJob({ workspaceId: "2", leadId: "l" });
    clock += 1000;
    t.startStep(a.id, { botId: "x", botName: "X" });
    assert.deepEqual(
      t.list().map((j) => j.id),
      [a.id, b.id],
    );
    assert.deepEqual(
      t.list({ workspaceId: "2" }).map((j) => j.id),
      [b.id],
    );
  });
});

describe("after the review", () => {
  it("a hand-on whose event was replaced, or whose bot was deleted, is skipped so its job ends", () => {
    const t = make();
    const job = t.startJob({ leadId: "l", title: "A" });
    t.startStep(job.id, { botId: "des", botName: "Designer" });
    t.endStep(job.id, { botId: "des", record: done("ok") });
    t.waitStep(job.id, { botId: "dra", botName: "Drafter", summary: "paused" });
    settle();
    assert.equal(t.get(job.id).status, "needs-you");
    t.releaseWaiting("dra", "Drafter ran a newer event instead of this one.");
    settle();
    const j = t.get(job.id);
    assert.equal(j.steps[1].status, "skipped");
    assert.equal(j.status, "done");
  });

  it("Stop job stops hand-ons that haven't started", () => {
    const t = make();
    const job = t.startJob({ leadId: "l" });
    t.startStep(job.id, { botId: "a", botName: "A" });
    t.endStep(job.id, { botId: "a", record: done("ok") });
    t.waitStep(job.id, { botId: "b", botName: "B", summary: "paused" });
    t.stopWaiting(job.id);
    settle();
    assert.equal(t.get(job.id).status, "stopped");
  });

  it("deleting a job tells whoever waits for it that it stopped", async () => {
    const t = make();
    const job = t.startJob({ leadId: "l" });
    t.startStep(job.id, { botId: "a", botName: "A" });
    const ended = t.waitForEnd(job.id);
    t.remove(job.id);
    assert.equal((await ended).status, "stopped");
  });

  it("a task's job whose lead never started stops after a restart", () => {
    const t = make();
    const job = t.startJob({ leadId: "l", leadName: "Lead" });
    make().interruptLeftovers();
    const j = make().get(job.id);
    assert.equal(j.status, "stopped");
    assert.match(j.steps[0].summary, /before it started/);
  });

  it("checks waiting on the user make the job need you; the goal index finds it", () => {
    const t = make();
    const job = t.startJob({ leadId: "l" });
    t.startStep(job.id, { botId: "w", botName: "Writer" });
    t.endStep(job.id, {
      botId: "w",
      record: done("x"),
      checking: { goalId: "goal_9" },
    });
    // A fresh tracker builds its index from disk.
    const again = make();
    assert.equal(again.jobForGoal("goal_9"), job.id);
    again.checksMoved("goal_9", "needs-you");
    assert.equal(again.get(job.id).status, "needs-you");
    assert.equal(again.isOpen(job.id), true);
  });
});

describe("jobStatus", () => {
  it("needs you wins; nothing run at all is stopped", () => {
    assert.equal(jobStatus([]), "running");
    assert.equal(
      jobStatus([{ status: "running" }, { status: "needs-you" }]),
      "needs-you",
    );
    assert.equal(jobStatus([{ status: "done" }], true), "running");
    assert.equal(
      jobStatus([{ status: "done" }, { status: "skipped" }]),
      "done",
    );
    assert.equal(jobStatus([{ status: "skipped" }]), "stopped");
  });
});

describe("a refused run on its job (DASH-115)", () => {
  it("the failed step keeps what was refused, why and the fix; a test's own block doesn't", () => {
    const t = make();
    const job = t.startJob({ workspaceId: "ws1", leadId: "l", title: "PR" });
    t.startStep(job.id, { botId: "pr", botName: "PR Bot" });
    const refusal = {
      kind: "command",
      what: "git push -u origin feat/x",
      why: "it isn't in the bot's allowed commands",
      fix: "Add it on the bot's Commands, or give it a provider tool that does this.",
      section: "commands",
      message: "PR Bot can't run `git push -u origin feat/x`: …",
    };
    t.endStep(job.id, {
      botId: "pr",
      record: {
        status: "failed",
        error: refusal.message,
        refusals: [{ ...refusal, what: "ls", test: true }, refusal],
      },
    });
    const step = t.get(job.id).steps[0];
    assert.equal(step.status, "failed");
    assert.deepEqual(step.refusal, refusal);
    t.startStep(job.id, { botId: "pr2", botName: "Other" });
    t.endStep(job.id, {
      botId: "pr2",
      record: { status: "completed", refusals: [{ ...refusal, test: true }] },
    });
    assert.equal(t.get(job.id).steps[1].refusal, undefined);
  });
});
