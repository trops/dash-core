/**
 * userRunPaused.test.js — paused only stops what a bot does on its own. A
 * message the user sends (Run now, a question to a lead from the app, a
 * cell's Build with AI) goes ahead on a paused bot, and so do the bots and
 * Dash team roles the lead asks for it. Over MCP, or with everything
 * paused, pause holds. The real botController methods, with Electron
 * stubbed like connectorRun.test.js.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-userrun-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_userrun__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_userrun__"] = {
  id: "__stub_electron_userrun__",
  filename: "__stub_electron_userrun__",
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

const LEAD = { id: "lead_1", name: "Shopping List Lead", role: "lead" };

/**
 * The controller with a paused store; `_run` records whether each run
 * counted as the user's (what startBlocker and the gate check).
 */
function fake({ paused = ["lead_1"], allPaused = false } = {}) {
  const c = Object.create(botController);
  c._testRuns = undefined;
  c._userRuns = undefined;
  c._store = { get: (id) => (id === LEAD.id ? LEAD : { id, name: id }) };
  c._pause = {
    isPaused: (id) => allPaused || paused.includes(id),
    isGloballyPaused: () => allPaused,
  };
  c.runs = [];
  c._run = (botId, opts) => {
    c.runs.push({
      botId,
      via: opts && opts.via,
      exempt: !!(c._testRuns && c._testRuns.has(botId)),
      user: c._inUserRun(botId),
    });
    return Promise.resolve({ status: "completed", output: "ok" });
  };
  return c;
}

describe("a message the user sends goes through on a paused bot", () => {
  it("asking a paused lead from the app is the user's run", async () => {
    for (const via of [null, "create", "assistant"]) {
      const c = fake();
      await c.askLead(LEAD.id, "Build a calendar widget", { via });
      assert.deepEqual(c.runs[0], {
        botId: "lead_1",
        via,
        exempt: true,
        user: true,
      });
      // Done: the exemption ends with the run.
      assert.equal(c._testRuns.has("lead_1"), false);
      assert.equal(c._inUserRun("lead_1"), false);
    }
  });

  it("over MCP, pause holds", async () => {
    for (const via of ["mcp", "mcp-task:claude"]) {
      const c = fake();
      await c.askLead(LEAD.id, "Status?", { via });
      assert.equal(c.runs[0].exempt, false);
      assert.equal(c.runs[0].user, false);
    }
  });

  it("with everything paused, nothing is exempt", async () => {
    const c = fake({ allPaused: true });
    await c.askLead(LEAD.id, "Hi", { via: "create" });
    assert.equal(c.runs[0].exempt, false);
  });

  it("the end of one run doesn't end another's exemption", async () => {
    const c = fake();
    let finish;
    c._run = () => new Promise((r) => (finish = r));
    const first = c.askLead(LEAD.id, "One", {});
    const second = c._asUserRun(LEAD.id, () => Promise.resolve({}));
    await second;
    assert.equal(c._testRuns.has("lead_1"), true);
    finish({});
    await first;
    assert.equal(c._testRuns.has("lead_1"), false);
  });

  it("the bots a lead asks for the user's request run too; on its own, pause holds", async () => {
    const member = { id: "bot_2", name: "Shopping List Maker" };
    const setup = () => {
      const c = fake({ paused: ["lead_1", "bot_2"] });
      c._runner = { startedAt: () => "t1" };
      c._handoffs = { take: () => true };
      c._runVia = new Map();
      return c;
    };
    // Asked by the user: the lead's run is theirs, so is the bot's.
    const c = setup();
    c._userRuns = new Map([["lead_1", 1]]);
    await c._leadAskBot(LEAD, member, "What's on the list?");
    const asked = c.runs.find((r) => r.botId === "bot_2");
    assert.equal(asked.exempt, true);
    // A lead running on its own (schedule): the paused bot stays paused.
    const own = setup();
    await own._leadAskBot(LEAD, member, "What's on the list?");
    assert.equal(own.runs.find((r) => r.botId === "bot_2").exempt, false);
  });

  it("a Dash team role the lead asks for the user answers while paused", async () => {
    const planner = { id: "dt_planner", role: "planner", system: "dash-team" };
    const c = fake({ paused: ["lead_1", "dt_planner"] });
    c._store.list = () => [LEAD, planner];
    c._store.get = (id) => (id === LEAD.id ? LEAD : planner);
    c._runner = { startedAt: () => "t1", isRunning: () => false };
    c._handoffs = { take: () => true };
    c._userRuns = new Map([["lead_1", 1]]);
    const res = await c._askRole({
      callerId: "lead_1",
      role: "planner",
      request: "Plan a calendar widget",
    });
    assert.equal(res.isError, false);
    assert.equal(c.runs[0].exempt, true);
  });

  it("a plan build runs a paused role: the user pressed Build", async () => {
    const builder = { id: "dt_builder", role: "builder", system: "dash-team" };
    const c = fake({ paused: ["dt_builder"] });
    c._store.list = () => [builder];
    c._takeBuilds = () => [];
    await c._planAskRole("builder", "Build it");
    assert.equal(c.runs[0].exempt, true);
  });

  it("a run that throws on start still ends its exemption", () => {
    const c = fake();
    assert.throws(() =>
      c._asUserRun(LEAD.id, () => {
        throw new Error("boom");
      }),
    );
    assert.equal(c._testRuns.has("lead_1"), false);
    assert.equal(c._inUserRun("lead_1"), false);
  });
});
