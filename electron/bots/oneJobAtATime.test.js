/**
 * oneJobAtATime.test.js — a team runs one job at a time (DASH-81), however
 * the job starts: a task given via MCP or a trigger waits its turn, a
 * schedule's run is skipped, and what the user does in Dash isn't held.
 * The real botController with a real job tracker; Electron stubbed like
 * busyHandOn.test.js.
 */
"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-onejob-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_onejob__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_onejob__"] = {
  id: "__stub_electron_onejob__",
  filename: "__stub_electron_onejob__",
  loaded: true,
  exports: {
    app: {
      getPath: () => stubDir,
      getAppPath: () => stubDir,
      isPackaged: false,
      getVersion: () => "0.0.0",
    },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: function () {},
    shell: {},
    dialog: {},
  },
};

const botController = require("../controller/botController");
const { botEventType } = require("./botEvents");
const { createJobStore } = require("../jobs/jobStore");
const { createJobTracker } = require("../jobs/jobTracker");

const WS = "ws1";
const LEAD = { id: "lead", name: "Print Lead", role: "lead", workspaceId: WS };
const TICKET = { id: "ticket", name: "Ticket Bot", workspaceId: WS };
const WORKSPACE = {
  id: "workspace",
  name: "Workspace Bot",
  workspaceId: WS,
  subscriptions: [{ eventType: botEventType(TICKET, "completed") }],
};

const dirs = [];
afterEach(() => {
  while (dirs.length) {
    fs.rmSync(dirs.pop(), { recursive: true, force: true });
  }
});

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function fake({ settings = {} } = {}) {
  const bots = [LEAD, TICKET, WORKSPACE];
  const dir = fs.mkdtempSync(path.join(stubDir, "jobs-"));
  dirs.push(dir);
  const c = Object.create(botController);
  const teamSettings = { [WS]: { ...settings } };
  c._store = {
    list: () => bots,
    get: (id) => bots.find((b) => b.id === id) || null,
    getTeamSettings: (ws) => teamSettings[ws] || {},
    setTeamSettings: (ws, patch) => {
      teamSettings[ws] = { ...(teamSettings[ws] || {}), ...patch };
      return teamSettings[ws];
    },
  };
  c._runner = { listActive: () => [] };
  c.events = [];
  c._broadcast = (_ch, payload) => c.events.push(payload);
  c._jobs = createJobTracker({
    store: createJobStore({ root: dir }),
    settleMs: 1,
  });
  // A run let through: recorded, not run (the rest of _run is the runner's).
  c.ran = [];
  const real = botController._run;
  c._run = function (botId, opts) {
    if (opts.jobId) {
      c.ran.push({ botId, jobId: opts.jobId });
      return Promise.resolve({ botId, status: "completed" });
    }
    return real.call(this, botId, opts);
  };
  return c;
}

/** The team's job that's going: the lead's, with one bot running. */
function busy(c, title = "Spool holder") {
  const job = c._jobs.startJob({
    workspaceId: WS,
    leadId: LEAD.id,
    leadName: LEAD.name,
    title,
  });
  c._jobs.startStep(job.id, { botId: LEAD.id, botName: LEAD.name });
  return job;
}
const end = (c, job) =>
  c._jobs.endStep(job.id, {
    botId: LEAD.id,
    record: { status: "completed", output: "Done." },
  });

describe("one job at a time per team (DASH-81)", () => {
  it("a schedule's run that would start a job is skipped while the team is busy, saying why", async () => {
    const c = fake();
    busy(c);
    const result = await c._run(TICKET.id, {
      trigger: "schedule",
      prompt: "Take the next ticket.",
    });
    assert.equal(result.skipped, true);
    assert.match(result.reason, /busy with "Spool holder"/);
    assert.equal(c._jobs.queuedFor(WS).length, 0);
    assert.ok(
      c.events.some((e) => e.event && e.event.type === "skipped"),
      "the skip shows on the bot's stream",
    );
  });

  it("a trigger's run waits as a queued job and runs when the team is free", async () => {
    const c = fake();
    const first = busy(c);
    const p = c._run(TICKET.id, { trigger: "event", prompt: "New idea" });
    const [queued] = c._jobs.queuedFor(WS);
    assert.ok(queued, "a queued job");
    assert.equal(queued.title, "Ticket Bot: New idea");
    assert.equal(c.ran.length, 0);
    end(c, first);
    const result = await p;
    assert.equal(result.status, "completed");
    assert.deepEqual(c.ran, [{ botId: TICKET.id, jobId: queued.id }]);
  });

  it("a trigger taken out of the queue never runs", async () => {
    const c = fake();
    busy(c);
    const p = c._run(TICKET.id, { trigger: "event", prompt: "New idea" });
    const [queued] = c._jobs.queuedFor(WS);
    c._jobs.stopWaiting(queued.id);
    const result = await p;
    assert.equal(result.skipped, true);
    assert.match(result.reason, /taken out of the team's queue/);
    assert.equal(c.ran.length, 0);
  });

  it("what the user does in Dash, or asks over MCP, isn't held", () => {
    const c = fake();
    busy(c);
    assert.equal(c._holdForTeam(LEAD.id, LEAD, { trigger: "manual" }), null);
    assert.equal(
      c._holdForTeam(LEAD.id, LEAD, { trigger: "manual", via: "mcp" }),
      null,
    );
  });

  it("turned off: nothing is held", async () => {
    const c = fake({ settings: { oneJobAtATime: false } });
    busy(c);
    assert.equal(c._teamBusy(WS), false);
    assert.equal(c.oneJobAtATime(WS), false);
  });

  it("a task given via MCP gets a queued job while the team is busy, and its place", () => {
    const c = fake();
    const first = busy(c);
    const jobId = c.startTaskJob({
      id: "task_1",
      leadId: LEAD.id,
      task: "Print a cable clip",
      from: "slack",
    });
    assert.equal(c.getJob(jobId).status, "queued");
    assert.deepEqual(c.jobQueue(jobId), {
      position: 1,
      waitingFor: { id: first.id, title: "Spool holder", status: "running" },
    });
    const listed = c.listJobs({ open: true }).find((j) => j.id === jobId);
    assert.equal(listed.queue.position, 1);
  });

  it("a free team's task job starts at once", () => {
    const c = fake();
    const jobId = c.startTaskJob({
      id: "task_1",
      leadId: LEAD.id,
      task: "Print a cable clip",
    });
    assert.equal(c.getJob(jobId).status, "running");
    assert.equal(c.jobQueue(jobId), null);
  });

  it("turning it off lets what's waiting start", async () => {
    const c = fake();
    busy(c);
    const jobId = c.startTaskJob({
      id: "task_1",
      leadId: LEAD.id,
      task: "Print a cable clip",
    });
    let started = null;
    c.waitForJobStart(jobId).then((v) => {
      started = v;
    });
    c.setOneJobAtATime(WS, false);
    await tick();
    assert.equal(started, true);
    assert.equal(c.getJob(jobId).status, "running");
  });

  it("the queue is full at 20", () => {
    const c = fake();
    busy(c);
    for (let i = 0; i < 20; i++) {
      c.startTaskJob({ id: `t${i}`, leadId: LEAD.id, task: `Part ${i}` });
    }
    assert.equal(c.teamQueueFull(WS), true);
  });

  it("whenJobsReady runs once the jobs are loaded", async () => {
    const c = fake();
    let n = 0;
    c.whenJobsReady(() => {
      n += 1;
    });
    await tick();
    assert.equal(n, 1);
  });
});
