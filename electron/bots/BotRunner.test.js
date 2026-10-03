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

  // Bots view (TEAM-011): a run is a conversation turn — its prompt, which
  // tools it used (never their arguments or results), and whether it
  // continued the previous conversation.
  it("records the prompt and whether the run continued a conversation", async () => {
    const engine = mockEngine([{ type: "done", stopReason: "end_turn" }]);
    const { runner } = makeRunner(engine);
    const fresh = await runner.run("bot_1", { prompt: "Check my inbox" });
    assert.equal(fresh.prompt, "Check my inbox");
    assert.equal(fresh.continued, false);
    const reply = await runner.run("bot_1", {
      prompt: "And yesterday?",
      continueSession: true,
    });
    assert.equal(reply.continued, true);
  });

  it("records a tool-call summary — tool, provider, ok — never args or results", async () => {
    const engine = mockEngine([
      {
        type: "tool_call",
        id: "t1",
        name: "search_emails",
        input: { q: "SECRET QUERY" },
      },
      {
        type: "tool_result",
        id: "t1",
        output: "SECRET RESULT",
        isError: false,
      },
      {
        type: "tool_call",
        id: "t2",
        name: "mcp__bot-mcp__read_email",
        input: {},
      },
      { type: "tool_result", id: "t2", output: "nope", isError: true },
      { type: "tool_call", id: "t3", name: "Bash", input: { command: "ls" } },
      { type: "done", stopReason: "end_turn" },
    ]);
    const { runner } = makeRunner(engine, {
      deps: {
        resolveTools: async () => ({
          tools: [],
          resolveServer: (n) =>
            ["search_emails", "read_email"].includes(n) ? "Gmail New" : null,
        }),
      },
    });
    const record = await runner.run("bot_1", { prompt: "go" });
    assert.deepEqual(record.toolCalls, [
      { tool: "search_emails", provider: "Gmail New", ok: true },
      { tool: "read_email", provider: "Gmail New", ok: false },
      // A built-in with no result yet → not known to have succeeded.
      { tool: "Bash", provider: null, ok: null },
    ]);
    assert.doesNotMatch(JSON.stringify(record.toolCalls), /SECRET/);
  });

  it("keeps the run's answer (its text) on the run record", async () => {
    const engine = mockEngine([
      { type: "text", text: "Found " },
      { type: "tool_call", name: "x" },
      { type: "text", text: "3 important emails." },
      { type: "done", stopReason: "end_turn" },
    ]);
    const { runner, runs } = makeRunner(engine);
    const record = await runner.run("bot_1", { prompt: "go" });
    assert.equal(record.output, "Found 3 important emails.");
    assert.equal(runs[0].run.output, "Found 3 important emails.");
  });

  it("separates text written before and after a tool call", async () => {
    const engine = mockEngine([
      { type: "text", text: "I'll check what you " },
      { type: "text", text: "prefer." },
      { type: "tool_call", id: "t1", name: "team_list_bots" },
      { type: "tool_result", id: "t1", output: "ok" },
      { type: "text", text: "Done" },
      { type: "done", stopReason: "end_turn" },
    ]);
    const { runner } = makeRunner(engine);
    const record = await runner.run("bot_1", { prompt: "go" });
    assert.equal(record.output, "I'll check what you prefer.\n\nDone");
  });

  it("caps a long answer to its last 8 KB", async () => {
    const long = "a".repeat(9000) + "END";
    const engine = mockEngine([
      { type: "text", text: long },
      { type: "done", stopReason: "end_turn" },
    ]);
    const { runner } = makeRunner(engine);
    const record = await runner.run("bot_1", { prompt: "go" });
    assert.ok(record.output.length < 8300);
    assert.ok(record.output.endsWith("END"));
  });

  it("a team lead runs with no built-in engine tools", async () => {
    const engine = mockEngine([{ type: "done", stopReason: "end_turn" }]);
    const { runner } = makeRunner(engine, { bot: { role: "lead" } });
    await runner.run("bot_1", { prompt: "what happened?" });
    assert.equal(engine.lastCtx.builtinTools, "none");
  });

  it("ordinary bots keep the engine's built-in tools", async () => {
    const engine = mockEngine([{ type: "done", stopReason: "end_turn" }]);
    const { runner } = makeRunner(engine);
    await runner.run("bot_1", { prompt: "go" });
    assert.equal(engine.lastCtx.builtinTools, undefined);
  });

  it("passes the bot id (and workspace) to callTool so per-bot tool limits can be enforced", async () => {
    const engine = mockEngine([{ type: "done", stopReason: "end_turn" }]);
    const seen = [];
    const { runner } = makeRunner(engine, {
      deps: {
        callTool: async (serverName, toolName, args, opts) => {
          seen.push({ serverName, toolName, opts });
          return { text: "ok" };
        },
      },
    });
    await runner.run("bot_1", { prompt: "go" });
    await engine.lastCtx.executeTool("search_repositories", { q: "x" });
    assert.deepEqual(seen, [
      {
        serverName: "github",
        toolName: "search_repositories",
        opts: { workspaceId: "ws_1", botId: "bot_1" },
      },
    ]);
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
  // A run (manual / scheduled / event) does the bot's job against current
  // data, so it starts a FRESH conversation. Regression: runs resumed the last
  // conversation and a scheduled email check answered "I've already finished"
  // without checking again. Continuing a conversation is opt-in
  // (continueSession) — the reply-to-continue path.
  it("starts fresh by default, even with a stored session for this engine", async () => {
    const engine = mockEngine([{ type: "done" }]);
    const { runner } = makeRunner(engine, {
      bot: { session: { engine: "tool-loop", state: { messages: ["prev"] } } },
    });
    await runner.run("bot_1", {});
    assert.equal(engine.lastCtx.session, null);
  });

  it("resumes the stored session when continueSession is set and the engine matches", async () => {
    const engine = mockEngine([{ type: "done" }]);
    const { runner } = makeRunner(engine, {
      bot: { session: { engine: "tool-loop", state: { messages: ["prev"] } } },
    });
    await runner.run("bot_1", { continueSession: true });
    assert.deepEqual(engine.lastCtx.session, { messages: ["prev"] });
  });

  it("ignores stored session from a different engine (even when continuing)", async () => {
    const engine = mockEngine([{ type: "done" }]);
    const { runner } = makeRunner(engine, {
      bot: { session: { engine: "claude-agent", state: { foo: 1 } } },
    });
    await runner.run("bot_1", { continueSession: true });
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

  it("startedAt reports when the running bot's run began (Bot monitor)", async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const engine = mockEngine([{ type: "done" }], gate);
    const { runner } = makeRunner(engine);
    assert.equal(runner.startedAt("bot_1"), null);
    const p1 = runner.run("bot_1", {});
    assert.equal(typeof runner.startedAt("bot_1"), "string");
    assert.ok(!Number.isNaN(Date.parse(runner.startedAt("bot_1"))));
    release();
    await p1;
    assert.equal(runner.startedAt("bot_1"), null);
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

describe("BotRunner — run record extras (TEAM-011 gaps)", () => {
  it("records what triggered an event run", async () => {
    const engine = mockEngine([{ type: "done" }]);
    const { runner, runs } = makeRunner(engine);
    const source = {
      eventType: "Gmail[w1].newEmail",
      label: "Gmail › new email",
      originBotId: null,
      chain: [],
    };
    await runner.run("bot_1", { trigger: "event", source });
    assert.deepEqual(runs[0].run.source, source);
  });

  it("has no source for other runs", async () => {
    const engine = mockEngine([{ type: "done" }]);
    const { runner, runs } = makeRunner(engine);
    await runner.run("bot_1", {});
    assert.equal(runs[0].run.source, undefined);
  });

  it("records each approval decision (engine and permission-gate paths)", async () => {
    const decisions = [
      { allow: true },
      { allow: true, remember: true },
      { allow: false, reason: "denied by user" },
    ];
    let n = 0;
    const approvals = {
      create: () => ({ id: "a" + n, promise: Promise.resolve(decisions[n++]) }),
    };
    let gateCreate = null;
    const engine = {
      id: "tool-loop",
      run(ctx) {
        return (async function* () {
          // Built-in tool via the engine's channel.
          await ctx.createApproval({ toolName: "Bash" }).promise;
          // Provider tools via the permission gate's channel.
          await gateCreate({ serverName: "Slack", toolName: "send_message" })
            .promise;
          await gateCreate({ serverName: "Gmail New", toolName: "send_email" })
            .promise;
          yield { type: "done" };
        })();
      },
    };
    const { runner, runs } = makeRunner(engine, {
      deps: {
        approvals,
        makeRequestPermission: (opts) => {
          gateCreate = opts.createApproval;
          return async () => ({ allow: true });
        },
      },
    });
    await runner.run("bot_1", {});
    assert.deepEqual(runs[0].run.approvals, [
      { tool: "Bash", provider: null, decision: "allowed" },
      { tool: "send_message", provider: "Slack", decision: "allowed-always" },
      { tool: "send_email", provider: "Gmail New", decision: "denied" },
    ]);
  });

  it("records no approvals when none were asked", async () => {
    const engine = mockEngine([{ type: "done" }]);
    const { runner, runs } = makeRunner(engine);
    await runner.run("bot_1", {});
    assert.deepEqual(runs[0].run.approvals, []);
  });
});

describe("BotRunner — via (TEAM-004)", () => {
  it("records who asked when given (the AI Assistant)", async () => {
    const { runner, runs } = makeRunner(mockEngine([{ type: "done" }]));
    await runner.run("bot_1", { trigger: "ask", via: "assistant" });
    assert.equal(runs[0].run.via, "assistant");
  });

  it("has no via otherwise", async () => {
    const { runner, runs } = makeRunner(mockEngine([{ type: "done" }]));
    await runner.run("bot_1", { trigger: "ask" });
    assert.equal(runs[0].run.via, undefined);
  });
});
