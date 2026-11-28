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
              active.set(botId, (output, record = null) => {
                active.delete(botId);
                resolve(
                  record || { status: "completed", output, startedAt: "t" },
                );
              });
            }),
    },
    _events: { startRun() {}, onRunEvent() {}, endRun() {} },
    _checkJobs: { holdsRun: () => false, afterRun: () => false },
    _broadcast() {},
    _broadcastRunActive() {},
    _sendNotice() {},
    _recordRunIssues() {},
    finish: (botId, output, record) => active.get(botId)(output, record),
  };
  ctl._run = botController._run.bind(ctl);
  ctl._handOnJob = botController._handOnJob.bind(ctl);
  // One job at a time (DASH-81): its team is never busy here.
  ctl._gateTeamJob = botController._gateTeamJob.bind(ctl);
  ctl._teamBusy = () => false;
  ctl._asUserRun = (botId, start) => start();
  ctl.getJob = botController.getJob.bind(ctl);
  ctl.rerunStep = botController.rerunStep.bind(ctl);
  ctl.rerunJob = botController.rerunJob.bind(ctl);
  ctl._firstAsk = botController._firstAsk.bind(ctl);
  ctl._followTaskRerun = botController._followTaskRerun.bind(ctl);
  ctl.askLead = botController.askLead.bind(ctl);
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

describe("running a failed job again (DASH-165)", () => {
  /** A lead job: lead → Designer → Drafter, the Drafter failing. */
  async function failedJob(ctl) {
    const leadRun = ctl._run("lead", {
      prompt: "Walnut U desk",
      trigger: "ask",
      via: "mcp-task:slack",
    });
    const [job] = ctl._jobs.list();
    const desRun = ctl._run("des", {
      prompt: "Design it",
      trigger: "ask",
      via: "lead:lead",
      leadRequest: true,
      jobId: job.id,
    });
    ctl.finish("lead", "Asked the Designer.");
    await leadRun;
    ctl.finish(
      "des",
      'Designed: 3 parts.\n\n```json\n{"prUrl": "https://github.com/o/r/pull/7"}\n```',
    );
    await desRun;
    await tick();
    const draRun = ctl._run("dra", {
      prompt: "Draw it",
      trigger: "event",
      cause: { chain: [], depth: 0, jobId: job.id },
      source: { originBotId: "des" },
    });
    ctl.finish("dra", null, {
      status: "failed",
      error: "No paper.",
      startedAt: "t-dra",
    });
    await draRun;
    await tick();
    settle();
    return job.id;
  }

  function spyPrompts(ctl) {
    const prompts = [];
    const run = ctl._runner.run;
    ctl._runner.run = (botId, opts) => {
      prompts.push({ botId, prompt: opts && opts.prompt });
      return run(botId, opts);
    };
    return prompts;
  }

  it("restarts the chain from its first bot, in the same job, as its next try", async () => {
    const ctl = fakeCtl();
    const jobId = await failedJob(ctl);
    assert.equal(ctl._jobs.get(jobId).status, "failed");
    const prompts = spyPrompts(ctl);
    const r = ctl.rerunJob(jobId, "Use A4.");
    assert.equal(r.ok, true, r.error);
    assert.equal(r.try, 2);
    assert.equal(r.firstBot, "Woodworking Lead");
    await tick();
    const again = ctl._jobs.get(jobId);
    assert.equal(again.status, "running");
    assert.equal(again.try, 2);
    assert.equal(again.tries.length, 1);
    assert.equal(again.tries[0].status, "failed");
    assert.equal(again.tries[0].failedAt.botName, "Drafter");
    assert.equal(again.tries[0].steps.length, 3);
    // Its first bot, the lead, is asked what it was asked first…
    assert.equal(again.steps.length, 1);
    assert.equal(again.steps[0].botId, "lead");
    assert.equal(prompts[0].botId, "lead");
    assert.match(prompts[0].prompt, /^Walnut U desk\n\n/);
    // …told it's a rerun, what the earlier try did, and the note.
    assert.match(
      prompts[0].prompt,
      /this is try 2\. Try 1 failed at Drafter: No paper\./,
    );
    assert.match(
      prompts[0].prompt,
      /Designer: done — Designed: 3 parts\. \(links: https:\/\/github\.com\/o\/r\/pull\/7\)/,
    );
    assert.match(
      prompts[0].prompt,
      /A note from the user for this try: Use A4\./,
    );
    // The rest of the chain runs again too, each bot told the same.
    ctl.finish("lead", "Asked the Designer.");
    await tick();
    const desRun = ctl._run("des", {
      prompt: "Design it",
      trigger: "ask",
      via: "lead:lead",
      leadRequest: true,
      jobId,
    });
    assert.match(prompts[1].prompt, /^Design it\n\nThis job is running again/);
    assert.match(
      prompts[1].prompt,
      /What you did in that try:\n- Its done step/,
    );
    assert.match(prompts[1].prompt, /Its handoff: .*pull\/7/);
    ctl.finish("des", "Designed again.");
    await desRun;
    await tick();
    const draRun = ctl._run("dra", {
      prompt: "Draw it",
      trigger: "event",
      cause: { chain: [], depth: 0, jobId },
      source: { originBotId: "des" },
    });
    assert.match(prompts[2].prompt, /Why it failed: No paper\./);
    ctl.finish("dra", "Drawn.");
    await draRun;
    await tick();
    settle();
    // Done: this try's steps all are, whatever the one before did.
    const done = ctl._jobs.get(jobId);
    assert.equal(done.status, "done");
    assert.deepEqual(
      done.steps.map((s) => [s.botName, s.status]),
      [
        ["Woodworking Lead", "done"],
        ["Designer", "done"],
        ["Drafter", "done"],
      ],
    );
  });

  it("every bot's run in the new try goes to its checks (nothing is skipped)", async () => {
    const ctl = fakeCtl();
    const jobId = await failedJob(ctl);
    const held = [];
    ctl._checkJobs = {
      holdsRun: () => false,
      afterRun: ({ botId, opts, jobId: j }) => {
        held.push({ botId, trigger: opts.trigger, jobId: j });
        return false;
      },
    };
    ctl.rerunJob(jobId);
    await tick();
    ctl.finish("lead", "ok");
    await tick();
    await tick();
    await tick();
    const desRun = ctl._run("des", {
      prompt: "Design it",
      trigger: "ask",
      via: "lead:lead",
      leadRequest: true,
      jobId,
    });
    ctl.finish("des", "ok");
    await desRun;
    await tick();
    // A fresh run, not a check's retry ("flow"): its checks start over
    // (a lead's own answers have none).
    assert.deepEqual(
      held.map((h) => [h.botId, h.trigger !== "flow", h.jobId === jobId]),
      [["des", true, true]],
    );
  });

  it("a chain's first bot (a self-test's) is asked the same again", async () => {
    const ctl = fakeCtl();
    const item = { id: "SANDBOX-1", title: "Test ticket" };
    const job = ctl._jobs.startJob({
      workspaceId: "ws1",
      leadId: null,
      leadName: "Designer",
      title: "Test: Designer on SANDBOX-1",
      item,
      test: true,
    });
    const first = ctl._run("des", {
      prompt: "Work on the test item SANDBOX-1",
      trigger: "you",
      jobId: job.id,
    });
    ctl.finish("des", null, { status: "failed", error: "Refused." });
    await first;
    await tick();
    settle();
    const prompts = spyPrompts(ctl);
    assert.equal(ctl.rerunJob(job.id).ok, true);
    await tick();
    assert.equal(prompts[0].botId, "des");
    assert.match(prompts[0].prompt, /SANDBOX-1/);
    assert.match(
      prompts[0].prompt,
      /It's the same work item: SANDBOX-1 · Test ticket\. Work on it, never pick another\./,
    );
    const again = ctl._jobs.get(job.id);
    assert.equal(again.test, true);
    assert.deepEqual(again.skippedInTest, []);
  });

  it("bots-rerun-step's old call restarts the whole job, whatever step it names", async () => {
    const ctl = fakeCtl();
    const jobId = await failedJob(ctl);
    const dra = ctl._jobs.get(jobId).steps[2].id;
    const r = ctl.rerunStep(jobId, dra, "");
    assert.equal(r.ok, true);
    await tick();
    assert.equal(ctl._jobs.get(jobId).steps[0].botId, "lead");
  });

  it("not a job that's going, nor while its first bot is busy", async () => {
    const ctl = fakeCtl();
    const jobId = await failedJob(ctl);
    const busy = ctl._run("lead", { prompt: "other", trigger: "schedule" });
    assert.match(ctl.rerunJob(jobId).error, /Woodworking Lead is busy/);
    ctl.finish("lead", "ok");
    await busy;
    assert.equal(ctl.rerunJob(jobId).ok, true);
    assert.match(ctl.rerunJob(jobId).error, /Only a job that ended/);
    assert.match(ctl.rerunJob("nope").error, /gone/);
  });

  it("a task given over MCP follows the new try: done when it is (DASH-145)", async () => {
    const ctl = fakeCtl();
    const tasks = { calls: [] };
    ctl._mcpTasks = {
      reopened: (id) => tasks.calls.push(["reopened", id]),
      done: (id, v) => tasks.calls.push(["done", id, v.summary]),
      failed: (id, e) => tasks.calls.push(["failed", id, e]),
    };
    ctl.waitForJob = botController.waitForJob.bind(ctl);
    const job = ctl._jobs.startJob({
      workspaceId: "ws1",
      leadId: "lead",
      leadName: "Woodworking Lead",
      title: "Walnut U desk",
      request: "Walnut U desk",
      startedBy: { kind: "task", label: "slack", taskId: "task_1" },
    });
    const first = ctl._run("lead", { prompt: "Walnut U desk", jobId: job.id });
    ctl.finish("lead", null, { status: "failed", error: "Refused." });
    await first;
    await tick();
    settle();
    assert.equal(ctl.rerunJob(job.id).ok, true);
    assert.deepEqual(tasks.calls, [["reopened", "task_1"]]);
    await tick();
    ctl.finish("lead", "All done.");
    await tick();
    await tick();
    settle();
    await tick();
    assert.equal(ctl._jobs.get(job.id).status, "done");
    assert.deepEqual(tasks.calls[1], ["done", "task_1", "All done."]);
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
