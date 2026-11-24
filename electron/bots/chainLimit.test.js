/**
 * chainLimit.test.js — a team's chain runs as long as the team (DASH-69).
 *
 * The Code Factory hands a ticket down 7 bots (Ticket → Workspace → Planner
 * → Coder → PR → Merge → Reporter). A fixed limit of 5 stopped it after the
 * PR Bot, with only a passing warning. Loops are refused anyway, so inside
 * one team a chain can't be longer than the team: it may now go that far
 * (never past MAX_CHAIN_HARD_CAP), and a refused hand-on is kept on the
 * job and notified. The real botController.handleEvent, Electron stubbed
 * like userRunPaused.test.js.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-chainlimit-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_chainlimit__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_chainlimit__"] = {
  id: "__stub_electron_chainlimit__",
  filename: "__stub_electron_chainlimit__",
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
const {
  MAX_CHAIN_DEPTH,
  MAX_CHAIN_HARD_CAP,
  chainLimit,
  checkChain,
  botEventType,
} = require("../bots/botEvents");

const WS = "1795536635350";
const NAMES = [
  "Ticket Bot",
  "Workspace Bot",
  "Planner",
  "Coder",
  "PR Bot",
  "Merge Bot",
  "Reporter",
];

/** A team of `names`, each subscribed to the previous one's completed. */
function team(names, workspaceId = WS) {
  const bots = names.map((name, i) => ({
    id: `bot_${i}`,
    name,
    workspaceId,
    subscriptions: [],
  }));
  bots.forEach((b, i) => {
    if (i === 0) return;
    const from = bots[i - 1];
    b.subscriptions = [
      {
        eventType: botEventType(from, "completed"),
        label: `${from.name} › completed`,
      },
    ];
  });
  return bots;
}

/** `from`'s completed event, `depth` bots into the chain. */
function completed(from, chain) {
  return {
    eventType: botEventType(from, "completed"),
    originBotId: from.id,
    chain,
    depth: chain.length,
    workspaceId: from.workspaceId,
    jobId: "job_1",
  };
}

function fake(bots, { others = [] } = {}) {
  const all = [...bots, ...others];
  const c = Object.create(botController);
  c._ready = true;
  c._appId = null;
  c._store = {
    list: () => all,
    get: (id) => all.find((b) => b.id === id) || null,
  };
  c._pause = { isPaused: () => false };
  c._budgets = { isOverBudget: () => false };
  c._dispatcher = { shouldDispatch: () => true, note() {} };
  c.ran = [];
  c._runEvent = (bot) => c.ran.push(bot.name);
  c.broadcasts = [];
  c._broadcast = (channel, msg) => c.broadcasts.push({ channel, msg });
  c.skipped = [];
  c._jobs = {
    isOpen: () => true,
    get: () => ({ id: "job_1", workspaceId: WS }),
    skipStep: (jobId, step) => c.skipped.push({ jobId, ...step }),
  };
  c.notices = [];
  c._notify = (n) => c.notices.push(n);
  return c;
}

describe("chainLimit (DASH-69)", () => {
  it("is MAX_CHAIN_DEPTH for small or unknown teams", () => {
    assert.equal(chainLimit(0), MAX_CHAIN_DEPTH);
    assert.equal(chainLimit(3), MAX_CHAIN_DEPTH);
    assert.equal(chainLimit(undefined), MAX_CHAIN_DEPTH);
  });

  it("is the team's size when that's bigger", () => {
    assert.equal(chainLimit(7), 7);
    assert.equal(chainLimit(12), 12);
  });

  it("never goes past the hard cap", () => {
    assert.equal(chainLimit(500), MAX_CHAIN_HARD_CAP);
  });

  it("a loop is still refused, however long the limit", () => {
    const r = checkChain({ chain: ["a", "b"], depth: 2 }, "a", chainLimit(20));
    assert.equal(r.ok, false);
    assert.match(r.reason, /already/);
  });
});

describe("handleEvent — a 7-bot team's chain runs to the end (DASH-69)", () => {
  it("the PR Bot's completed starts the Merge Bot (depth 5)", () => {
    const bots = team(NAMES);
    const c = fake(bots);
    // Ticket → Workspace → Planner → Coder → PR Bot published it.
    c.handleEvent(
      completed(
        bots[4],
        bots.slice(0, 5).map((b) => b.id),
      ),
    );
    assert.deepEqual(c.ran, ["Merge Bot"]);
    assert.deepEqual(c.skipped, []);
  });

  it("the Merge Bot's completed starts the Reporter (depth 6)", () => {
    const bots = team(NAMES);
    const c = fake(bots);
    c.handleEvent(
      completed(
        bots[5],
        bots.slice(0, 6).map((b) => b.id),
      ),
    );
    assert.deepEqual(c.ran, ["Reporter"]);
  });

  it("other dashboards' bots don't make a team's chain longer", () => {
    const bots = team(NAMES.slice(0, 6));
    const others = team(
      ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"],
      "other",
    ).map((b) => ({ ...b, id: `other_${b.id}` }));
    const c = fake(bots, { others });
    // A 6-bot team: depth 6 is past its chain.
    const chain = ["p", "q", "r", "s", "t", "u"];
    c.handleEvent({
      ...completed(bots[4], chain),
      originBotId: bots[4].id,
    });
    assert.deepEqual(c.ran, []);
  });
});

describe("handleEvent — a refused hand-on is never silent (DASH-69)", () => {
  function refused() {
    const bots = team(["A", "B"]);
    const c = fake(bots);
    // A chain already MAX_CHAIN_DEPTH long, on a 2-bot team.
    const chain = ["u", "v", "w", "x", "y"];
    c.handleEvent({ ...completed(bots[0], chain), originBotId: bots[0].id });
    return c;
  }

  it("doesn't run the bot", () => {
    assert.deepEqual(refused().ran, []);
  });

  it("still says so on the Activity feed", () => {
    const w = refused().broadcasts.find(
      (b) => b.msg && b.msg.event && b.msg.event.type === "warning",
    );
    assert.ok(w);
    assert.match(w.msg.event.message, /depth limit/);
  });

  it("keeps it on the job as a skipped step, with why", () => {
    const [s] = refused().skipped;
    assert.equal(s.jobId, "job_1");
    assert.equal(s.botName, "B");
    assert.match(s.summary, /B didn't run: .*depth limit/);
    assert.equal(s.why.kind, "handon");
    assert.equal(s.why.by, "A");
  });

  it("notifies, since the rest of the chain won't run", () => {
    const [n] = refused().notices;
    assert.equal(n.title, "Bot chain stopped");
    assert.match(n.body, /^B didn't run/);
  });

  it("a loop is refused the same way", () => {
    const bots = team(["A", "B"]);
    const c = fake(bots);
    c.handleEvent({
      ...completed(bots[0], ["bot_1", "bot_0"]),
      originBotId: bots[0].id,
    });
    assert.deepEqual(c.ran, []);
    assert.match(c.skipped[0].summary, /already ran/);
  });
});
