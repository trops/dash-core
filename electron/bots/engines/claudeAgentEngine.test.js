/**
 * claudeAgentEngine.test.js — Claude Agent SDK engine wrapper (P1: FR-007).
 * The ESM SDK is replaced with a fake `query` via the test seam.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
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

// No real `which claude` in tests: default to "not installed".
beforeEach(() => {
  claudeAgentEngine.__setCliResolverForTest(() => null);
});

afterEach(() => {
  claudeAgentEngine.__setQueryForTest(null);
  claudeAgentEngine.__setCliResolverForTest(null);
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
    assert.deepEqual(events[4].usage, {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    assert.equal(events[4].stopReason, "success");
  });

  it("shows a placeholder for image parts of a tool result (CAP-001)", async () => {
    stubQuery([
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [
                { type: "text", text: "shoe.jpg" },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: Buffer.alloc(1024).toString("base64"),
                  },
                },
              ],
            },
          ],
        },
      },
      { type: "result", subtype: "success", usage: {} },
    ]);
    const events = await collect(claudeAgentEngine.run(ctx()));
    const result = events.find((e) => e.type === "tool_result");
    assert.equal(result.output, "shoe.jpg\n[image: image/jpeg, 1 KB]");
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

  // Claude connector providers: the user's own Claude account connectors,
  // only the granted ones, only on the Claude login.
  const calendar = {
    provider: "Google Calendar",
    server: "claude.ai Google Calendar",
    allowed: ["list_events"],
  };
  const withConnector = (over = {}) =>
    ctx({
      connectors: [calendar],
      connectorServers: [
        "claude.ai Gmail",
        "claude.ai Google Calendar",
        "claude.ai Slack",
      ],
      ...over,
    });

  it("a bot granted a Claude connector gets the account's connectors, the rest hidden", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    await collect(claudeAgentEngine.run(withConnector()));
    assert.equal(captured.options.env.ENABLE_CLAUDEAI_MCP_SERVERS, "true");
    assert.equal(captured.options.strictMcpConfig, false);
    assert.deepEqual(captured.options.settingSources, []);
    assert.deepEqual(captured.options.disallowedTools, [
      "mcp__claude_ai_Gmail",
      "mcp__claude_ai_Slack",
    ]);
  });

  it("connector tools: only the allowed ones, through the Dash gate", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    const asked = [];
    await collect(
      claudeAgentEngine.run(
        withConnector({
          approvalPolicy: "ask",
          requestPermission: async (name) => {
            asked.push(name);
            return { allow: true };
          },
        }),
      ),
    );
    const can = captured.options.canUseTool;
    const ok = await can("mcp__claude_ai_Google_Calendar__list_events", {});
    assert.equal(ok.behavior, "allow");
    assert.deepEqual(asked, ["mcp__claude_ai_Google_Calendar__list_events"]);
    const no = await can("mcp__claude_ai_Google_Calendar__delete_event", {});
    assert.equal(no.behavior, "deny");
    // A connector it wasn't granted is refused outright.
    const other = await can("mcp__claude_ai_Slack__send_message", {});
    assert.equal(other.behavior, "deny");
    assert.equal(asked.length, 1);
  });

  it("a connector run on an API key is refused with the reason", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    const events = await collect(
      claudeAgentEngine.run(withConnector({ credentials: { apiKey: "sk-x" } })),
    );
    const err = events.find((e) => e.type === "error");
    assert.equal(err.code, "CONNECTOR_NEEDS_SUBSCRIPTION");
    assert.match(
      err.message,
      /only works when this bot runs on your Claude subscription/,
    );
  });

  it("builtinTools 'none' disables every SDK built-in (team leads)", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    await collect(claudeAgentEngine.run(ctx({ builtinTools: "none" })));
    assert.deepEqual(captured.options.tools, []);
  });

  it("by default a bot gets only the standard built-ins, named explicitly", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    await collect(claudeAgentEngine.run(ctx()));
    assert.deepEqual(captured.options.tools, [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
      "WebFetch",
      "WebSearch",
      "TodoWrite",
      "NotebookEdit",
    ]);
  });

  for (const policy of ["ask", "allow"]) {
    it(`denies built-ins outside the list without asking (policy ${policy})`, async () => {
      stubQuery([{ type: "result", subtype: "success", usage: {} }]);
      const created = [];
      await collect(
        claudeAgentEngine.run(
          ctx({
            approvalPolicy: policy,
            createApproval: (req) => {
              created.push(req);
              return { promise: Promise.resolve({ allow: true }) };
            },
          }),
        ),
      );
      for (const name of [
        "RemoteTrigger",
        "Skill",
        "ToolSearch",
        "CronCreate",
        "Agent",
        "AskUserQuestion",
        "mcp__claude_ai_Slack__slack_send_message",
      ]) {
        const res = await captured.options.canUseTool(name, {});
        assert.equal(res.behavior, "deny", name);
      }
      assert.equal(created.length, 0);
    });
  }

  it("bridged Dash tools still reach the gate for a default bot", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    let asked = null;
    await collect(
      claudeAgentEngine.run(
        ctx({
          approvalPolicy: "ask",
          requestPermission: async (name) => {
            asked = name;
            return { allow: true };
          },
        }),
      ),
    );
    const res = await captured.options.canUseTool(
      "mcp__bot-mcp__slack_post",
      {},
    );
    assert.equal(res.behavior, "allow");
    assert.equal(asked, "slack_post");
  });

  it("with builtinTools 'none', a built-in that slips through is denied without asking", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    const created = [];
    await collect(
      claudeAgentEngine.run(
        ctx({
          builtinTools: "none",
          approvalPolicy: "allow", // even "allow" mustn't let it through
          createApproval: (req) => {
            created.push(req);
            return { promise: Promise.resolve({ allow: true }) };
          },
        }),
      ),
    );
    const res = await captured.options.canUseTool("Bash", { command: "ls" });
    assert.equal(res.behavior, "deny");
    assert.equal(created.length, 0);
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

  describe("Claude CLI binary", () => {
    it("runs the user's installed claude when one is found", async () => {
      claudeAgentEngine.__setCliResolverForTest(
        () => "/Users/me/.local/bin/claude",
      );
      stubQuery([{ type: "result", subtype: "success", usage: {} }]);
      await collect(claudeAgentEngine.run(ctx()));
      assert.equal(
        captured.options.pathToClaudeCodeExecutable,
        "/Users/me/.local/bin/claude",
      );
    });

    it("falls back to the SDK's bundled CLI when none is installed", async () => {
      stubQuery([{ type: "result", subtype: "success", usage: {} }]);
      await collect(claudeAgentEngine.run(ctx()));
      assert.equal("pathToClaudeCodeExecutable" in captured.options, false);
    });

    it("skips a Windows .cmd shim the SDK can't spawn", () => {
      assert.equal(
        claudeAgentEngine.usableCliPath(
          "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd",
          "win32",
        ),
        null,
      );
      assert.equal(
        claudeAgentEngine.usableCliPath(
          "C:\\Users\\me\\.local\\bin\\claude.exe",
          "win32",
        ),
        "C:\\Users\\me\\.local\\bin\\claude.exe",
      );
      assert.equal(
        claudeAgentEngine.usableCliPath("/usr/local/bin/claude", "darwin"),
        "/usr/local/bin/claude",
      );
      assert.equal(claudeAgentEngine.usableCliPath(null, "darwin"), null);
    });

    it("explains a missing bundled CLI in plain words", async () => {
      claudeAgentEngine.__setQueryForTest(() => {
        throw new Error(
          "Native CLI binary for darwin-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.",
        );
      });
      const events = await collect(claudeAgentEngine.run(ctx()));
      assert.equal(events[0].type, "error");
      assert.equal(events[0].code, "CLAUDE_CLI_NOT_FOUND");
      assert.match(events[0].message, /Claude Code CLI not found/);
      assert.doesNotMatch(events[0].message, /pathToClaudeCodeExecutable/);
    });
  });
});

describe("claudeAgentEngine — usage (CRE-012)", () => {
  it("reports cache tokens and the SDK's API-price cost", async () => {
    stubQuery([
      {
        type: "result",
        subtype: "success",
        session_id: "sess_2",
        total_cost_usd: 0.0123,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 800,
          cache_creation_input_tokens: 40,
        },
      },
    ]);
    const events = await collect(claudeAgentEngine.run(ctx()));
    const done = events.find((e) => e.type === "done");
    assert.deepEqual(done.usage, {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 800,
      cacheWriteTokens: 40,
      reportedUsd: 0.0123,
    });
  });
});

describe("claudeAgentEngine — read-only built-ins (CRE-011)", () => {
  it("keeps only Read, Glob and Grep", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    await collect(claudeAgentEngine.run(ctx({ builtinTools: "read-only" })));
    assert.deepEqual(captured.options.tools, ["Read", "Glob", "Grep"]);
  });

  it("denies any other built-in, even under allow; reads go through the policy", async () => {
    stubQuery([{ type: "result", subtype: "success", usage: {} }]);
    await collect(
      claudeAgentEngine.run(
        ctx({ builtinTools: "read-only", approvalPolicy: "allow" }),
      ),
    );
    const write = await captured.options.canUseTool("Write", {
      file_path: "/x",
    });
    assert.equal(write.behavior, "deny");
    const bash = await captured.options.canUseTool("Bash", { command: "ls" });
    assert.equal(bash.behavior, "deny");
    const read = await captured.options.canUseTool("Read", { file_path: "/x" });
    assert.equal(read.behavior, "allow");
  });
});

describe("claudeAgentEngine — a turn that ends on an API error (US-023)", () => {
  it("is an error event with its status, not an answer", async () => {
    stubQuery([
      { type: "system", subtype: "init", session_id: "s1" },
      {
        type: "assistant",
        error: "overloaded",
        session_id: "s1",
        message: {
          content: [
            {
              type: "text",
              text: 'API Error: 529 {"type":"overloaded_error"}',
            },
          ],
        },
      },
      {
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 529,
        result: 'API Error: 529 {"type":"overloaded_error"}',
        session_id: "s1",
        usage: { input_tokens: 4, output_tokens: 0 },
      },
    ]);
    const events = await collect(claudeAgentEngine.run(ctx()));
    assert.equal(
      events.some((e) => e.type === "text"),
      false,
    );
    assert.equal(
      events.some((e) => e.type === "done"),
      false,
    );
    const err = events.find((e) => e.type === "error");
    assert.equal(err.status, 529);
    assert.equal(err.code, "CLAUDE_API_ERROR");
    assert.match(err.message, /529/);
    assert.equal(err.usage.inputTokens, 4);
  });

  it("takes the status from the error kind when the result has none", async () => {
    stubQuery([
      {
        type: "assistant",
        error: "rate_limit",
        message: { content: [{ type: "text", text: "Rate limited" }] },
      },
      {
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Rate limited",
      },
    ]);
    const events = await collect(claudeAgentEngine.run(ctx()));
    assert.equal(events.find((e) => e.type === "error").status, 429);
  });

  it("a normal turn still ends with done", async () => {
    stubQuery([
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hi" }] },
      },
      { type: "result", subtype: "success", is_error: false, result: "Hi" },
    ]);
    const events = await collect(claudeAgentEngine.run(ctx()));
    assert.equal(
      events.some((e) => e.type === "error"),
      false,
    );
    assert.equal(events[events.length - 1].type, "done");
  });
});

describe("claudeAgentEngine — Settings › AI (style, limits, cache)", () => {
  const done = { type: "result", subtype: "success", result: "ok", usage: {} };

  it("passes effort, the step and cost limits, and the hour-long cache", async () => {
    stubQuery([done]);
    await collect(
      claudeAgentEngine.run(
        ctx({ effort: "low", maxTurns: 25, maxCostUsd: 1, longCache: true }),
      ),
    );
    assert.equal(captured.options.effort, "low");
    assert.equal(captured.options.maxTurns, 25);
    assert.equal(captured.options.maxBudgetUsd, 1);
    assert.equal(captured.options.env.ENABLE_PROMPT_CACHING_1H, "1");
  });

  it("leaves them out when they aren't set", async () => {
    stubQuery([done]);
    await collect(claudeAgentEngine.run(ctx()));
    assert.equal(captured.options.effort, undefined);
    assert.equal(captured.options.maxBudgetUsd, undefined);
    assert.equal(captured.options.env.ENABLE_PROMPT_CACHING_1H, undefined);
  });

  it("a run stopped by its step limit says so (RUN_LIMIT)", async () => {
    stubQuery([
      { type: "result", subtype: "error_max_turns", is_error: true, usage: {} },
    ]);
    const events = await collect(claudeAgentEngine.run(ctx({ maxTurns: 25 })));
    const err = events.find((e) => e.type === "error");
    assert.equal(err.code, "RUN_LIMIT");
    assert.match(err.message, /^Stopped after 25 steps — its step limit\./);
  });

  it("keeps the limit note when Claude Code then exits with an error", async () => {
    // The real SDK: the error result, then a throw once the CLI exits.
    claudeAgentEngine.__setQueryForTest((args) => {
      captured = args;
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "result",
            subtype: "error_max_turns",
            is_error: true,
            usage: {},
          };
          throw new Error(
            "Claude Code returned an error result: Reached maximum number of turns (1)",
          );
        },
        interrupt() {},
        close() {},
      };
    });
    const events = await collect(claudeAgentEngine.run(ctx({ maxTurns: 1 })));
    const errs = events.filter((e) => e.type === "error");
    assert.equal(errs.length, 1);
    assert.equal(errs[0].code, "RUN_LIMIT");
    assert.match(errs[0].message, /^Stopped after 1 step — its step limit\./);
  });

  it("tells a limit by the thrown text when no result came", async () => {
    claudeAgentEngine.__setQueryForTest(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error(
          "Claude Code returned an error result: Reached maximum number of turns (25)",
        );
      },
      interrupt() {},
      close() {},
    }));
    const events = await collect(claudeAgentEngine.run(ctx({ maxTurns: 25 })));
    const err = events.find((e) => e.type === "error");
    assert.equal(err.code, "RUN_LIMIT");
  });

  it("a run stopped by its cost limit says so (RUN_LIMIT)", async () => {
    stubQuery([
      {
        type: "result",
        subtype: "error_max_budget_usd",
        is_error: true,
        usage: { input_tokens: 5 },
      },
    ]);
    const events = await collect(claudeAgentEngine.run(ctx({ maxCostUsd: 1 })));
    const err = events.find((e) => e.type === "error");
    assert.equal(err.code, "RUN_LIMIT");
    assert.match(
      err.message,
      /^Stopped at \$1\.00 — its cost limit for one run\./,
    );
    assert.equal(err.usage.inputTokens, 5);
  });
});
