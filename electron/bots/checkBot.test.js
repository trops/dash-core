/**
 * checkBot.test.js — one check for every bot save, before anything is
 * written (consolidation Phase 1d), and every new bot starts paused.
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Cron } = require("croner");
const { checkBot } = require("./checkBot");

const cronValid = (expr) => {
  try {
    new Cron(expr, { paused: true }).stop();
    return true;
  } catch (_e) {
    return false;
  }
};
const widgetSub = (over = {}) => ({
  eventType: "acme.panel.Ask[7].asked",
  label: "Ask › asked",
  source: {
    kind: "widget",
    ref: "acme.panel.Ask",
    instanceId: "7",
    event: "asked",
    workspaceId: "1",
    ...over,
  },
});
const ctx = (over = {}) => ({
  connections: ["Gmail", "Slack"],
  knownAiProvider: (id) => ["claude-code", "anthropic"].includes(id),
  cronValid,
  widgetOnDashboard: (ws, id) => ws === "1" && id === "7",
  widgetSends: (component) =>
    component === "acme.panel.Ask" ? ["asked"] : null,
  botExists: (id) => id === "bot_2",
  ...over,
});
const bot = (over = {}) => ({
  name: "Digest",
  instructions: "Summarise my email.",
  ...over,
});

describe("checkBot", () => {
  it("a good bot passes", () => {
    const r = checkBot(
      bot({
        mcpServers: ["Gmail"],
        provider: "claude-code",
        schedules: [{ cron: "0 8 * * *", prompt: "go" }],
        subscriptions: [widgetSub()],
      }),
      ctx(),
    );
    assert.deepEqual(r, { errors: [], warnings: [] });
  });

  it("its shape is checked, as before", () => {
    const r = checkBot({ name: "", instructions: "" }, ctx());
    assert.ok(r.errors.length > 0);
  });

  it("a schedule that isn't a valid cron is refused", () => {
    const r = checkBot(bot({ schedules: [{ cron: "every morning" }] }), ctx());
    assert.match(r.errors.join(" "), /"every morning" isn't a valid schedule/);
  });

  it("a connection you don't have is refused", () => {
    const r = checkBot(bot({ mcpServers: ["Gmail", "Notion"] }), ctx());
    assert.match(
      r.errors.join(" "),
      /uses the connection "Notion", which you don't have/,
    );
  });

  it("an AI provider the app doesn't know is refused", () => {
    const r = checkBot(bot({ provider: "nope-ai" }), ctx());
    assert.match(r.errors.join(" "), /AI provider "nope-ai"/);
  });

  it("a widget trigger must point at a widget on that dashboard that sends the event", () => {
    const gone = checkBot(
      bot({ subscriptions: [widgetSub({ instanceId: "9" })] }),
      ctx(),
    );
    assert.match(gone.errors.join(" "), /isn't on that dashboard/);
    const wrong = checkBot(
      bot({ subscriptions: [widgetSub({ event: "clicked" })] }),
      ctx(),
    );
    assert.match(wrong.errors.join(" "), /doesn't send "clicked"/);
  });

  it("a bot trigger must point at a bot that exists", () => {
    const sub = {
      eventType: "bot.bot_9.done",
      label: "Other › done",
      source: {
        kind: "bot",
        ref: "other",
        instanceId: "bot_9",
        event: "done",
        workspaceId: "1",
      },
    };
    const r = checkBot(bot({ subscriptions: [sub] }), ctx());
    assert.match(r.errors.join(" "), /bot that isn't there any more/);
  });

  it("only what's new or changed is held to it — an old dead trigger or connection only warns", () => {
    const existing = bot({
      id: "bot_1",
      mcpServers: ["Notion"],
      subscriptions: [widgetSub({ instanceId: "9" })],
    });
    const r = checkBot({ ...existing, name: "Digest 2" }, ctx({ existing }));
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 2);
  });

  it("checks it can't make are skipped, not failed", () => {
    const r = checkBot(
      bot({
        mcpServers: ["Anything"],
        subscriptions: [widgetSub({ ref: "x.y.Z" })],
      }),
      { cronValid },
    );
    assert.deepEqual(r.errors, []);
  });
});

// ---- the controller's save(), run with a fake store (electron stubbed) ----
const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_checkbot__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_checkbot__"] = {
  id: "__stub_electron_checkbot__",
  filename: "__stub_electron_checkbot__",
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

function fakeController(over = {}) {
  const bots = new Map();
  let n = 0;
  const paused = new Set();
  const writes = [];
  const self = {
    writes,
    paused,
    _store: {
      get: (id) => bots.get(id) || null,
      list: () => [...bots.values()],
      create: (def) => {
        writes.push("create");
        const saved = { ...def, id: `bot_${++n}` };
        bots.set(saved.id, saved);
        return saved;
      },
      update: (id, patch) => {
        writes.push("update");
        const saved = { ...bots.get(id), ...patch, id };
        bots.set(id, saved);
        return saved;
      },
    },
    _scheduler: { register: () => {} },
    _pause: {
      pauseBot: (id) => paused.add(id),
      isPaused: (id) => paused.has(id),
      isGloballyPaused: () => false,
    },
    _logAudit: () => {},
    _botCheckContext: (existing) => ({ ...ctx(), existing }),
    ...over,
  };
  self.save = botController.save.bind(self);
  return self;
}

describe("save() — checked before anything is written; new bots start paused", () => {
  it("a bot that fails the check isn't written, and says why", () => {
    const c = fakeController();
    assert.throws(
      () => c.save(bot({ schedules: [{ cron: "every morning" }] })),
      /Digest wasn't saved[\s\S]*isn't a valid schedule/,
    );
    assert.deepEqual(c.writes, []);
  });

  it("a new bot is saved paused", () => {
    const c = fakeController();
    const saved = c.save(bot());
    assert.ok(c.paused.has(saved.id));
  });

  it("an edit doesn't pause a bot that's on", () => {
    const c = fakeController();
    const saved = c.save(bot());
    c.paused.delete(saved.id);
    c.save({ id: saved.id, name: "Digest 2" });
    assert.equal(c.paused.has(saved.id), false);
  });

  it("an edit is checked as the whole bot it makes (a partial save too)", () => {
    const c = fakeController();
    const saved = c.save(bot());
    assert.throws(
      () =>
        c.save({
          id: saved.id,
          subscriptions: [widgetSub({ instanceId: "9" })],
        }),
      /isn't on that dashboard/,
    );
  });
});

describe("Run now on a paused bot is a test run", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "controller", "botController.js"),
    "utf8",
  );
  it("a run you start goes ahead while the bot is paused (not while everything is)", () => {
    assert.match(src, /_testRuns/);
    const blocker = src.slice(
      src.indexOf("startBlocker: (botId) =>"),
      src.indexOf("resolveTools: (bot) =>"),
    );
    assert.match(blocker, /isGloballyPaused\(\)/);
    assert.match(blocker, /_testRuns/);
  });
  it("the permission gate lets the test run's tools through too", () => {
    const gate = src.slice(
      src.indexOf("      isPaused: (botId) =>"),
      src.indexOf("      costOf:"),
    );
    assert.match(gate, /_testRuns/);
  });
});

describe("screens say a new bot is paused, and Turn on", () => {
  const read = (...p) =>
    fs.readFileSync(path.join(__dirname, "..", "..", "src", ...p), "utf8");
  it("Create's bot form says it's paused until you turn it on", () => {
    assert.match(
      read("Components", "Dashboard", "DashboardStage.js"),
      /paused until you turn it on/,
    );
  });
  it("Resume reads Turn on — in the chat and the bot page", () => {
    assert.match(
      read("Components", "Bots", "BotChat.js"),
      /Turn on \$\{bot\.name\} to message it/,
    );
    assert.doesNotMatch(
      read("Components", "Bots", "BotChat.js"),
      /Resume \$\{bot\.name\} to message it/,
    );
    assert.match(
      read("Components", "Bots", "BotPage.js"),
      /isPaused \? "Turn on" : "Pause"/,
    );
  });
});

// Found live (Phase 1d): with no connections at all, a bot naming one is
// still refused — an empty list is "you have none", not "unknown".
describe("the save check's connections", () => {
  it("with no connections, a bot naming one isn't saved", () => {
    const r = checkBot(
      bot({ mcpServers: ["Gmail"] }),
      ctx({ connections: [] }),
    );
    assert.match(r.errors.join(" "), /"Gmail", which you don't have/);
  });
  it("the controller gives an empty list as empty, and only an error as unknown", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "controller", "botController.js"),
      "utf8",
    );
    const fn = src.slice(
      src.indexOf("  _botCheckContext("),
      src.indexOf("  delete(botId)"),
    );
    assert.doesNotMatch(fn, /providers\.length\s*\?/);
    assert.match(fn, /listProviders\(/);
  });
});

// Review fixes (Phase 1d).
describe("the controller's check context and test runs", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "controller", "botController.js"),
    "utf8",
  );
  it("an AI provider is checked against the registry itself (getProvider falls back)", () => {
    assert.match(src, /hasOwnProperty\.call\(AI_PROVIDERS, id\)/);
  });
  it("a widget trigger finds widgets inside containers, by the picker's id rule", () => {
    assert.match(src, /allWidgetItems\(ws\)\.some/);
    assert.match(src, /item\.uuidString \|\| item\.uuid/);
    assert.match(src, /walk\(item\.items\);\s*walk\(item\.layout\);/);
  });
  it("test runs are counted per bot, so a second Run now can't end the first's", () => {
    assert.match(src, /this\._testRuns = new Map\(\)/);
  });
  it("a team import checks every member before creating any", () => {
    const at = src.indexOf("  _installTeamPlan(");
    const fn = src.slice(at, at + 2500);
    assert.ok(
      fn.indexOf("checkBot(") > -1 &&
        fn.indexOf("checkBot(") < fn.indexOf("this.save("),
    );
    assert.match(fn, /The team wasn't installed/);
  });
  it("a global pause says so", () => {
    assert.match(src, /return "all bots are paused"/);
  });
});
