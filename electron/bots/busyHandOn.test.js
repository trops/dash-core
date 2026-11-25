/**
 * busyHandOn.test.js — a hand-on to a busy bot waits its turn (DASH-73).
 *
 * The Code Factory takes a ticket every 10 minutes and its PR Bot can wait
 * 20 minutes on CI. A second ticket's hand-on to the PR Bot used to be
 * skipped ("busy with another run"), losing the ticket. Now it's queued,
 * shown on the job, and run in order when the bot (and its checks) are
 * free. The real botController.handleEvent, Electron stubbed like
 * chainLimit.test.js.
 */
"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-busyhandon-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_busyhandon__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_busyhandon__"] = {
  id: "__stub_electron_busyhandon__",
  filename: "__stub_electron_busyhandon__",
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
const { BusyQueue, MAX_WAITING_PER_BOT } = require("./busyQueue");

const WS = "ws1";
const CODER = {
  id: "coder",
  name: "Coder",
  workspaceId: WS,
  subscriptions: [],
};
const PR = {
  id: "pr",
  name: "PR Bot",
  workspaceId: WS,
  subscriptions: [
    { eventType: botEventType(CODER, "completed"), label: "Coder › completed" },
  ],
};

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** The Coder finished ticket `key`. */
function coderDone(key, jobId = null) {
  return {
    eventType: botEventType(CODER, "completed"),
    originBotId: CODER.id,
    chain: [CODER.id],
    depth: 1,
    workspaceId: WS,
    content: { key },
    ...(jobId ? { jobId } : {}),
  };
}

/**
 * A controller whose runner tracks active bots; each run of the PR Bot
 * stays active until the test ends it with `finish()`.
 */
const made = [];
afterEach(async () => {
  while (made.length) await made.pop().end();
});

function fake({ checking = () => false, cooldownFree = () => true } = {}) {
  const bots = [CODER, PR];
  const c = Object.create(botController);
  c._ready = true;
  c._appId = null;
  c._busyPollMs = 2;
  c._store = {
    list: () => bots,
    get: (id) => bots.find((b) => b.id === id) || null,
  };
  const active = new Set();
  c._runner = { listActive: () => [...active] };
  c._checkJobs = { checkingFor: checking };
  c._pause = { isPaused: () => false };
  c._budgets = { isOverBudget: () => false };
  c._dispatcher = { shouldDispatch: () => cooldownFree(), note() {} };
  c.started = [];
  const pending = [];
  c._runEvent = (bot, event) => {
    active.add(bot.id);
    c.started.push(event.content.key);
    return new Promise((resolve) => {
      pending.push(() => {
        active.delete(bot.id);
        resolve({ status: "completed" });
      });
    });
  };
  /** The oldest run in progress ends. */
  c.finish = async () => {
    const f = pending.shift();
    if (f) f();
    await tick(80);
  };
  c.busyWith = (id) => active.add(id);
  c.free = (id) => active.delete(id);
  c._broadcast = () => {};
  c._notifyListChanged = () => {};
  c.queued = [];
  c.skipped = [];
  const open = new Set(["job_1", "job_2"]);
  c._jobs = {
    isOpen: (id) => open.has(id),
    get: (id) => ({ id, workspaceId: WS }),
    queueStep: (jobId, step) => c.queued.push({ jobId, ...step }),
    skipStep: (jobId, step) => c.skipped.push({ jobId, ...step }),
  };
  c.stopJob = (id) => open.delete(id);
  /** Lets every drain end (nothing waits, nothing runs). */
  c.end = async () => {
    c._busy().clear(PR.id);
    active.clear();
    while (pending.length) pending.shift()();
    await tick(80);
  };
  made.push(c);
  c.notices = [];
  c._sendNotice = (n) => c.notices.push(n);
  return c;
}

describe("BusyQueue", () => {
  it("keeps every event in order (nothing is coalesced)", () => {
    const q = new BusyQueue();
    q.add("b", { n: 1 });
    q.add("b", { n: 2 });
    assert.equal(q.count("b"), 2);
    assert.equal(q.shift("b").n, 1);
    assert.equal(q.shift("b").n, 2);
    assert.equal(q.shift("b"), null);
  });

  it("refuses past its limit", () => {
    const q = new BusyQueue({ max: 2 });
    assert.equal(q.add("b", {}), true);
    assert.equal(q.add("b", {}), true);
    assert.equal(q.add("b", {}), false);
  });

  it("puts one back at the front", () => {
    const q = new BusyQueue();
    q.add("b", { n: 2 });
    q.unshift("b", { n: 1 });
    assert.equal(q.shift("b").n, 1);
  });
});

describe("handleEvent — a hand-on to a busy bot waits (DASH-73)", () => {
  it("a free bot starts at once, as before", () => {
    const c = fake();
    c.handleEvent(coderDone("DASH-1"));
    assert.deepEqual(c.started, ["DASH-1"]);
  });

  it("two tickets: the second waits for the first, then runs", async () => {
    const c = fake();
    c.handleEvent(coderDone("DASH-1"));
    c.handleEvent(coderDone("DASH-2"));
    await tick(80);
    assert.deepEqual(c.started, ["DASH-1"], "the PR Bot is busy with DASH-1");
    await c.finish();
    assert.deepEqual(c.started, ["DASH-1", "DASH-2"]);
    await c.finish();
    assert.deepEqual(c.skipped, [], "nothing skipped");
  });

  it("three in a row run in the order they came", async () => {
    const c = fake();
    for (const k of ["A", "B", "C"]) c.handleEvent(coderDone(k));
    await c.finish();
    await c.finish();
    await c.finish();
    assert.deepEqual(c.started, ["A", "B", "C"]);
  });

  it("waits while the bot's checks still try its last run", async () => {
    let checking = true;
    const c = fake({ checking: () => checking });
    c.handleEvent(coderDone("DASH-2"));
    await tick(80);
    assert.deepEqual(c.started, []);
    checking = false;
    await tick(80);
    assert.deepEqual(c.started, ["DASH-2"]);
  });

  it("waits out the cooldown instead of skipping", async () => {
    let free = false;
    const c = fake({ cooldownFree: () => free });
    c.handleEvent(coderDone("DASH-2"));
    await tick(80);
    assert.deepEqual(c.started, []);
    assert.deepEqual(c.skipped, []);
    free = true;
    await tick(80);
    assert.deepEqual(c.started, ["DASH-2"]);
  });

  it("is shown on its job as queued", () => {
    const c = fake();
    c.busyWith(PR.id);
    c.handleEvent(coderDone("DASH-2", "job_2"));
    assert.equal(c.queued.length, 1);
    assert.equal(c.queued[0].jobId, "job_2");
    assert.equal(c.queued[0].botName, "PR Bot");
    assert.match(c.queued[0].summary, /busy/);
  });

  it("a stopped job's hand-on doesn't start", async () => {
    const c = fake();
    c.busyWith(PR.id);
    c.handleEvent(coderDone("DASH-2", "job_2"));
    c.stopJob("job_2");
    c.free(PR.id);
    await tick(80);
    assert.deepEqual(c.started, []);
  });

  it("past the limit, one is refused and said", () => {
    const c = fake();
    c.busyWith(PR.id);
    for (let i = 0; i <= MAX_WAITING_PER_BOT; i++) {
      c.handleEvent(coderDone(`K${i}`, "job_1"));
    }
    assert.equal(c.queued.length, MAX_WAITING_PER_BOT);
    assert.equal(c.notices.length, 1);
    assert.match(c.notices[0].body, /already waiting/);
  });

  it("a widget's event (no bot behind it) isn't queued", () => {
    const c = fake();
    c.busyWith(PR.id);
    const ev = coderDone("W");
    delete ev.originBotId;
    c._runEvent = () => c.started.push("W");
    c.handleEvent(ev);
    assert.equal(c.queued.length, 0);
  });
});
