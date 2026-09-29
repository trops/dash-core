/**
 * BotRunner.test.js
 *
 * Pins the run loop with a mock engine and mock collaborators (no Electron):
 * event streaming, session persistence, run-log append, failure handling,
 * session resume gating, and skip-if-running.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const BotRunner = require("./BotRunner");

// A mock engine whose run() yields the given events. If `gate` is provided,
// it awaits the gate before yielding anything (to hold a run "in progress").
function mockEngine(events, gate) {
  const engine = {
    id: "tool-loop",
    lastCtx: null,
    run(ctx) {
      engine.lastCtx = ctx;
      return (async function* () {
        if (gate) await gate;
        for (const e of events) yield e;
      })();
    },
  };
  return engine;
}

function makeRunner(engine, over = {}) {
  const saved = [];
  const runs = [];
  const bots = {
    bot_1: {
      id: "bot_1",
      instructions: "do it",
      provider: null,
      model: null,
      mcpServers: ["github"],
      allowedTools: [],
      workspaceId: "ws_1",
      ...(over.bot || {}),
    },
  };
  const runner = new BotRunner({
    engines: { getEngine: (id) => (id === "tool-loop" ? engine : null) },
    store: {
      get: (id) => bots[id] || null,
      saveSession: (id, eng, state) => saved.push({ id, eng, state }),
      appendRun: (id, run) => {
        runs.push({ id, run });
        return run;
      },
    },
    approvals: {
      create: () => ({ id: "a1", promise: Promise.resolve({ allow: false }) }),
    },
    resolveRunProfile: async () => ({
      providerId: "anthropic",
      engineId: over.engineId || "tool-loop",
      adapterId: "anthropic",
      baseURL: undefined,
      model: "claude-opus-4-8",
      credentials: { apiKey: "sk" },
    }),
    resolveTools: async () => ({ tools: [], resolveServer: () => "github" }),
    callTool: async () => ({ text: "ok" }),
    // Stub so the real PermissionGate (and its lazy electron require) is never touched.
    makeRequestPermission: () => async () => ({ allow: true }),
    ...(over.deps || {}),
  });
  return { runner, saved, runs, bots };
}

async function collectEmit(runnerRunPromiseFactory) {
  const events = [];
  const record = await runnerRunPromiseFactory((e) => events.push(e));
  return { events, record };
}

describe("BotRunner.run — happy path", () => {
  it("streams events, saves session, and appends a completed run", async () => {
    const engine = mockEngine([
      { type: "text", text: "hi" },
      { type: "session", session: { messages: [1] } },
      { type: "done", stopReason: "end_turn", usage: { inputTokens: 3 } },
    ]);
    const { runner, saved, runs } = makeRunner(engine);
    const { events, record } = await collectEmit((emit) =>
      runner.run("bot_1", { prompt: "go", emit }),
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ["text", "session", "done"],
    );
    assert.deepEqual(saved, [
      { id: "bot_1", eng: "tool-loop", state: { messages: [1] } },
    ]);
    assert.equal(record.status, "completed");
    assert.deepEqual(record.usage, { inputTokens: 3 });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].run.trigger, "manual");
  });

  it("passes the run prompt, model, and instructions into the engine ctx", async () => {
    const engine = mockEngine([{ type: "done", stopReason: "end_turn" }]);
    const { runner } = makeRunner(engine);
    await runner.run("bot_1", { prompt: "summarize" });
    assert.equal(engine.lastCtx.prompt, "summarize");
    assert.equal(engine.lastCtx.model, "claude-opus-4-8");
    assert.equal(engine.lastCtx.systemPrompt, "do it");
    assert.equal(engine.lastCtx.adapterId, "anthropic");
    assert.ok(engine.lastCtx.signal); // AbortSignal present
  });
});

describe("BotRunner.run — failures", () => {
  it("marks a run failed when the engine emits an error event", async () => {
    const engine = mockEngine([{ type: "error", message: "boom", code: "X" }]);
    const { runner, runs } = makeRunner(engine);
    const record = await runner.run("bot_1", {});
    assert.equal(record.status, "failed");
    assert.equal(record.error, "boom");
    assert.equal(runs[0].run.status, "failed");
  });

  it("marks a run failed (and emits error) when a collaborator throws", async () => {
    const engine = mockEngine([{ type: "done" }]);
    const { runner } = makeRunner(engine, {
      deps: {
        resolveRunProfile: async () => {
          throw new Error("no creds");
        },
      },
    });
    const events = [];
    const record = await runner.run("bot_1", { emit: (e) => events.push(e) });
    assert.equal(record.status, "failed");
    assert.match(record.error, /no creds/);
    assert.ok(events.some((e) => e.type === "error"));
  });

  it("fails cleanly when the resolved engine is not registered", async () => {
    const engine = mockEngine([{ type: "done" }]);
    const { runner } = makeRunner(engine, { engineId: "claude-agent" });
    const record = await runner.run("bot_1", {});
    assert.equal(record.status, "failed");
    assert.match(record.error, /no engine registered/);
  });

  it("throws for an unknown bot id", async () => {
    const { runner } = makeRunner(mockEngine([]));
    await assert.rejects(() => runner.run("bot_nope", {}), /no bot/);
  });
});

describe("BotRunner.run — session resume gating", () => {
  it("passes stored session state when the engine matches", async () => {
    const engine = mockEngine([{ type: "done" }]);
    const { runner } = makeRunner(engine, {
      bot: { session: { engine: "tool-loop", state: { messages: ["prev"] } } },
    });
    await runner.run("bot_1", {});
    assert.deepEqual(engine.lastCtx.session, { messages: ["prev"] });
  });

  it("ignores stored session from a different engine", async () => {
    const engine = mockEngine([{ type: "done" }]);
    const { runner } = makeRunner(engine, {
      bot: { session: { engine: "claude-agent", state: { foo: 1 } } },
    });
    await runner.run("bot_1", {});
    assert.equal(engine.lastCtx.session, null);
  });
});

describe("BotRunner.run — one run per bot", () => {
  it("skips a second run while the first is in progress", async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const engine = mockEngine([{ type: "done" }], gate);
    const { runner, runs } = makeRunner(engine);

    const p1 = runner.run("bot_1", {}); // _active set synchronously
    assert.equal(runner.isRunning("bot_1"), true);

    const r2 = await runner.run("bot_1", {});
    assert.equal(r2.skipped, true);
    assert.match(r2.reason, /already in progress/);

    release();
    await p1;
    assert.equal(runner.isRunning("bot_1"), false);
    // Only the first run produced a run-log entry.
    assert.equal(runs.length, 1);
  });

  it("abort() returns true for a running bot, false otherwise", async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const engine = mockEngine([{ type: "done" }], gate);
    const { runner } = makeRunner(engine);
    assert.equal(runner.abort("bot_1"), false); // not running yet
    const p1 = runner.run("bot_1", {});
    assert.equal(runner.abort("bot_1"), true); // running → aborted
    release();
    await p1;
  });

  it("listActive reports the running bot id, empty otherwise", async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const engine = mockEngine([{ type: "done" }], gate);
    const { runner } = makeRunner(engine);
    assert.deepEqual(runner.listActive(), []);
    const p1 = runner.run("bot_1", {});
    assert.deepEqual(runner.listActive(), ["bot_1"]);
    release();
    await p1;
    assert.deepEqual(runner.listActive(), []);
  });
});

describe("BotRunner — usage hook (budgets)", () => {
  it("calls onUsage with provider/model/usage after a run that reported usage", async () => {
    const engine = mockEngine([
      {
        type: "done",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 4 },
      },
    ]);
    const seen = [];
    const { runner } = makeRunner(engine, {
      deps: { onUsage: (u) => seen.push(u) },
    });
    await runner.run("bot_1", {});
    assert.equal(seen.length, 1);
    assert.equal(seen[0].botId, "bot_1");
    assert.equal(seen[0].workspaceId, "ws_1");
    assert.equal(seen[0].providerId, "anthropic");
    assert.equal(seen[0].model, "claude-opus-4-8");
    assert.deepEqual(seen[0].usage, { inputTokens: 10, outputTokens: 4 });
  });

  it("does not call onUsage when a run reports no usage", async () => {
    const engine = mockEngine([{ type: "done", stopReason: "end_turn" }]);
    const seen = [];
    const { runner } = makeRunner(engine, {
      deps: { onUsage: (u) => seen.push(u) },
    });
    await runner.run("bot_1", {});
    assert.equal(seen.length, 0);
  });
});

describe("BotRunner construction", () => {
  it("requires its core collaborators", () => {
    assert.throws(() => new BotRunner({}), /missing dependency/);
  });
});
