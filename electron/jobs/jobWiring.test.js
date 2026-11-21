/**
 * jobWiring.test.js — the real botController._run with stand-in runner and
 * store (DASH-28, DASH-31): a lead's run starts a job, the bot it asks and
 * that bot's hand-on join it, and a lead asking a bot a hand-on in the
 * same job already started waits for that run instead of hearing "busy".
 * Electron is stubbed like alwaysAllowController.test.js.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-jobwiring-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_jobwiring__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_jobwiring__"] = {
  id: "__stub_electron_jobwiring__",
  filename: "__stub_electron_jobwiring__",
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
const goalController = require("../controller/goalController");
const { createJobStore } = require("./jobStore");
const { createJobTracker } = require("./jobTracker");
const { buildBotEventMessage, causeFromEvent } = require("../bots/botEvents");

goalController.release = () => {};

const BOTS = {
  lead: {
    id: "lead",
    role: "lead",
    name: "Woodworking Lead",
    workspaceId: "ws1",
  },
  des: { id: "des", name: "Designer", workspaceId: "ws1" },
  dra: { id: "dra", name: "Drafter", workspaceId: "ws1" },
};

let dir;
let timers;

function fakeCtl() {
  const active = new Map(); // botId → resolve
  const ctl = {
    _store: { get: (id) => BOTS[id] || null },
    _jobs: createJobTracker({
      store: createJobStore({ root: dir }),
      setTimer: (fn) => {
        const t = { fn };
        timers.push(t);
        return t;
      },
      clearTimer: (t) => {
        t.cleared = true;
      },
    }),
    _runner: {
      listActive: () => [...active.keys()],
      startedAt: () => null,
      // A run stays going until the test finishes it; a busy bot is
      // skipped, as the real runner does.
      run: (botId) =>
        active.has(botId)
          ? Promise.resolve({
              status: "skipped",
              reason: "a run is already in progress",
            })
          : new Promise((resolve) => {
              active.set(botId, (output) => {
                active.delete(botId);
                resolve({ status: "completed", output, startedAt: "t" });
              });
            }),
    },
    _events: { startRun() {}, onRunEvent() {}, endRun() {} },
    _checkJobs: { holdsRun: () => false, afterRun: () => false },
    _broadcast() {},
    _broadcastRunActive() {},
    _sendNotice() {},
    _recordRunIssues() {},
    finish: (botId, output) => active.get(botId)(output),
  };
  ctl._run = botController._run.bind(ctl);
  ctl._handOnJob = botController._handOnJob.bind(ctl);
  return ctl;
}
const tick = () => new Promise((r) => setImmediate(r));
const settle = () => {
  for (const t of timers.splice(0)) if (!t.cleared) t.fn();
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-jobwiring-"));
  timers = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("jobs in the real _run", () => {
  it("lead → asked Designer → its hand-on Drafter: one job, done when the Drafter is", async () => {
    const ctl = fakeCtl();
    const leadRun = ctl._run("lead", {
      prompt: "Walnut U desk\n(notes)",
      trigger: "ask",
      via: "mcp-task:slack",
    });
    const [job] = ctl._jobs.list();
    assert.equal(job.title, "Walnut U desk");
    assert.deepEqual(job.startedBy, { kind: "task", label: "slack" });
    // The lead asks the Designer (leadAsk passes the lead's job).
    const desRun = ctl._run("des", {
      prompt: "Design it",
      trigger: "ask",
      via: "lead:lead",
      leadRequest: true,
      jobId: job.id,
    });
    ctl.finish("lead", "Asked the Designer.");
    await leadRun;
    // The Designer's Completed event carries the job; its hand-on joins it.
    const cause = { chain: [], depth: 0, jobId: job.id };
    const msg = buildBotEventMessage(BOTS.des, "completed", {}, cause);
    assert.equal(msg.jobId, job.id);
    ctl.finish("des", "Designed: 3 parts.");
    await desRun;
    await tick();
    assert.equal(ctl._jobs.get(job.id).status, "running");
    const draRun = ctl._run("dra", {
      prompt: "Draw it",
      trigger: "event",
      cause: causeFromEvent(msg),
      source: { originBotId: "des", label: "Completed" },
    });
    settle();
    assert.equal(ctl._jobs.get(job.id).status, "running");
    ctl.finish("dra", "Drawn: 3 sheets.");
    await draRun;
    await tick();
    settle();
    const done = ctl._jobs.get(job.id);
    assert.equal(done.status, "done");
    assert.deepEqual(
      done.steps.map((s) => [
        s.botName,
        s.status,
        s.why && s.why.kind,
        s.why && s.why.by,
      ]),
      [
        ["Woodworking Lead", "done", "task", undefined],
        ["Designer", "done", "asked", "Woodworking Lead"],
        ["Drafter", "done", "handon", "Designer"],
      ],
    );
  });

  it("a run outside any lead's chain makes no job", async () => {
    const ctl = fakeCtl();
    const p = ctl._run("des", { prompt: "go", trigger: "schedule" });
    ctl.finish("des", "ok");
    await p;
    assert.equal(ctl._jobs.list().length, 0);
  });

  it("a hand-on to a bot that's busy is said in the job", async () => {
    const ctl = fakeCtl();
    const job = ctl._jobs.startJob({
      workspaceId: "ws1",
      leadId: "lead",
      title: "x",
    });
    const first = ctl._run("dra", { prompt: "a", trigger: "manual" });
    ctl._run("dra", {
      prompt: "b",
      trigger: "event",
      cause: { chain: [], depth: 0, jobId: job.id },
      source: { originBotId: "des" },
    });
    const step = ctl._jobs.get(job.id).steps[0];
    assert.equal(step.status, "skipped");
    assert.match(step.summary, /Drafter was busy/);
    ctl.finish("dra", "ok");
    await first;
  });

  it("a hand-on never joins another dashboard's job, or one that has ended", async () => {
    const ctl = fakeCtl();
    const other = ctl._jobs.startJob({
      workspaceId: "ws2",
      leadId: "x",
      title: "elsewhere",
    });
    const p1 = ctl._run("dra", {
      prompt: "a",
      trigger: "event",
      cause: { chain: [], depth: 0, jobId: other.id },
      source: { originBotId: "des" },
    });
    ctl.finish("dra", "ok");
    await p1;
    assert.equal(ctl._jobs.get(other.id).steps.length, 0);
    // An ended job (Dash restarted, an old queued event replays).
    const ended = ctl._jobs.startJob({
      workspaceId: "ws1",
      leadId: "lead",
      title: "old",
    });
    ctl._jobs.skipStep(ended.id, {
      botId: "lead",
      botName: "Lead",
      summary: "x",
    });
    settle();
    assert.equal(ctl._jobs.get(ended.id).status, "stopped");
    const p2 = ctl._run("dra", {
      prompt: "b",
      trigger: "event",
      cause: { chain: [], depth: 0, jobId: ended.id },
      source: { originBotId: "des" },
    });
    ctl.finish("dra", "ok");
    await p2;
    assert.equal(ctl._jobs.get(ended.id).steps.length, 1);
  });

  it("a scheduled lead run makes no job", async () => {
    const ctl = fakeCtl();
    const p = ctl._run("lead", { prompt: "daily", trigger: "schedule" });
    ctl.finish("lead", "ok");
    await p;
    assert.equal(ctl._jobs.list().length, 0);
  });
});

describe("jobs for the screens (DASH-31)", () => {
  it("the list is light: open only, a limit, and no step summaries but a waiting one's", () => {
    const ctl = fakeCtl();
    const a = ctl._jobs.startJob({
      workspaceId: "ws1",
      leadId: "lead",
      title: "a",
    });
    ctl._jobs.startStep(a.id, { botId: "des", botName: "Designer" });
    ctl._jobs.endStep(a.id, {
      botId: "des",
      record: { status: "completed", output: "Long answer" },
    });
    ctl._jobs.waitStep(a.id, {
      botId: "dra",
      botName: "Drafter",
      summary: "Drafter is paused.",
    });
    const b = ctl._jobs.startJob({
      workspaceId: "ws1",
      leadId: "lead",
      title: "b",
    });
    ctl._jobs.skipStep(b.id, { botId: "lead", botName: "Lead", summary: "x" });
    settle();
    const listJobs = botController.listJobs.bind(ctl);
    const open = listJobs({ open: true });
    assert.deepEqual(
      open.map((j) => j.id),
      [a.id],
    );
    assert.equal(open[0].steps[0].summary, undefined);
    assert.equal(open[0].steps[1].summary, "Drafter is paused.");
    // What was asked stays out of list rows (getJob has it, for Run again).
    assert.equal(open[0].request, undefined);
    assert.equal(ctl._jobs.get(a.id).request, "a");
    assert.equal(listJobs({ limit: 1 }).length, 1);
  });

  it("old finished jobs go only when the user turned that on", () => {
    const ctl = fakeCtl();
    const job = ctl._jobs.startJob({
      workspaceId: "ws1",
      leadId: "lead",
      title: "old",
    });
    ctl._jobs.skipStep(job.id, {
      botId: "lead",
      botName: "Lead",
      summary: "x",
    });
    settle();
    // Pretend it ended long ago.
    const j = ctl._jobs.get(job.id);
    j.endedAt = "2025-01-01T00:00:00.000Z";
    let setting = false;
    ctl._store.getSettings = () => ({ clearOldJobs: setting });
    const clear = botController._clearOldJobs.bind(ctl);
    assert.equal(clear(), 0);
    assert.ok(ctl._jobs.get(job.id));
    setting = true;
    assert.equal(clear(), 1);
    assert.equal(ctl._jobs.get(job.id), null);
  });
});
