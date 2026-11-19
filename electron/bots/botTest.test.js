/**
 * botTest.test.js — testing a bot from its form (bot-test-run PRD): the
 * form's definition runs once — saved or not — and nothing is handed on
 * or kept but its sample. The real botController methods over a real
 * BotStore, with a stand-in runner; Electron stubbed like
 * userRunPaused.test.js.
 */
"use strict";

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-bottest-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_bottest__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_bottest__"] = {
  id: "__stub_electron_bottest__",
  filename: "__stub_electron_bottest__",
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
const BotStore = require("./BotStore");
const { RESULTS_SERVER } = require("./resultTools");
const { GOALS_SERVER } = require("../goals/goalTools");

after(() => {
  Module._resolveFilename = originalResolve;
});

const DEALS = '{"deals":[{"title":"Skillet","price":24.99}]}';
const FORM = {
  name: "Deal Finder",
  instructions: "Find three kitchen deals. Answer with JSON.",
  workspaceId: "ws_1",
  publishes: [{ name: "deals", label: "Deals" }],
  schedules: [{ cron: "0 8 * * *", prompt: "Today's deals" }],
};

/**
 * The controller over a real store; the runner records what it was asked
 * and, while "running", lets the test call tools as the bot would.
 */
function fake({ answer = DEALS, status = "completed", during = null } = {}) {
  const c = Object.create(botController);
  const root = tempDir("bottest-root-");
  const blob = { bots: {}, runs: {} };
  c._store = new BotStore({
    persistence: {
      read: () => blob,
      write: (o) => Object.assign(blob, JSON.parse(JSON.stringify(o))),
    },
    paths: { botsRoot: root },
  });
  c._testBots = undefined;
  c._allowedByBot = new Map();
  c._forgotten = [];
  c._memory = { forgetBot: (id) => c._forgotten.push(id) };
  c._broadcasts = [];
  c._broadcast = (channel, payload) => c._broadcasts.push({ channel, payload });
  c._pause = { isGloballyPaused: () => false, isPaused: () => false };
  c._budgets = { isOverBudget: () => false };
  c.sent = [];
  c._events = {
    holding: () => false,
    sendResult: (bot, payload) => c.sent.push(payload),
    toolCalled: () => c.sent.push("tool"),
  };
  c.asked = [];
  c._runner = {
    isRunning: () => false,
    listActive: () => [],
    run: async (botId, opts) => {
      c.asked.push({ botId, opts, dirThere: fs.existsSync(opts.workingDir) });
      opts.emit({ type: "text", text: "…" });
      if (during) await during(c, botId, opts);
      return {
        status,
        error: status === "failed" ? "Web search isn't connected" : null,
        startedAt: "2026-11-18T10:00:00.000Z",
        endedAt: "2026-11-18T10:00:14.000Z",
        answer: status === "completed" ? answer : "",
        toolCalls: [],
        approvals: [],
        test: true,
      };
    },
  };
  return c;
}

const TEST_ID = "test-abc123";

describe("testing a bot that was never saved", () => {
  it("runs the form's definition once and returns what came back", async () => {
    const c = fake();
    const out = await c.test(FORM, { testId: TEST_ID });
    const [{ botId, opts, dirThere }] = c.asked;
    assert.equal(botId, TEST_ID);
    assert.equal(opts.test, true);
    assert.equal(opts.trigger, "test");
    assert.equal(opts.bot.name, "Deal Finder");
    assert.equal(opts.bot.id, TEST_ID);
    assert.equal(opts.chargeTo, null);
    // No prompt given: what it's asked on its schedule.
    assert.equal(opts.prompt, "Today's deals");
    // Its own folder for the test, removed after.
    assert.equal(dirThere, true);
    assert.equal(fs.existsSync(opts.workingDir), false);
    assert.equal(out.status, "completed");
    assert.equal(out.answer, DEALS);
    assert.equal(out.shape.kind, "json");
    assert.deepEqual(
      out.shape.fields.map((f) => f.path),
      ["deals", "deals[].title", "deals[].price"],
    );
    // The sample goes back to the form, to be kept on Create.
    assert.equal(out.sample.answer, DEALS);
    assert.equal(out.sampleKept, undefined);
    assert.deepEqual(c._store.list(), []);
  });

  it("streams its events under the test's id, and leaves nothing behind", async () => {
    const c = fake();
    await c.test(FORM, { testId: TEST_ID, prompt: "Only knives" });
    assert.equal(c.asked[0].opts.prompt, "Only knives");
    assert.ok(
      c._broadcasts.some(
        (b) => b.channel === "bot-stream" && b.payload.botId === TEST_ID,
      ),
    );
    assert.equal(c._testing(TEST_ID), null);
    assert.equal(c._allowedByBot.has(TEST_ID), false);
    assert.deepEqual(c._forgotten, [TEST_ID]);
  });

  it("keeps its results for the form: checked, never saved or sent", async () => {
    const during = async (c, botId) => {
      const bad = await c._callTool(
        RESULTS_SERVER,
        "send_result",
        {
          name: "nope",
          items: [],
        },
        { botId },
      );
      assert.equal(bad.isError, true);
      for (const n of [1, 2]) {
        const r = await c._callTool(
          RESULTS_SERVER,
          "send_result",
          {
            name: "deals",
            items: Array.from({ length: n }, (_, i) => ({ title: `d${i}` })),
          },
          { botId },
        );
        assert.match(r.text, /this is a test, so nothing was sent/);
      }
    };
    const c = fake({ during });
    const out = await c.test(FORM, { testId: TEST_ID });
    assert.deepEqual(c.sent, []);
    // The latest per name, as a real send replaces the last.
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].items.length, 2);
    assert.deepEqual(out.resultsShape, [
      { name: "deals", label: "Deals", count: 2, fields: ["title"] },
    ]);
  });

  it("refuses the dashboard's jobs during a test", async () => {
    let refused = null;
    const during = async (c, botId) => {
      refused = await c._callTool(GOALS_SERVER, "claim_task", {}, { botId });
    };
    const c = fake({ during });
    await c.test(FORM, { testId: TEST_ID });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /doesn't work on the dashboard's jobs/);
  });

  it("isn't offered the dashboard's job tools", async () => {
    const c = fake();
    c._mcp = null;
    c._connectedServers = () => [];
    c._providerToolLimits = () => ({});
    c._resolveConnectors = async () => ({
      connectors: [],
      connectorServers: [],
      toolServer: {},
      readOnly: [],
      allowedFor: {},
    });
    const bot = { ...FORM, id: TEST_ID, mcpServers: [] };
    const names = async (runOpts) =>
      (await c._resolveTools(bot, runOpts)).tools.map((t) => t.name);
    const real = await names({});
    const test = await names({ test: true });
    assert.ok(real.includes("claim_task"));
    assert.equal(test.includes("claim_task"), false);
    assert.ok(test.includes("send_result"));
  });

  it("a failed test says why and has no sample", async () => {
    const c = fake({ status: "failed" });
    const out = await c.test(FORM, { testId: TEST_ID });
    assert.equal(out.status, "failed");
    assert.equal(out.error, "Web search isn't connected");
    assert.equal(out.sample, undefined);
  });
});

describe("testing a saved bot", () => {
  it("runs the form's changes over the saved bot and keeps the sample", async () => {
    const c = fake();
    const saved = c._store.create(FORM);
    const out = await c.test(
      { id: saved.id, instructions: "Find five deals." },
      { testId: TEST_ID },
    );
    const { opts, dirThere } = c.asked[0];
    assert.equal(opts.bot.instructions, "Find five deals.");
    assert.equal(opts.bot.name, "Deal Finder");
    assert.equal(opts.bot.id, TEST_ID);
    assert.equal(opts.bot.ref, saved.ref);
    assert.equal(opts.chargeTo, saved.id);
    // Its own folder, left as it was.
    assert.equal(opts.workingDir, c._store.workingDir(saved.id));
    assert.equal(dirThere, true);
    assert.equal(fs.existsSync(opts.workingDir), true);
    assert.equal(out.sampleKept, true);
    assert.equal(c._store.getSample(saved.id).answer, DEALS);
    // The saved bot itself is unchanged.
    assert.equal(c._store.get(saved.id).instructions, FORM.instructions);
  });

  it("with unsaved changes (keep false), its sample waits for Save", async () => {
    const c = fake();
    const saved = c._store.create(FORM);
    const out = await c.test(
      { id: saved.id, instructions: "Find five deals." },
      { testId: TEST_ID, keep: false },
    );
    assert.equal(out.sample.answer, DEALS);
    assert.equal(out.sampleKept, undefined);
    assert.equal(c._store.getSample(saved.id), null);
  });
});

describe("what a test leaves alone", () => {
  it("reads memory but changes none", async () => {
    const { MEMORY_SERVER } = require("./memoryTools");
    const answers = [];
    const during = async (c, botId) => {
      for (const tool of ["memory_set", "memory_delete"]) {
        answers.push(
          await c._callTool(
            MEMORY_SERVER,
            tool,
            { key: "k", value: "v" },
            { botId, workspaceId: "ws_1" },
          ),
        );
      }
    };
    const c = fake({ during });
    // Anything that reached the real memory would land here.
    c._memory.set = () => assert.fail("memory was changed");
    c._memory.delete = () => assert.fail("memory was changed");
    await c.test(FORM, { testId: TEST_ID });
    for (const a of answers) {
      assert.match(a.text, /memory isn't changed/);
      assert.equal(a.isError, false);
    }
  });

  it("isn't listed as a bot running (the quit dialog, the tray)", async () => {
    let listed = null;
    const during = async (c) => {
      listed = c.listRunning();
    };
    const c = fake({ during });
    c._runner.listActive = () => [TEST_ID, "bot_9"];
    c._runner.startedAt = () => null;
    await c.test(FORM, { testId: TEST_ID });
    assert.deepEqual(
      listed.map((r) => r.id),
      ["bot_9"],
    );
  });
});

describe("what a test refuses", () => {
  it("a missing id, a form that isn't a bot yet, a lead or the Dash team", async () => {
    const c = fake();
    assert.match((await c.test(FORM, {})).error, /no id/);
    assert.match((await c.test(FORM, { testId: "bot_123456" })).error, /no id/);
    assert.match(
      (await c.test({ name: "x" }, { testId: TEST_ID })).error,
      /can't be tested yet/,
    );
    assert.match(
      (await c.test({ ...FORM, role: "lead" }, { testId: TEST_ID })).error,
      /isn't tested here/,
    );
    assert.match(
      (await c.test({ ...FORM, system: "dash-team" }, { testId: TEST_ID }))
        .error,
      /isn't tested here/,
    );
    assert.deepEqual(c.asked, []);
  });

  it("only Pause all, or a budget used up, stops it", () => {
    const c = fake();
    const unsaved = { bot: FORM, chargeTo: null };
    const saved = { bot: FORM, chargeTo: "bot_1" };
    // Paused on its own: still tested.
    c._pause.isPaused = () => true;
    assert.equal(c._testBlocked(unsaved), null);
    // The saved bot's own limit.
    c._budgets.isOverBudget = (id) => id === "bot_1";
    assert.equal(c._testBlocked(unsaved), null);
    assert.equal(c._testBlocked(saved), "this bot is over its budget");
    // A bot never saved: its dashboard's or the global limit.
    c._budgets.isOverBudget = (id, ws) => id === null && ws === "ws_1";
    assert.equal(c._testBlocked(unsaved), "the budget is used up");
    c._pause.isGloballyPaused = () => true;
    assert.equal(c._testBlocked(unsaved), "all bots are paused");
  });
});

describe("an approval during a test", () => {
  it("Always allow isn't kept: the bot may never be saved", () => {
    const c = fake();
    c._testBots = new Map([[TEST_ID, { bot: FORM, chargeTo: null }]]);
    const resolved = [];
    c._approvals = {
      get: () => ({
        request: { botId: TEST_ID, serverName: "gmail", toolName: "send" },
      }),
      resolve: (id, d) => {
        resolved.push(d);
        return true;
      },
    };
    const res = c.approve("a1", { allow: true, remember: true });
    assert.equal(res.remembered, false);
    assert.equal(resolved[0].remember, false);
  });
});

describe("a sample sent with Create", () => {
  it("is kept apart from the definition", () => {
    const c = fake();
    c._appId = null;
    c._scheduler = { register() {} };
    c._pause.pauseBot = () => {};
    c._logAudit = () => {};
    c._botCheckContext = () => ({
      existing: null,
      connections: null,
      knownAiProvider: () => true,
      cronValid: () => true,
      widgetOnDashboard: () => true,
      botExists: () => false,
      toolsOf: () => null,
    });
    const sample = { at: "t", answer: DEALS, results: [], shape: {} };
    const saved = c.save({ ...FORM, sample });
    assert.equal(c._store.get(saved.id).sample, undefined);
    assert.deepEqual(c._store.getSample(saved.id), sample);
    // Not a sample: the bot saves, nothing else is kept.
    const other = c.save({ ...FORM, name: "Two", sample: { answer: 3 } });
    assert.equal(c._store.getSample(other.id), null);
  });
});
