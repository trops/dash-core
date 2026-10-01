/**
 * claudeAgentEngine.js
 *
 * A BotEngine backed by the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`),
 * giving bots native file/shell/code tools and SDK-managed sessions (PRD FR-007).
 * The provider-neutral tool-loop engine stays the default; a bot opts into this
 * engine via its `engine` field.
 *
 * Design (P1 MVP — built-in tools first):
 *  - The SDK is ESM-only, so it's loaded via dynamic import() at run time (a test
 *    seam lets tests inject a fake `query`). The module itself loads clean under
 *    plain Node (NFR-006) — nothing vendor-specific is required at load.
 *  - Tool permission routes through `canUseTool`, gated by the bot's
 *    approvalPolicy: "allow" runs tools without prompting; "ask" creates a
 *    pending approval via the same registry the Activity panel reads, and awaits.
 *  - The SDK's working directory is confined to the bot's sandbox (ctx.workingDir)
 *    so file ops default there. Bridging the bot's *configured MCP servers* into
 *    the SDK is deferred; this MVP uses the SDK's built-in tools.
 */
"use strict";

const { createEventStream } = require("./eventStream");
const { BOT_MCP_SERVER, buildBotMcpServer } = require("./agentToolBridge");

// Test seam: injected fake `query` implementation (see __setQueryForTest).
let _queryImpl = null;

/** @param {Function|null} fn */
function __setQueryForTest(fn) {
  _queryImpl = fn;
}

async function _loadQuery() {
  if (_queryImpl) return _queryImpl;
  const mod = await import("@anthropic-ai/claude-agent-sdk");
  return mod.query;
}

/** Extract normalized events from one SDK assistant message's content blocks. */
function* _fromAssistant(message) {
  const blocks = (message && message.content) || [];
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === "text" && b.text) {
      yield { type: "text", text: b.text };
    } else if (b.type === "tool_use") {
      yield { type: "tool_call", id: b.id, name: b.name, input: b.input };
    }
  }
}

/** Extract tool_result events from one SDK user message's content blocks. */
function* _fromUser(message) {
  const blocks = (message && message.content) || [];
  for (const b of blocks) {
    if (!b || b.type !== "tool_result") continue;
    let text = "";
    if (typeof b.content === "string") text = b.content;
    else if (Array.isArray(b.content)) {
      text = b.content
        .filter((c) => c && c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }
    yield {
      type: "tool_result",
      id: b.tool_use_id,
      output: text,
      isError: !!b.is_error,
    };
  }
}

/** Build the SDK canUseTool hook from the run context. */
function _makeCanUseTool(ctx) {
  return async function canUseTool(toolName, input) {
    if (ctx.signal && ctx.signal.aborted) {
      return { behavior: "deny", message: "run aborted" };
    }
    // Trusted bot → run tools without prompting.
    if (ctx.approvalPolicy === "allow") {
      return { behavior: "allow", updatedInput: input };
    }
    // Otherwise gate through the approval queue (shown in the Activity panel).
    if (typeof ctx.createApproval !== "function") {
      return { behavior: "deny", message: "no approval channel available" };
    }
    const { promise } = ctx.createApproval({
      botId: ctx.botId,
      workspaceId: ctx.workspaceId,
      toolName,
      input,
      engine: "claude-agent",
    });
    const decision = await promise;
    return decision && decision.allow
      ? { behavior: "allow", updatedInput: input }
      : {
          behavior: "deny",
          message: (decision && decision.reason) || "approval denied",
        };
  };
}

async function _runAgent(ctx, stream) {
  const query = await _loadQuery();

  // Per-run environment for the agent process. Auth: the Claude Code login by
  // default; a bot's Anthropic API key, when set, goes in THIS run's env only —
  // never process.env, which would leak it to the rest of the main process and
  // to other bots.
  const env = { ...process.env };
  if (ctx.credentials && ctx.credentials.apiKey) {
    env.ANTHROPIC_API_KEY = ctx.credentials.apiKey;
  }
  // No claude.ai connectors from the user's Claude login.
  env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";

  const options = {
    model: ctx.model,
    systemPrompt: ctx.systemPrompt || { type: "preset", preset: "claude_code" },
    permissionMode: "default",
    canUseTool: _makeCanUseTool(ctx),
    // Isolation: a bot sees only the SDK's built-in tools + the Dash providers
    // it was granted (bridged below as "bot-mcp"). Don't load the user's
    // ~/.claude settings/plugins/skills/hooks, and ignore every MCP config
    // other than the servers passed in `mcpServers`.
    settingSources: [],
    strictMcpConfig: true,
    env,
  };
  if (ctx.maxTurns) options.maxTurns = ctx.maxTurns;
  if (ctx.workingDir) options.cwd = ctx.workingDir;
  if (ctx.session && ctx.session.id) options.resume = ctx.session.id;

  // Bridge the bot's configured MCP tools into the SDK as an in-process MCP
  // server (proxying to ctx.executeTool). Best-effort — on failure the bot
  // still gets the SDK's built-in tools. canUseTool gates these too.
  if (ctx.tools && ctx.tools.length) {
    try {
      const [sdkMod, zodMod] = await Promise.all([
        import("@anthropic-ai/claude-agent-sdk"),
        import("zod"),
      ]);
      const z = zodMod.z || zodMod.default || zodMod;
      const server = buildBotMcpServer(
        ctx,
        { createSdkMcpServer: sdkMod.createSdkMcpServer, tool: sdkMod.tool },
        z,
      );
      if (server) options.mcpServers = { [BOT_MCP_SERVER]: server };
    } catch (_e) {
      // Fall back to built-in tools only.
    }
  }

  const q = query({ prompt: ctx.prompt || "", options });

  // Cooperative cancellation → SDK interrupt.
  if (ctx.signal) {
    ctx.signal.addEventListener("abort", () => {
      try {
        if (typeof q.interrupt === "function") q.interrupt();
      } catch (_e) {
        /* best effort */
      }
    });
  }

  let sessionId = null;
  let usage = null;
  let stopReason = "end";
  try {
    for await (const msg of q) {
      if (msg && msg.session_id) sessionId = msg.session_id;
      if (!msg) continue;
      if (msg.type === "assistant") {
        for (const ev of _fromAssistant(msg.message)) stream.push(ev);
      } else if (msg.type === "user") {
        for (const ev of _fromUser(msg.message)) stream.push(ev);
      } else if (msg.type === "result") {
        stopReason = msg.subtype || "end";
        const u = msg.usage || {};
        usage = {
          inputTokens: u.input_tokens || 0,
          outputTokens: u.output_tokens || 0,
        };
      }
      if (ctx.signal && ctx.signal.aborted) break;
    }
  } finally {
    if (typeof q.close === "function") {
      try {
        q.close();
      } catch (_e) {
        /* best effort */
      }
    }
  }

  if (sessionId) stream.push({ type: "session", session: { id: sessionId } });
  stream.push({ type: "done", stopReason, usage });
}

/** @type {import("./BotEngine").BotEngine} */
const claudeAgentEngine = {
  id: "claude-agent",
  capabilities: { builtInTools: true, skills: true, nativeSessions: true },

  run(ctx) {
    const stream = createEventStream();
    (async () => {
      try {
        await _runAgent(ctx, stream);
      } catch (err) {
        stream.push({
          type: "error",
          message: (err && err.message) || "Claude Agent engine error",
          code: (err && err.code) || "CLAUDE_AGENT_ERROR",
        });
      } finally {
        stream.end();
      }
    })();
    return stream;
  },
};

module.exports = claudeAgentEngine;
module.exports.__setQueryForTest = __setQueryForTest;
