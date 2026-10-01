/**
 * claudeAgentEngine.test.js — Claude Agent SDK engine wrapper (P1: FR-007).
 * The ESM SDK is replaced with a fake `query` via the test seam.
 */
"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const claudeAgentEngine = require("./claudeAgentEngine");

function makeQuery(messages) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m;
    },
    interrupt() {},
    close() {},
  };
}

let captured = null;
function stubQuery(messages) {
  claudeAgentEngine.__setQueryForTest((args) => {
    captured = args;
    return makeQuery(messages);
  });
}

async function collect(stream) {
  const out = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

function ctx(over = {}) {
  return {
    botId: "bot_1",
    prompt: "do the thing",
    model: "claude-opus-4-8",
    systemPrompt: "You are a helpful bot.",
    workingDir: "/tmp/bot_1/files",
    approvalPolicy: "allow",
    signal: null,
    ...over,
  };
}

afterEach(() => {
  claudeAgentEngine.__setQueryForTest(null);
  captured = null;
});

describe("claudeAgentEngine", () => {
  it("is registered as claude-agent with native-tool capabilities", () => {
    assert.equal(claudeAgentEngine.id, "claude-agent");
    assert.equal(claudeAgentEngine.capabilities.builtInTools, true);
    assert.equal(claudeAgentEngine.capabilities.nativeSessions, true);
  });

  it("maps SDK messages to normalized BotEvents", async () => {
    stubQuery([
      {
        type: "assistant",
        session_id: "sess_1",
        message: {
          content: [
            { type: "text", text: "working on it" },
            { type: "tool_use", id: "t1", name: "Read", input: { path: "x" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: "the file",
              is_error: false,
            },
          ],
        },
      },
      {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]);

    const events = await collect(claudeAgentEngine.run(ctx()));
    const types = events.map((e) => e.type);
    assert.deepEqual(types, [
      "text",
      "tool_call",
      "tool_result",
      "session",
      "done",
    ]);
    assert.deepEqual(events[1], {
      type: "tool_call",
      id: "t1",
      name: "Read",
      input: { path: "x" },
    });
    assert.deepEqual(events[2], {
      type: "tool_result",
      id: "t1",
      output: "the file",
      isError: false,
    });
    assert.deepEqual(events[3], { type: "session", session: { id: "sess_1" } });
    assert.deepEqual(events[4].usage, { inputTokens: 10, outputTokens: 5 });
    assert.equal(events[4].stopReason, "success");
  });

  it("passes model, systemPrompt, cwd and resume through to the SDK", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    await collect(claudeAgentEngine.run(ctx({ session: { id: "sess_9" } })));
    assert.equal(captured.options.model, "claude-opus-4-8");
    assert.equal(captured.options.systemPrompt, "You are a helpful bot.");
    assert.equal(captured.options.cwd, "/tmp/bot_1/files");
    assert.equal(captured.options.resume, "sess_9");
    assert.equal(typeof captured.options.canUseTool, "function");
  });

  // Isolation: a bot must only see its built-in tools + the Dash providers it
  // was granted — never the user's personal Claude Code settings, plugins,
  // skills, MCP servers, or claude.ai connectors (seen live: a bot told the
  // user to "authorize the Gmail connector in your claude.ai settings").
  it("isolates the run from the user's Claude Code settings + MCP config", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    await collect(claudeAgentEngine.run(ctx()));
    assert.deepEqual(captured.options.settingSources, []);
    assert.equal(captured.options.strictMcpConfig, true);
    assert.equal(
      captured.options.env && captured.options.env.ENABLE_CLAUDEAI_MCP_SERVERS,
      "false",
    );
  });

  it("passes the bot's API key per run — never via process-global env", async () => {
    const before = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      stubQuery([{ type: "result", subtype: "success", usage: {} }]);
      await collect(
        claudeAgentEngine.run(ctx({ credentials: { apiKey: "sk-bot-1" } })),
      );
      assert.equal(captured.options.env.ANTHROPIC_API_KEY, "sk-bot-1");
      assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = before;
    }
  });

  it("without a bot API key, does not inject one (Claude Code login is used)", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    await collect(claudeAgentEngine.run(ctx()));
    // Inherits whatever the environment had; the engine adds none.
    assert.equal(
      captured.options.env.ANTHROPIC_API_KEY,
      process.env.ANTHROPIC_API_KEY,
    );
  });

  // Bridged Dash provider tools (mcp__bot-mcp__*) must go through the SAME
  // Dash permission gate as the tool-loop engine (ctx.requestPermission), so
  // remembered approvals ("Always allow") and grants apply. Regression: the
  // engine's hook bypassed the gate and asked every time.
  it("routes bridged provider tools through ctx.requestPermission", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    const seen = [];
    let approvals = 0;
    await collect(
      claudeAgentEngine.run(
        ctx({
          approvalPolicy: "ask",
          requestPermission: async (name, input) => {
            seen.push({ name, input });
            return { allow: true };
          },
          createApproval: () => {
            approvals++;
            return { promise: Promise.resolve({ allow: false }) };
          },
        }),
      ),
    );
    const res = await captured.options.canUseTool(
      "mcp__bot-mcp__search_emails",
      { q: "is:unread" },
    );
    assert.equal(res.behavior, "allow");
    assert.deepEqual(seen, [
      { name: "search_emails", input: { q: "is:unread" } },
    ]);
    assert.equal(approvals, 0); // the gate decided — no extra prompt
  });

  it("denies a bridged tool when the Dash gate denies it", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    await collect(
      claudeAgentEngine.run(
        ctx({
          approvalPolicy: "ask",
          requestPermission: async () => ({ allow: false, reason: "no grant" }),
        }),
      ),
    );
    const res = await captured.options.canUseTool(
      "mcp__bot-mcp__send_email",
      {},
    );
    assert.equal(res.behavior, "deny");
    assert.match(res.message, /no grant/);
  });

  it("built-in tools (e.g. Bash) still ask via the approval queue every time", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    let gateCalls = 0;
    const created = [];
    await collect(
      claudeAgentEngine.run(
        ctx({
          approvalPolicy: "ask",
          requestPermission: async () => {
            gateCalls++;
            return { allow: true };
          },
          createApproval: (req) => {
            created.push(req);
            return { promise: Promise.resolve({ allow: true }) };
          },
        }),
      ),
    );
    const res = await captured.options.canUseTool("Bash", { command: "ls" });
    assert.equal(res.behavior, "allow");
    assert.equal(gateCalls, 0);
    assert.equal(created.length, 1);
    assert.equal(created[0].toolName, "Bash");
  });

  it("canUseTool auto-allows when approvalPolicy is allow", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    await collect(claudeAgentEngine.run(ctx({ approvalPolicy: "allow" })));
    const d = await captured.options.canUseTool("Bash", { command: "ls" });
    assert.deepEqual(d, { behavior: "allow", updatedInput: { command: "ls" } });
  });

  it("canUseTool routes through the approval queue when policy is ask", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    let seen = null;
    const c = ctx({
      approvalPolicy: "ask",
      createApproval: (req) => {
        seen = req;
        return { id: "a1", promise: Promise.resolve({ allow: true }) };
      },
    });
    await collect(claudeAgentEngine.run(c));
    const d = await captured.options.canUseTool("Bash", { command: "ls" });
    assert.equal(d.behavior, "allow");
    assert.equal(seen.toolName, "Bash");
    assert.equal(seen.botId, "bot_1");
  });

  it("canUseTool denies when the approval is refused", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    const c = ctx({
      approvalPolicy: "ask",
      createApproval: () => ({
        id: "a1",
        promise: Promise.resolve({ allow: false, reason: "nope" }),
      }),
    });
    await collect(claudeAgentEngine.run(c));
    const d = await captured.options.canUseTool("Bash", {});
    assert.equal(d.behavior, "deny");
    assert.match(d.message, /nope/);
  });

  it("emits an error event when the SDK throws", async () => {
    claudeAgentEngine.__setQueryForTest(() => {
      throw new Error("boom");
    });
    const events = await collect(claudeAgentEngine.run(ctx()));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.match(events[0].message, /boom/);
  });
});
