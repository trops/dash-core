/**
 * botProfiles.test.js — only the active profile's bots run and show.
 * The Dash team is shared by every profile. A bot in two profiles keeps
 * running across a switch. Runs the real botController methods against a
 * fake store/scheduler (electron stubbed), like checkBot.test.js.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-botprof-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_botprof__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_botprof__"] = {
  id: "__stub_electron_botprof__",
  filename: "__stub_electron_botprof__",
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

const store = require("./profileStore");
const botController = require("../controller/botController");

let n = 0;

function fakeController(appId) {
  const bots = new Map();
  let count = 0;
  const scheduled = new Set();
  const stopped = [];
  const ran = [];
  const active = new Set();
  const self = {
    _appId: appId,
    _ready: true,
    scheduled,
    stopped,
    ran,
    active,
    _store: {
      get: (id) => bots.get(id) || null,
      list: () => [...bots.values()],
      create: (def) => {
        const saved = { ...def, id: def.id || `bot_${++count}` };
        bots.set(saved.id, saved);
        return saved;
      },
      update: (id, patch) => {
        const saved = { ...bots.get(id), ...patch, id };
        bots.set(id, saved);
        return saved;
      },
      delete: (id) => bots.delete(id),
      getRuns: () => [],
    },
    _scheduler: {
      register: (bot) => scheduled.add(bot.id),
      unregister: (id) => scheduled.delete(id),
      catchUp: () => {},
    },
    _runner: { listActive: () => [...active] },
    stop: (id) => stopped.push(id),
    _pause: {
      pauseBot: () => {},
      isPaused: () => false,
      isGloballyPaused: () => false,
    },
    _budgets: { isOverBudget: () => false },
    _dispatcher: { shouldDispatch: () => true, note: () => {} },
    _pausedQueue: { botIds: () => [], count: () => 0, clear: () => {} },
    _memory: { forgetBot: () => {} },
    _lastRunAt: () => null,
    _logAudit: () => {},
    _notifyListChanged: () => {},
    _runEvent: (bot) => ran.push(bot.id),
    _botCheckContext: () => ({}),
  };
  for (const name of [
    "save",
    "delete",
    "list",
    "_activeBots",
    "_inActiveProfile",
    "applyActiveProfile",
    "handleEvent",
    "_isHeld",
    "_drainQueued",
  ]) {
    self[name] = botController[name].bind(self);
  }
  return self;
}

const userBot = (name, extra = {}) => ({
  name,
  instructions: "Do the thing.",
  ...extra,
});

describe("bots follow the active profile", () => {
  let appId;
  let c;
  beforeEach(() => {
    n += 1;
    appId = `@test/botprof-${n}`;
    c = fakeController(appId);
  });

  it("with only Default, every bot shows and runs (no filtering)", () => {
    const a = c.save(userBot("A"));
    assert.deepEqual(
      c.list().map((b) => b.id),
      [a.id],
    );
    assert.ok(c.scheduled.has(a.id));
    assert.equal(fs.existsSync(path.join(stubDir, "Dashboard", appId)), false);
  });

  it("a bot made in a profile joins that profile only", () => {
    const old = c.save(userBot("Old"));
    const mini = store.create(appId, "Mac Mini", {
      defaultItems: { bots: [old.id] },
    });
    store.setActive(appId, mini.id);
    const fresh = c.save(userBot("Fresh"));
    assert.deepEqual(store.members(appId, "bots"), [fresh.id]);
    assert.deepEqual(store.members(appId, "bots", "default"), [old.id]);
    assert.deepEqual(
      c.list().map((b) => b.name),
      ["Fresh"],
    );
  });

  it("the Dash team is shared: never filtered out", () => {
    const dash = c._store.create({
      name: "Planner",
      system: "dash-team",
      role: "planner",
    });
    const mini = store.create(appId, "Mac Mini", { defaultItems: {} });
    store.setActive(appId, mini.id);
    assert.ok(c._activeBots().some((b) => b.id === dash.id));
    // list() is the user's bots — the Dash team is listed separately.
    assert.equal(c.list().length, 0);
  });

  it("switching schedules the new profile's bots and stops the rest", () => {
    const home = c.save(userBot("Home"));
    const work = c.save(userBot("Work"));
    const shared = c.save(userBot("Shared"));
    const mini = store.create(appId, "Mac Mini", {
      defaultItems: { bots: [home.id, work.id, shared.id] },
    });
    store.add(appId, "bots", [home.id, shared.id], mini.id);
    c.active.add(work.id);
    c.active.add(shared.id);

    store.setActive(appId, mini.id);
    c.applyActiveProfile();

    assert.ok(c.scheduled.has(home.id));
    assert.ok(c.scheduled.has(shared.id));
    assert.equal(c.scheduled.has(work.id), false);
    // The work bot's run stops; the shared bot keeps going.
    assert.deepEqual(c.stopped, [work.id]);
  });

  it("an event doesn't trigger another profile's bot", () => {
    const sub = { subscriptions: [{ eventType: "door.opened" }] };
    const home = c.save(userBot("Home", sub));
    const work = c.save(userBot("Work", sub));
    const mini = store.create(appId, "Mac Mini", {
      defaultItems: { bots: [home.id, work.id] },
    });
    store.add(appId, "bots", home.id, mini.id);
    store.setActive(appId, mini.id);

    c.handleEvent({ eventType: "door.opened" });
    assert.deepEqual(c.ran, [home.id]);
  });

  it("a saved edit to another profile's bot doesn't schedule it here", () => {
    const work = c.save(userBot("Work"));
    const mini = store.create(appId, "Mac Mini", {
      defaultItems: { bots: [work.id] },
    });
    store.setActive(appId, mini.id);
    c.applyActiveProfile();
    c.save({ id: work.id, name: "Work 2", instructions: "x" });
    assert.equal(c.scheduled.has(work.id), false);
  });

  it("deleting a bot takes it out of every profile", () => {
    const a = c.save(userBot("A"));
    const mini = store.create(appId, "Mac Mini", {
      defaultItems: { bots: [a.id] },
    });
    store.add(appId, "bots", a.id, mini.id);
    c.delete(a.id);
    assert.deepEqual(store.members(appId, "bots"), []);
    assert.deepEqual(store.members(appId, "bots", mini.id), []);
  });
});

describe("the run gate refuses another profile's bot", () => {
  it("startBlocker checks the active profile first (source)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../controller/botController.js"),
      "utf8",
    );
    const gate = src.slice(src.indexOf("startBlocker: (botId) => {"));
    const firstCheck = gate.indexOf("_inActiveProfile");
    assert.ok(
      firstCheck > 0 && firstCheck < gate.indexOf("all bots are paused"),
    );
  });
});
