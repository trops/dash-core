/**
 * chainJobs.test.js — a chain that starts from a team's bot is one job
 * (DASH-70), and a scheduled run with nothing to hand on leaves no job
 * behind (DASH-65). Helpers, plus the real botController's
 * _nothingToHandOn on a real job tracker.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-chainjobs-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_chainjobs__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_chainjobs__"] = {
  id: "__stub_electron_chainjobs__",
  filename: "__stub_electron_chainjobs__",
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
const { startsChain, chainStartedBy } = require("./chainJobs");
const { createJobTracker } = require("./jobTracker");
const { botEventType } = require("../bots/botEvents");

const TICKET = { id: "t", name: "Ticket Bot", workspaceId: "ws" };
const WORKSPACE = {
  id: "w",
  name: "Workspace Bot",
  workspaceId: "ws",
  subscriptions: [{ eventType: botEventType(TICKET, "completed") }],
};
const LONE = { id: "l", name: "Daily Digest", workspaceId: "ws" };
const store = (bots) => ({ list: () => bots });

function memoryStore() {
  const jobs = new Map();
  return {
    get: (id) => jobs.get(id) || null,
    put: (job) => {
      jobs.set(job.id, job);
      return job;
    },
    save: (job) => {
      jobs.set(job.id, job);
      return job;
    },
    remove: (id) => jobs.delete(id),
    list: () => [...jobs.values()],
  };
}

describe("startsChain (DASH-70)", () => {
  it("a bot another bot on its team listens to starts a chain", () => {
    assert.equal(startsChain(store([TICKET, WORKSPACE, LONE]), TICKET), true);
  });

  it("a bot nobody listens to doesn't (no job per scheduled run)", () => {
    assert.equal(startsChain(store([TICKET, WORKSPACE, LONE]), LONE), false);
  });

  it("listeners on another team don't count", () => {
    const other = { ...WORKSPACE, id: "o", workspaceId: "elsewhere" };
    assert.equal(startsChain(store([TICKET, other]), TICKET), false);
  });

  it("a failed listener counts too (the Reporter)", () => {
    const reporter = {
      id: "r",
      name: "Reporter",
      workspaceId: "ws",
      subscriptions: [{ eventType: botEventType(TICKET, "failed") }],
    };
    assert.equal(startsChain(store([TICKET, reporter]), TICKET), true);
  });

  it("a bot with no team doesn't", () => {
    assert.equal(
      startsChain(store([WORKSPACE]), { ...TICKET, workspaceId: null }),
      false,
    );
  });
});

describe("chainStartedBy (DASH-70)", () => {
  it("says a schedule started it", () => {
    assert.deepEqual(chainStartedBy(TICKET, { trigger: "schedule" }), {
      kind: "schedule",
      label: "Ticket Bot",
    });
    assert.equal(
      chainStartedBy(TICKET, { trigger: "catch-up" }).kind,
      "schedule",
    );
  });

  it("a trigger, or who ran it", () => {
    assert.equal(chainStartedBy(TICKET, { trigger: "event" }).kind, "trigger");
    assert.deepEqual(chainStartedBy(TICKET, { trigger: "manual" }), {
      kind: "you",
      label: "Ticket Bot",
    });
    assert.equal(
      chainStartedBy(TICKET, {}, { kind: "task", label: "slack" }).label,
      "slack",
    );
  });
});

describe("_nothingToHandOn — no empty jobs (DASH-65 + DASH-70)", () => {
  function setup() {
    const jobs = createJobTracker({ store: memoryStore() });
    const c = Object.create(botController);
    c._jobs = jobs;
    c.broadcasts = [];
    c._broadcast = (channel, msg) => c.broadcasts.push({ channel, msg });
    return { c, jobs };
  }

  function chainJob(jobs, { leadId = null } = {}) {
    const job = jobs.startJob({
      workspaceId: "ws",
      leadId,
      leadName: "Ticket Bot",
      title: "Ticket Bot: take the next ticket",
      startedBy: { kind: "schedule", label: "Ticket Bot" },
    });
    jobs.startStep(job.id, { botId: TICKET.id, botName: TICKET.name });
    jobs.endStep(job.id, {
      botId: TICKET.id,
      record: { status: "completed", output: "No ticket." },
      checking: { goalId: "goal_1" },
    });
    return job;
  }

  it("a scheduled chain job that only found nothing isn't kept", () => {
    const { c, jobs } = setup();
    const job = chainJob(jobs);
    c._nothingToHandOn({ goalId: "goal_1", reason: "No ticket to take" });
    assert.equal(jobs.get(job.id), null);
    assert.ok(c.broadcasts.some((b) => b.msg && b.msg.status === "deleted"));
  });

  it("a lead's job keeps the step, done, saying why", () => {
    const { c, jobs } = setup();
    const job = chainJob(jobs, { leadId: "lead" });
    c._nothingToHandOn({ goalId: "goal_1", reason: "No ticket to take" });
    const kept = jobs.get(job.id);
    assert.ok(kept);
    assert.equal(kept.steps[0].status, "done");
    assert.match(
      kept.steps[0].summary,
      /Nothing to hand on: No ticket to take/,
    );
  });
});
