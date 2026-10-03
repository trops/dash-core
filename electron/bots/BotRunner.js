/**
 * BotRunner.js
 *
 * Executes a bot in the main process by driving the tool-loop engine (Slice 1)
 * with a fully-built RunContext (PRD FR-002 / US-002). One active run per bot;
 * streams normalized BotEvents to a caller-supplied `emit`; persists engine
 * session state (US-005) and appends a run record after every run; supports
 * abort.
 *
 * Portable (NFR-006): every Electron-coupled collaborator is injected —
 * provider/credential resolution, tool discovery, and MCP tool execution. The
 * only static dependency is the (portable) bot PermissionGate factory. The
 * Electron wiring lives in electron/controller/botController.js.
 *
 * Injected deps:
 *   engines            { getEngine(id) }                       — engine registry
 *   store              BotStore                                — get/saveSession/appendRun
 *   approvals          ApprovalRegistry                        — create(request)
 *   resolveRunProfile  async (bot) => { engineId, adapterId, baseURL, model, credentials, providerId }
 *   resolveTools       async (bot) => { tools, resolveServer(toolName) => serverName|null }
 *   callTool           async (serverName, toolName, args, { workspaceId }) => { text, isError }
 *   audit?             (entry) => void
 *   now?               () => string (ISO)
 *   makeRequestPermission? / gate?  — test seams (default: real PermissionGate)
 */
"use strict";

const { createRequestPermission } = require("./PermissionGate");
const { truncateText } = require("./botEvents");

class BotRunner {
  constructor(deps = {}) {
    for (const req of [
      "engines",
      "store",
      "approvals",
      "resolveRunProfile",
      "resolveTools",
      "callTool",
    ]) {
      if (!deps[req]) throw new Error(`BotRunner: missing dependency "${req}"`);
    }
    this._engines = deps.engines;
    this._store = deps.store;
    this._approvals = deps.approvals;
    this._resolveRunProfile = deps.resolveRunProfile;
    this._resolveTools = deps.resolveTools;
    this._callTool = deps.callTool;
    this._audit = deps.audit || (() => {});
    this._now = deps.now || (() => new Date().toISOString());
    this._makeRequestPermission =
      deps.makeRequestPermission || createRequestPermission;
    this._gate = deps.gate; // forwarded to PermissionGate ctx (optional)
    // Virtual servers whose tools are auto-allowed (e.g. "bot-memory") — the
    // bot's own sandbox, not external actions. Forwarded to the gate ctx.
    this._internalServers = deps.internalServers || [];
    this._isPaused = deps.isPaused || (() => false);
    // Called after each run with the run's token usage so budgets (Slice 5)
    // can accrue cost. Optional — default no-op keeps the runner portable.
    this._onUsage = deps.onUsage || null;
    /** @type {Map<string, AbortController>} */
    this._active = new Map();
    /** @type {Map<string, string>} botId → ISO start of its in-flight run */
    this._startedAt = new Map();
  }

  isRunning(botId) {
    return this._active.has(botId);
  }

  listActive() {
    return [...this._active.keys()];
  }

  /** When the bot's in-flight run started (ISO), or null when idle. */
  startedAt(botId) {
    return this._startedAt.get(botId) || null;
  }

  /** Abort an in-flight run. @returns {boolean} whether a run was aborted */
  abort(botId) {
    const controller = this._active.get(botId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Run a bot to completion.
   * @param {string} botId
   * @param {{ prompt?: string, trigger?: string, emit?: (e: object) => void }} opts
   * @returns {Promise<object>} the appended run record (or a skip marker)
   */
  async run(botId, opts = {}) {
    const emit = typeof opts.emit === "function" ? opts.emit : () => {};

    if (this._active.has(botId)) {
      const skip = {
        botId,
        skipped: true,
        reason: "a run is already in progress",
      };
      emit({ type: "skipped", reason: skip.reason });
      return skip;
    }

    const bot = this._store.get(botId);
    if (!bot) throw new Error(`BotRunner.run: no bot "${botId}"`);

    const trigger = opts.trigger || "manual";
    const startedAt = this._now();
    // Approval decisions made during this run, for the run record (Bots view
    // › Activity). Names only — never the tool's input.
    const approvalLog = [];
    const createApproval = (request) => {
      const pending = this._approvals.create(request);
      Promise.resolve(pending && pending.promise)
        .then((decision) => {
          approvalLog.push({
            tool: (request && request.toolName) || "tool",
            provider: (request && request.serverName) || null,
            decision:
              decision && decision.allow
                ? decision.remember
                  ? "allowed-always"
                  : "allowed"
                : "denied",
          });
        })
        .catch(() => {});
      return pending;
    };
    const controller = new AbortController();
    this._active.set(botId, controller);
    this._startedAt.set(botId, startedAt);

    let status = "completed";
    let usage = null;
    let errorMessage = null;
    let runProfile = null;
    // The run's answer (its text), kept on the run record — what a team lead
    // reads back. Capped to the last 8 KB; the store seals it at rest.
    const answer = [];
    // Tool-call summary for the conversation view: tool, provider, ok —
    // never arguments or results (they can hold email content).
    const toolCalls = [];
    const callIndex = new Map();
    let providerOf = () => null;

    try {
      const profile = await this._resolveRunProfile(bot);
      runProfile = profile;
      const engine = this._engines.getEngine(profile.engineId);
      if (!engine) {
        throw new Error(`no engine registered for "${profile.engineId}"`);
      }

      const { tools, resolveServer } = await this._resolveTools(bot);
      providerOf = (name) => {
        try {
          return resolveServer(name) || null;
        } catch (_e) {
          return null;
        }
      };

      const requestPermission = this._makeRequestPermission({
        botId,
        workspaceId: bot.workspaceId,
        allowedTools: bot.allowedTools || [],
        mcpServers: bot.mcpServers || [],
        internalServers: this._internalServers,
        resolveServer,
        createApproval,
        audit: this._audit,
        isPaused: () => this._isPaused(botId),
        gate: this._gate,
      });

      const executeTool = async (toolName, input) => {
        const serverName = resolveServer(toolName);
        if (!serverName) {
          return {
            text: `No MCP server for tool "${toolName}".`,
            isError: true,
          };
        }
        return this._callTool(serverName, toolName, input, {
          workspaceId: bot.workspaceId,
          // Lets the caller apply this bot's per-provider tool limits.
          botId,
        });
      };

      // A run does the bot's job against current data → fresh conversation.
      // Resume only when explicitly continuing (reply-to-continue) AND the
      // stored session was produced by this engine. Anything a bot should
      // carry between runs belongs in its memory tools.
      const session =
        opts.continueSession && bot.session && bot.session.engine === engine.id
          ? bot.session.state
          : null;

      const ctx = {
        botId,
        prompt: opts.prompt,
        model: profile.model,
        credentials: profile.credentials,
        adapterId: profile.adapterId,
        baseURL: profile.baseURL,
        systemPrompt: bot.instructions,
        tools,
        session,
        maxTurns: bot.maxTurns,
        signal: controller.signal,
        requestPermission,
        executeTool,
        workspaceId: bot.workspaceId,
        // For engines with their own agent loop + native tools (claude-agent):
        // a sandbox dir, the approval policy, and a direct approval channel.
        workingDir: profile.workingDir,
        approvalPolicy: bot.approvalPolicy,
        createApproval,
      };
      // A team lead is read-only: only its team tools, never the engine's
      // built-ins (shell, files, web…) — bot-teams TEAM-002 AC4.
      if (bot.role === "lead") ctx.builtinTools = "none";

      for await (const event of engine.run(ctx)) {
        emit(event);
        if (event.type === "text" && event.text) answer.push(event.text);
        if (event.type === "tool_call" && event.name) {
          // Bridged tools arrive as "mcp__bot-mcp__<tool>" on the agent engine.
          const tool = String(event.name).replace(
            /^mcp__[^_]+(?:-[^_]+)*__/,
            "",
          );
          callIndex.set(event.id, toolCalls.length);
          toolCalls.push({ tool, provider: providerOf(tool), ok: null });
        } else if (event.type === "tool_result" && callIndex.has(event.id)) {
          toolCalls[callIndex.get(event.id)].ok = !event.isError;
        }
        if (event.type === "session") {
          this._store.saveSession(botId, engine.id, event.session);
        } else if (event.type === "done") {
          usage = event.usage || null;
        } else if (event.type === "error") {
          status = "failed";
          errorMessage = event.message;
        }
      }
    } catch (err) {
      status = "failed";
      errorMessage = err.message || String(err);
      emit({
        type: "error",
        message: errorMessage,
        code: err.code || "RUNNER_ERROR",
      });
    } finally {
      this._active.delete(botId);
      this._startedAt.delete(botId);
    }

    const runRecord = {
      trigger,
      status,
      startedAt,
      endedAt: this._now(),
      usage,
      error: errorMessage,
      output: truncateText(answer.join("")),
      // The conversation turn (Bots view, TEAM-011). The store seals the
      // prompt at rest like the answer.
      prompt: truncateText(opts.prompt || ""),
      continued: !!opts.continueSession,
      toolCalls,
      approvals: approvalLog,
    };
    // What triggered an event run (event label, publishing bot, chain).
    if (opts.source) runRecord.source = opts.source;
    // Who asked, when not the user directly (e.g. "assistant" — TEAM-004).
    if (opts.via) runRecord.via = opts.via;
    this._store.appendRun(botId, runRecord);

    // Feed usage to budgets (Slice 5). Optional hook; only when we captured
    // usage and know which provider/model produced it.
    if (usage && runProfile && this._onUsage) {
      this._onUsage({
        botId,
        workspaceId: bot.workspaceId,
        providerId: runProfile.providerId,
        model: runProfile.model,
        usage,
      });
    }

    return runRecord;
  }
}

module.exports = BotRunner;
