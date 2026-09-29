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
  }

  isRunning(botId) {
    return this._active.has(botId);
  }

  listActive() {
    return [...this._active.keys()];
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
    const controller = new AbortController();
    this._active.set(botId, controller);

    let status = "completed";
    let usage = null;
    let errorMessage = null;
    let runProfile = null;

    try {
      const profile = await this._resolveRunProfile(bot);
      runProfile = profile;
      const engine = this._engines.getEngine(profile.engineId);
      if (!engine) {
        throw new Error(`no engine registered for "${profile.engineId}"`);
      }

      const { tools, resolveServer } = await this._resolveTools(bot);

      const requestPermission = this._makeRequestPermission({
        botId,
        workspaceId: bot.workspaceId,
        allowedTools: bot.allowedTools || [],
        mcpServers: bot.mcpServers || [],
        internalServers: this._internalServers,
        resolveServer,
        createApproval: (request) => this._approvals.create(request),
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
        });
      };

      // Resume only when the stored session was produced by this engine.
      const session =
        bot.session && bot.session.engine === engine.id
          ? bot.session.state
          : null;

      const ctx = {
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
      };

      for await (const event of engine.run(ctx)) {
        emit(event);
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
    }

    const runRecord = {
      trigger,
      status,
      startedAt,
      endedAt: this._now(),
      usage,
      error: errorMessage,
    };
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
