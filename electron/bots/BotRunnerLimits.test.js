/**
 * BotRunnerLimits.test.js — Settings › AI in the run loop: the style and
 * limits from the run profile reach the engine, a run stopped by a limit
 * says which and isn't retried, and the time limit stops a run.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const BotRunner = require("./BotRunner");

function makeRunner(engine, profile = {}) {
  const runs = [];
  const bot = {
    id: "bot_1",
    instructions: "do it",
    provider: null,
    model: null,
    mcpServers: [],
    allowedTools: [],
    workspaceId: "ws_1",
  };
  const runner = new BotRunner({
    engines: { getEngine: () => engine },
    store: {
      get: (id) => (id === "bot_1" ? bot : null),
      saveSession: () => {},
      appendRun: (id, run) => {
        runs.push(run);
        return run;
      },
    },
    approvals: {
      create: () => ({ id: "a1", promise: Promise.resolve({ allow: false }) }),
    },
    resolveRunProfile: async () => ({
      providerId: "anthropic",
      engineId: "claude-agent",
      model: "claude-haiku-5-5",
      credentials: { apiKey: "sk" },
      ...profile,
    }),
    resolveTools: async () => ({ tools: [], resolveServer: () => null }),
    callTool: async () => ({ text: "ok" }),
    makeRequestPermission: () => async () => ({ allow: true }),
    // No waiting between attempts.
    sleep: async () => {},
  });
  return { runner, runs };
}

function engineYielding(events) {
  const engine = {
    id: "claude-agent",
    calls: 0,
    lastCtx: null,
    run(ctx) {
      engine.calls++;
      engine.lastCtx = ctx;
      return (async function* () {
        for (const e of events) yield e;
      })();
    },
  };
  return engine;
}

describe("BotRunner — Settings › AI", () => {
  it("passes the style, step and cost limits, effort and cache to the engine", async () => {
    const engine = engineYielding([{ type: "done", stopReason: "end" }]);
    const { runner } = makeRunner(engine, {
      styleLine: "Keep your final answer to a line or two.",
      effort: "low",
      maxTurns: 25,
      maxCostUsd: 1,
      longCache: true,
    });
    await runner.run("bot_1", { prompt: "go" });
    const ctx = engine.lastCtx;
    assert.match(
      ctx.systemPrompt,
      /^do it\n\nKeep your final answer to a line or two\.\n\nToday is \w+day, /,
    );
    assert.equal(ctx.effort, "low");
    assert.equal(ctx.maxTurns, 25);
    assert.equal(ctx.maxCostUsd, 1);
    assert.equal(ctx.longCache, true);
  });

  it("keeps the instructions as they are without a style", async () => {
    const engine = engineYielding([{ type: "done", stopReason: "end" }]);
    const { runner } = makeRunner(engine);
    await runner.run("bot_1", { prompt: "go" });
    assert.match(engine.lastCtx.systemPrompt, /^do it\n\nToday is /);
    assert.equal(engine.lastCtx.effort, null);
    assert.equal(engine.lastCtx.maxCostUsd, null);
  });

  it("a run stopped by a limit fails with its note and isn't retried", async () => {
    const note =
      "Stopped after 25 steps — its step limit. Raise it in Settings › AI › Run limits, or on this bot.";
    const engine = engineYielding([
      {
        type: "error",
        code: "RUN_LIMIT",
        message: note,
        usage: { inputTokens: 4 },
      },
    ]);
    const { runner, runs } = makeRunner(engine, { maxTurns: 25 });
    const events = [];
    const record = await runner.run("bot_1", {
      prompt: "go",
      emit: (e) => events.push(e),
    });
    assert.equal(engine.calls, 1);
    assert.equal(record.status, "failed");
    assert.equal(record.error, note);
    assert.deepEqual(record.usage, { inputTokens: 4 });
    assert.equal(runs.length, 1);
    assert.ok(events.some((e) => e.type === "error" && e.message === note));
  });

  it("the time limit stops a run and says so", async () => {
    // An engine that runs until it's stopped.
    const engine = {
      id: "claude-agent",
      run(ctx) {
        return (async function* () {
          yield { type: "text", text: "working" };
          await new Promise((resolve) => {
            if (ctx.signal.aborted) return resolve();
            ctx.signal.addEventListener("abort", resolve, { once: true });
          });
        })();
      },
    };
    // 0.0005 minutes = 30 ms.
    const { runner } = makeRunner(engine, { maxMinutes: 0.0005 });
    const record = await runner.run("bot_1", { prompt: "go" });
    assert.equal(record.status, "failed");
    assert.match(
      record.error,
      /^Stopped after 0\.0005 minutes — its time limit\./,
    );
  });

  it("a run the user stops is still just stopped", async () => {
    const engine = {
      id: "claude-agent",
      run(ctx) {
        return (async function* () {
          yield { type: "text", text: "working" };
          await new Promise((resolve) =>
            ctx.signal.addEventListener("abort", resolve, { once: true }),
          );
        })();
      },
    };
    const { runner } = makeRunner(engine, { maxMinutes: 10 });
    const pending = runner.run("bot_1", { prompt: "go" });
    await new Promise((r) => setTimeout(r, 10));
    runner.abort("bot_1");
    const record = await pending;
    assert.equal(record.status, "stopped");
    assert.equal(record.error, null);
  });
});

describe("BotRunner — time limit and approvals", () => {
  it("waiting on the user's approval doesn't count toward the time limit", async () => {
    let decide;
    const engine = {
      id: "claude-agent",
      run(ctx) {
        return (async function* () {
          // Ask for approval and wait longer than the limit (60 ms).
          const p = ctx.createApproval({ toolName: "send" });
          setTimeout(() => decide({ allow: true }), 150);
          await p.promise;
          yield { type: "done", stopReason: "end" };
        })();
      },
    };
    const runs = [];
    const runner = new BotRunner({
      engines: { getEngine: () => engine },
      store: {
        get: () => ({ id: "bot_1", instructions: "x", mcpServers: [] }),
        saveSession: () => {},
        appendRun: (id, run) => {
          runs.push(run);
          return run;
        },
      },
      approvals: {
        create: () => ({
          id: "a1",
          promise: new Promise((res) => {
            decide = res;
          }),
        }),
      },
      resolveRunProfile: async () => ({
        providerId: "anthropic",
        engineId: "claude-agent",
        model: "m",
        credentials: {},
        maxMinutes: 0.001, // 60 ms
      }),
      resolveTools: async () => ({ tools: [], resolveServer: () => null }),
      callTool: async () => ({ text: "ok" }),
      makeRequestPermission: () => async () => ({ allow: true }),
      sleep: async () => {},
    });
    const record = await runner.run("bot_1", { prompt: "go" });
    assert.equal(record.status, "completed");
  });

  it("gives engines the run's cost so far", async () => {
    const engine = engineYielding([{ type: "done", stopReason: "end" }]);
    const runner = new BotRunner({
      engines: { getEngine: () => engine },
      store: {
        get: () => ({ id: "bot_1", instructions: "x", mcpServers: [] }),
        saveSession: () => {},
        appendRun: (id, run) => run,
      },
      approvals: { create: () => ({ id: "a", promise: Promise.resolve({}) }) },
      resolveRunProfile: async () => ({
        providerId: "anthropic",
        engineId: "tool-loop",
        model: "m",
        credentials: {},
      }),
      resolveTools: async () => ({ tools: [], resolveServer: () => null }),
      callTool: async () => ({ text: "ok" }),
      makeRequestPermission: () => async () => ({ allow: true }),
      costOf: ({ usage }) => ({ usd: usage.inputTokens / 1000 }),
    });
    await runner.run("bot_1", { prompt: "go" });
    assert.equal(engine.lastCtx.costSoFar({ inputTokens: 2500 }), 2.5);
    assert.equal(engine.lastCtx.costSoFar(null), 0);
  });
});
