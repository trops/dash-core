/**
 * teamQueue.test.js — one job at a time per team (DASH-81): a job made while
 * its team has one going waits, in order, and starts when that one ends.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createJobStore } = require("./jobStore");
const { createJobTracker, PICKUP_MS } = require("./jobTracker");

let dir;
let clock;
let timers;

function make() {
  return createJobTracker({
    store: createJobStore({ root: dir }),
    now: () => clock,
    setTimer: (fn, ms = 0) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.cleared = true;
    },
  });
}
// Timers due within `ms` run (settling is 2 s; a pickup check is a minute).
const tick = (ms = 2000, rounds = 5) => {
  for (let i = 0; i < rounds; i++) {
    const due = timers.filter((t) => !t.cleared && !t.ran && t.ms <= ms);
    if (!due.length) return;
    for (const t of due) {
      t.ran = true;
      t.fn();
    }
  }
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-queue-"));
  clock = Date.parse("2026-11-25T12:00:00Z");
  timers = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const done = (output) => ({ status: "completed", output });
const job = (t, title, queued, ws = "ws1") => {
  clock += 1000;
  return t.startJob({
    workspaceId: ws,
    leadId: "lead1",
    leadName: "Print Lead",
    title,
    startedBy: { kind: "task", label: "slack" },
    queued,
  });
};
// A job's whole chain: one bot runs and finishes.
const runAndEnd = (t, jobId) => {
  const running = t.get(jobId).steps.some((s) => s.status === "running");
  if (!running) t.startStep(jobId, { botId: "lead1", botName: "Print Lead" });
  t.endStep(jobId, { botId: "lead1", record: done("Made it.") });
  tick();
};

describe("a team's job queue", () => {
  it("a job made while the team has one going waits as queued, first in line", () => {
    const t = make();
    const a = job(t, "Spool holder", false);
    t.startStep(a.id, { botId: "lead1", botName: "Print Lead" });
    const b = job(t, "Cable clip", true);
    assert.equal(t.get(b.id).status, "queued");
    assert.deepEqual(t.queueInfo(b.id), {
      position: 1,
      waitingFor: { id: a.id, title: "Spool holder", status: "running" },
    });
    assert.equal(t.activeFor("ws1").id, a.id);
    assert.equal(t.queueInfo(a.id), null);
  });

  it("starts when the job before it ends, and its starter hears", async () => {
    const t = make();
    const a = job(t, "Spool holder", false);
    t.startStep(a.id, { botId: "lead1", botName: "Print Lead" });
    const b = job(t, "Cable clip", true);
    let started = null;
    t.waitForStart(b.id).then((v) => {
      started = v;
    });
    t.endStep(a.id, { botId: "lead1", record: done("Printed.") });
    tick();
    await Promise.resolve();
    assert.equal(t.get(a.id).status, "done");
    assert.equal(t.get(b.id).status, "running");
    assert.equal(started, true);
    assert.equal(t.queueInfo(b.id), null);
  });

  it("runs them in order: the second waits for the first queued one too", async () => {
    const t = make();
    const a = job(t, "A", false);
    t.startStep(a.id, { botId: "lead1", botName: "Print Lead" });
    const b = job(t, "B", true);
    const c = job(t, "C", true);
    assert.equal(t.queueInfo(c.id).position, 2);
    t.endStep(a.id, { botId: "lead1", record: done("ok") });
    tick();
    assert.equal(t.get(b.id).status, "running");
    assert.equal(t.get(c.id).status, "queued");
    assert.equal(t.queueInfo(c.id).position, 1);
    assert.equal(t.queueInfo(c.id).waitingFor.id, b.id);
    runAndEnd(t, b.id);
    assert.equal(t.get(c.id).status, "running");
  });

  it("another team's queue is its own", () => {
    const t = make();
    const a = job(t, "Print A", false, "ws1");
    t.startStep(a.id, { botId: "lead1", botName: "Print Lead" });
    job(t, "Print B", true, "ws1");
    assert.equal(t.activeFor("ws2"), null);
    assert.equal(t.queuedFor("ws2").length, 0);
    const w = job(t, "Shelf", false, "ws2");
    assert.equal(t.get(w.id).status, "running");
  });

  it("a job waiting on the user still holds the team, and the queue says so", () => {
    const t = make();
    const a = job(t, "A", false);
    t.waitStep(a.id, {
      botId: "drafter",
      botName: "Drafter",
      summary: "Drafter is paused.",
      waiting: "paused",
    });
    const b = job(t, "B", true);
    tick();
    assert.equal(t.get(b.id).status, "queued");
    assert.equal(t.queueInfo(b.id).waitingFor.status, "needs-you");
  });

  it("taken out of the queue (Stop job), it never starts and the next one moves up", async () => {
    const t = make();
    const a = job(t, "A", false);
    t.startStep(a.id, { botId: "lead1", botName: "Print Lead" });
    const b = job(t, "B", true);
    const c = job(t, "C", true);
    let started = null;
    t.waitForStart(b.id).then((v) => {
      started = v;
    });
    t.stopWaiting(b.id);
    await Promise.resolve();
    assert.equal(started, false);
    assert.equal(t.get(b.id).status, "stopped");
    assert.match(t.get(b.id).steps[0].summary, /out of the queue/);
    assert.equal(t.queueInfo(c.id).position, 1);
    runAndEnd(t, a.id);
    assert.equal(t.get(c.id).status, "running");
  });

  it("deleting a queued job: its starter hears it won't start", async () => {
    const t = make();
    const a = job(t, "A", false);
    t.startStep(a.id, { botId: "lead1", botName: "Print Lead" });
    const b = job(t, "B", true);
    let started = null;
    t.waitForStart(b.id).then((v) => {
      started = v;
    });
    t.remove(b.id);
    await Promise.resolve();
    assert.equal(started, false);
    assert.equal(t.get(b.id), null);
  });

  it("stopping the job that's going lets the next one start", () => {
    const t = make();
    const a = job(t, "A", false);
    t.startStep(a.id, { botId: "lead1", botName: "Print Lead" });
    const b = job(t, "B", true);
    // Stop job: the controller stops its run; the step ends stopped.
    t.endStep(a.id, { botId: "lead1", record: { status: "stopped" } });
    t.stopWaiting(a.id);
    tick();
    assert.equal(t.get(a.id).status, "stopped");
    assert.equal(t.get(b.id).status, "running");
  });

  it("a job let out that nothing starts is stopped after a minute, so it never holds the team", () => {
    const t = make();
    const a = job(t, "A", false);
    t.startStep(a.id, { botId: "lead1", botName: "Print Lead" });
    const b = job(t, "B", true);
    const c = job(t, "C", true);
    runAndEnd(t, a.id);
    assert.equal(t.get(b.id).status, "running");
    // Its minute passes (two rounds: B stops, then C's turn comes).
    tick(PICKUP_MS, 2);
    assert.equal(t.get(b.id).status, "stopped");
    assert.match(t.get(b.id).steps[0].summary, /nothing started it/);
    // …and the next one's turn comes.
    assert.equal(t.get(c.id).status, "running");
  });

  it("after a restart: a queued task keeps its place, other queued work is stopped, and the next one starts", () => {
    let t = make();
    const a = job(t, "A", false);
    t.startStep(a.id, { botId: "lead1", botName: "Print Lead" });
    const b = job(t, "B (task)", true);
    clock += 1000;
    const c = t.startJob({
      workspaceId: "ws1",
      leadId: null,
      leadName: "Ticket Bot",
      title: "From a trigger",
      startedBy: { kind: "trigger", label: "Ticket Bot" },
      queued: true,
    });
    // Dash closes and opens again.
    timers = [];
    t = make();
    t.interruptLeftovers();
    assert.equal(t.get(a.id).status, "stopped");
    assert.equal(t.get(c.id).status, "stopped");
    assert.match(t.get(c.id).steps[0].summary, /waited for its turn/);
    // The task's job is next, and starts.
    assert.equal(t.get(b.id).status, "running");
  });

  it("the queue is full at 20", () => {
    const t = make();
    const a = job(t, "A", false);
    t.startStep(a.id, { botId: "lead1", botName: "Print Lead" });
    for (let i = 0; i < 19; i++) job(t, `Q${i}`, true);
    assert.equal(t.queueFull("ws1"), false);
    job(t, "Q19", true);
    assert.equal(t.queueFull("ws1"), true);
  });

  it("waitForStart: a job that isn't queued may start at once; a missing one can't", async () => {
    const t = make();
    const a = job(t, "A", false);
    assert.equal(await t.waitForStart(a.id), true);
    assert.equal(await t.waitForStart("job_nope"), false);
  });
});
