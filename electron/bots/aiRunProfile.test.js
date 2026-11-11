/**
 * aiRunProfile.test.js — Settings › AI in the real botController: what a
 * run is set up with (backend, model, engine, style, limits, cache), the
 * one-time move of bots that saved Claude Code only as the default, and the
 * `ai` settings patch. Electron is stubbed, like botProfiles.test.js.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-aiprof-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_aiprof__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_aiprof__"] = {
  id: "__stub_electron_aiprof__",
  filename: "__stub_electron_aiprof__",
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

function fake({ ai, bots = [] } = {}) {
  let settings = ai ? { ai } : {};
  const byId = new Map(bots.map((b) => [b.id, { ...b }]));
  return {
    _appId: "app",
    _botsRoot: "/tmp/bots",
    _getMainWindow: () => null,
    _providers: {
      listProviders: () => ({
        providers: [
          {
            type: "anthropic",
            isDefaultForType: true,
            credentials: { apiKey: "sk-test" },
          },
        ],
      }),
    },
    _store: {
      getSettings: () => settings,
      setSettings: (patch) => {
        settings = { ...settings, ...patch };
        return settings;
      },
      get: (id) => byId.get(id) || null,
      list: () => [...byId.values()],
      update: (id, patch) => byId.set(id, { ...byId.get(id), ...patch }),
    },
    settings: () => settings,
    bot: (id) => byId.get(id),
  };
}

const profile = (self, bot) =>
  botController._resolveRunProfile.call(self, { id: "bot_1", ...bot });

describe("the run profile — Settings › AI", () => {
  it("with nothing set: Claude Code, Opus as before, the built-in step and time limits, no cost cap", () => {
    const p = profile(fake(), { provider: null });
    assert.equal(p.providerId, "claude-code");
    assert.equal(p.engineId, "claude-agent");
    assert.equal(p.model, "claude-opus-5-5");
    assert.equal(p.effort, null);
    assert.equal(p.maxTurns, 25);
    assert.equal(p.maxMinutes, 20);
    assert.equal(p.maxCostUsd, null);
  });

  it("on the API key: a bot follows it onto the Claude Agent engine with its job's model and style", () => {
    const self = fake({
      ai: {
        backend: "api",
        defaults: { bots: { model: "claude-haiku-5-5", style: "brief" } },
      },
    });
    const p = profile(self, { provider: null });
    assert.equal(p.providerId, "anthropic");
    assert.equal(p.engineId, "claude-agent");
    assert.deepEqual(p.credentials, { apiKey: "sk-test" });
    assert.equal(p.model, "claude-haiku-5-5");
    assert.equal(p.effort, "low");
    assert.equal(p.styleLine, "Keep your final answer to a line or two.");
    // Paid per run: the cost cap applies.
    assert.equal(p.maxCostUsd, 1);
  });

  it("a bot's own provider, model and engine still win", () => {
    const self = fake({
      ai: {
        backend: "api",
        defaults: { bots: { model: "claude-haiku-5-5" } },
      },
    });
    const p = profile(self, {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
    assert.equal(p.model, "claude-sonnet-5-5");
    // Chose the API key itself: its engine comes from the provider, as before.
    assert.equal(p.engineId, "tool-loop");
    const own = profile(self, { provider: "claude-code" });
    assert.equal(own.providerId, "claude-code");
    assert.equal(own.maxCostUsd, null);
  });

  it("Create's roles: their job's default, else their tier; the higher step limit and the hour cache", () => {
    const self = fake({
      ai: { defaults: { planner: { model: "claude-sonnet-5-5" } } },
    });
    const planner = profile(self, { system: "dash-team", role: "planner" });
    assert.equal(planner.model, "claude-sonnet-5-5");
    assert.equal(planner.maxTurns, 80);
    assert.equal(planner.longCache, true);
    const scout = profile(self, { system: "dash-team", role: "scout" });
    assert.equal(scout.model, "claude-haiku-5-5");
  });

  it("a weekly bot keeps the 5-minute cache; an every-15-minutes one the hour", () => {
    const self = fake();
    assert.equal(
      profile(self, { schedules: [{ cron: "30 7 * * 0" }] }).longCache,
      false,
    );
    assert.equal(
      profile(self, { schedules: [{ cron: "*/15 * * * *" }] }).longCache,
      true,
    );
  });

  it("no effort for a model that doesn't take it", () => {
    const self = fake({
      ai: {
        defaults: { bots: { model: "claude-haiku-4-5", style: "brief" } },
      },
    });
    const p = profile(self, {});
    assert.equal(p.effort, null);
    // The answer-length line still applies.
    assert.ok(p.styleLine);
  });
});

describe("the run profile — review fixes", () => {
  it("a bot on another AI provider doesn't get a Claude default model", () => {
    const self = fake({
      ai: { defaults: { bots: { model: "claude-haiku-5-5" } } },
    });
    const p = profile(self, { provider: "openai" });
    assert.equal(p.providerId, "openai");
    assert.notEqual(p.model, "claude-haiku-5-5");
  });

  it("on the API key with no key saved: a clear error, never the Claude login", () => {
    const self = fake({ ai: { backend: "api" } });
    self._providers.listProviders = () => ({ providers: [] });
    assert.throws(() => profile(self, { provider: null }), /no key is saved/);
  });

  it("Create's roles get the effort but not the answer-length line", () => {
    const self = fake({
      ai: {
        defaults: { checker: { model: "claude-sonnet-5-5", style: "brief" } },
      },
    });
    const p = profile(self, { system: "dash-team", role: "checker" });
    assert.equal(p.effort, "low");
    assert.equal(p.styleLine, null);
  });
});

describe("followDefaultOnce", () => {
  it("moves bots that saved Claude Code as the default, once", () => {
    const self = fake({
      bots: [
        { id: "a", provider: "claude-code", model: null, engine: null },
        { id: "b", provider: "claude-code", model: "claude-opus-5-5" },
      ],
    });
    const moved = botController.followDefaultOnce.call(self);
    assert.deepEqual(moved, ["a"]);
    assert.equal(self.bot("a").provider, null);
    assert.equal(self.bot("b").provider, "claude-code");
    assert.equal(self.settings().ai.migrated, true);
    // Never again — a bot later set to Claude Code on purpose keeps it.
    self.bot("a").provider = "claude-code";
    assert.deepEqual(botController.followDefaultOnce.call(self), []);
    assert.equal(self.bot("a").provider, "claude-code");
  });
});

describe("setBotSettings — ai", () => {
  it("merges the Settings › AI patch", () => {
    const self = fake();
    botController.setBotSettings.call(self, {
      ai: { backend: "api", limits: { perBot: 10 } },
    });
    botController.setBotSettings.call(self, {
      ai: { defaults: { bots: { model: "claude-haiku-5-5" } } },
    });
    const ai = self.settings().ai;
    assert.equal(ai.backend, "api");
    assert.equal(ai.limits.perBot, 10);
    assert.equal(ai.defaults.bots.model, "claude-haiku-5-5");
  });
});
