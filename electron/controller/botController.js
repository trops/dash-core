/**
 * botController.js
 *
 * Main-process wiring for Bot Factory (the IPC target). Thin Electron glue: it
 * assembles the portable pieces — BotStore, ApprovalRegistry, the engine
 * registry, BotRunner, and BotScheduler — with real collaborators (MCP tool
 * execution via mcpController, provider credentials via providerController,
 * schedules via croner) and exposes the operations the `bots:*` IPC handlers
 * (registered in dash-electron) call. All the tested logic lives in the
 * injected/portable modules; this file is the boundary.
 */
"use strict";

const { Cron } = require("croner");
const { createElectronHost } = require("../bots/host");
const BotStore = require("../bots/BotStore");
const ApprovalRegistry = require("../bots/approvals");
const engines = require("../bots/engines");
const BotRunner = require("../bots/BotRunner");
const BotScheduler = require("../bots/BotScheduler");
const BudgetController = require("../bots/BudgetController");
const PauseController = require("../bots/PauseController");
const { BotMemory } = require("../bots/BotMemory");
const {
  MEMORY_SERVER,
  MEMORY_TOOLS,
  handleMemoryTool,
} = require("../bots/memoryTools");
const { matchSubscribedBots } = require("../bots/eventMatcher");
const { EventDispatcher } = require("../bots/EventDispatcher");
const { normalizeMcpResult } = require("../bots/mcpResult");
const {
  getProvider,
  getDefaultModel,
  getCuratedModels,
  migrateModelId,
  DEFAULT_PROVIDER,
} = require("../llm/modelProviders");
const {
  BOT_STREAM,
  BOT_APPROVAL_PENDING,
  BOT_BUDGET_ALERT,
  BOT_RUN_ACTIVE,
} = require("../events/botEvents");

/** Pricing lookup for BudgetController: curated-model pricing by provider. */
function pricingFor(providerId, model) {
  const m = getCuratedModels(providerId).find((c) => c.value === model);
  return (m && m.pricing) || null;
}

/** Build the run prompt for an event-triggered bot (P1: FR-009). */
function composeEventPrompt(event) {
  let payload;
  try {
    payload =
      event.content === undefined
        ? "(no payload)"
        : JSON.stringify(event.content);
  } catch (_e) {
    payload = "(unserializable payload)";
  }
  return (
    `An event you subscribe to just fired.\n\n` +
    `Event: ${event.eventType}\n` +
    `Payload: ${payload}\n\n` +
    `Follow your instructions to handle it.`
  );
}

const botController = {
  _ready: false,

  /**
   * @param {{
   *   getWindows: () => Electron.BrowserWindow[],
   *   getMainWindow?: () => Electron.BrowserWindow,
   *   mcpController: object,
   *   providerController: object,
   *   appId: string
   * }} deps
   */
  init(deps) {
    if (this._ready) return;
    const {
      getWindows,
      getMainWindow,
      mcpController,
      providerController,
      appId,
    } = deps;
    this._getWindows = getWindows || (() => []);
    this._getMainWindow = getMainWindow || (() => null);
    this._mcp = mcpController;
    this._providers = providerController;
    this._appId = appId;

    const host = createElectronHost();
    this._store = new BotStore({
      persistence: host.persistence,
      paths: host.paths,
      clock: host.clock,
    });

    // Wrap the approval registry so a newly-created approval is broadcast to
    // the renderer for the Activity Manager queue (Slice 7 UI).
    const approvals = new ApprovalRegistry();
    this._approvals = approvals;
    const approvalsForRunner = {
      create: (request) => {
        const res = approvals.create(request);
        this._broadcast(BOT_APPROVAL_PENDING, { id: res.id, request });
        return res;
      },
    };

    // Pause state (global kill switch + per-bot), enforced at the gate.
    this._pause = new PauseController();

    // Budgets: accrue per-run cost, auto-pause bots over their monthly cap.
    this._budgets = new BudgetController({
      persistence: host.budgetPersistence,
      getPricing: pricingFor,
    });

    // Scoped, durable bot memory (P1: FR-010), served as in-process memory_*
    // tools that every bot can use without a consent prompt.
    this._memory = new BotMemory({ persistence: host.memoryPersistence });

    // Event-bus bridge (P1: FR-009): per-bot cooldown so a chatty event can't
    // flood the runner with event-triggered runs.
    this._dispatcher = new EventDispatcher();

    this._runner = new BotRunner({
      engines,
      store: this._store,
      approvals: approvalsForRunner,
      // Memory tools are the bot's own sandbox — auto-allowed at the gate.
      internalServers: [MEMORY_SERVER],
      resolveRunProfile: (bot) => this._resolveRunProfile(bot),
      resolveTools: (bot) => this._resolveTools(bot),
      callTool: (serverName, toolName, args, o) =>
        this._callTool(serverName, toolName, args, o),
      // Paused at the permission gate when: globally/individually paused, or
      // over any applicable budget.
      isPaused: (botId) =>
        this._pause.isPaused(botId) ||
        this._budgets.isOverBudget(
          botId,
          (this._store.get(botId) || {}).workspaceId,
        ),
      // After each run, accrue cost and alert on warn/exceeded.
      onUsage: (u) => {
        const r = this._budgets.recordUsage(u);
        if (r.status.overall !== "ok") {
          this._broadcast(BOT_BUDGET_ALERT, {
            botId: u.botId,
            cost: r.cost,
            estimated: r.estimated,
            status: r.status,
          });
        }
      },
    });

    this._scheduler = new BotScheduler({
      Cron,
      runBot: (botId, opts) => this._run(botId, opts),
    });

    // Register schedules for existing bots and run any that were missed while
    // Dash was closed.
    const bots = this._store.list();
    this._scheduler.registerAll(bots);
    for (const bot of bots)
      this._scheduler.catchUp(bot, this._lastRunAt(bot.id));

    this._ready = true;
  },

  /** Re-evaluate missed schedules on system resume (powerMonitor). */
  handleResume() {
    if (!this._ready) return;
    for (const bot of this._store.list()) {
      this._scheduler.catchUp(bot, this._lastRunAt(bot.id));
    }
  },

  /**
   * Dispatch a fired event to every subscribed bot (P1: FR-009 / US-010).
   * Called by dash-electron's widget-event relay tap. Guards: never re-trigger
   * the origin bot (loop safety), skip paused bots and bots in cooldown; a bot
   * already running is skipped by the runner itself.
   * @param {{ eventType: string, content?: any, workspaceId?: string,
   *           originBotId?: string }} event
   */
  handleEvent(event) {
    if (!this._ready || !event || !event.eventType) return;
    const bots = matchSubscribedBots(this._store.list(), event, {
      excludeBotId: event.originBotId,
    });
    for (const bot of bots) {
      if (this._pause.isPaused(bot.id)) continue;
      if (!this._dispatcher.shouldDispatch(bot.id)) continue;
      this._dispatcher.note(bot.id);
      this._run(bot.id, {
        prompt: composeEventPrompt(event, bot),
        trigger: "event",
      });
    }
  },

  // ---- IPC-facing operations ---------------------------------------------

  list() {
    return this._store.list();
  },

  get(botId) {
    return this._store.get(botId);
  },

  save(definition) {
    const saved =
      definition && definition.id && this._store.get(definition.id)
        ? this._store.update(definition.id, definition)
        : this._store.create(definition);
    this._scheduler.register(saved);
    return saved;
  },

  delete(botId) {
    this._scheduler.unregister(botId);
    return this._store.delete(botId);
  },

  run(botId, prompt) {
    return this._run(botId, { prompt, trigger: "manual" });
  },

  stop(botId) {
    return { stopped: this._runner.abort(botId) };
  },

  approve(approvalId, decision = {}) {
    return decision.allow
      ? { ok: this._approvals.resolve(approvalId, decision) }
      : { ok: this._approvals.deny(approvalId, decision.reason) };
  },

  listApprovals() {
    return this._approvals.list();
  },

  // ---- budgets (US-019) ---------------------------------------------------

  getBudgets() {
    return this._budgets.getBudgets();
  },

  setBudget(scope, id, monthlyUsd) {
    return this._budgets.setBudget(scope, id, monthlyUsd);
  },

  /** Current-month (or given month) spend buckets by scope. */
  getSpend(month) {
    return this._budgets.getSpend(month);
  },

  /** Explicit, audited override to keep a budget-exceeded bot running. */
  resumeBudget(botId) {
    return this._budgets.resumeOverBudget(botId);
  },

  // ---- background / pause (US-014, US-018) ---------------------------------

  /** @returns {Array<{id: string, name: string}>} bots with an in-flight run */
  listRunning() {
    return this._runner.listActive().map((id) => ({
      id,
      name: (this._store.get(id) || {}).name || id,
    }));
  },

  pauseAll() {
    this._pause.pauseAll();
    return this._pause.list();
  },

  resumeAll() {
    this._pause.resumeAll();
    return this._pause.list();
  },

  pauseBot(botId) {
    this._pause.pauseBot(botId);
    return this._pause.list();
  },

  resumeBot(botId) {
    this._pause.resumeBot(botId);
    return this._pause.list();
  },

  isGloballyPaused() {
    return this._pause.isGloballyPaused();
  },

  getPauseState() {
    return this._pause.list();
  },

  // ---- internals ----------------------------------------------------------

  _run(botId, opts) {
    const p = this._runner.run(botId, {
      prompt: opts.prompt,
      trigger: opts.trigger,
      emit: (event) => this._broadcast(BOT_STREAM, { botId, event }),
    });
    // The runner marks the bot active synchronously, so the active count is
    // already updated here. Broadcast on start and again on completion so the
    // tray/powerSaveBlocker can react (US-018).
    this._broadcastRunActive();
    Promise.resolve(p).finally(() => this._broadcastRunActive());
    return p;
  },

  _broadcastRunActive() {
    const running = this._runner.listActive();
    this._broadcast(BOT_RUN_ACTIVE, { count: running.length, running });
  },

  _broadcast(channel, payload) {
    for (const win of this._getWindows()) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
  },

  _lastRunAt(botId) {
    const runs = this._store.getRuns(botId);
    if (!runs.length) return 0;
    const last = runs[runs.length - 1];
    const t = Date.parse(last.endedAt || last.startedAt || "");
    return Number.isNaN(t) ? 0 : t;
  },

  /** Resolve provider config + fresh decrypted credentials for a bot. */
  _resolveRunProfile(bot) {
    const providerId = bot.provider || DEFAULT_PROVIDER;
    const provider = getProvider(providerId);
    const model = bot.model
      ? migrateModelId(providerId, bot.model)
      : getDefaultModel(providerId);

    let credentials = {};
    try {
      const win = this._getMainWindow();
      const { providers = [] } =
        this._providers.listProviders(win, this._appId) || {};
      const match =
        providers.find((p) => p.type === providerId && p.isDefaultForType) ||
        providers.find((p) => p.type === providerId);
      if (match && match.credentials) credentials = match.credentials;
    } catch (_e) {
      // Leave credentials empty — the engine will surface a clear auth error.
    }

    return {
      providerId,
      engineId: provider.engine,
      adapterId: provider.adapter,
      baseURL: provider.baseURL,
      model,
      credentials,
    };
  },

  /** Build the bot's tool set + tool→server resolver from connected servers. */
  _resolveTools(bot) {
    const connected = this._mcp.listConnectedServers
      ? this._mcp.listConnectedServers()
      : [];
    const wanted = Array.isArray(bot.mcpServers)
      ? new Set(bot.mcpServers)
      : null;
    const tools = [];
    const toolServer = Object.create(null);
    for (const server of connected) {
      if (wanted && !wanted.has(server.serverName)) continue;
      for (const tool of server.tools || []) {
        tools.push(tool);
        toolServer[tool.name] = server.serverName;
      }
    }
    // Always-available in-process memory tools (P1: FR-010).
    for (const tool of MEMORY_TOOLS) {
      tools.push(tool);
      toolServer[tool.name] = MEMORY_SERVER;
    }
    return { tools, resolveServer: (toolName) => toolServer[toolName] || null };
  },

  async _callTool(serverName, toolName, args, opts = {}) {
    // In-process memory tools bypass MCP; scoped to the calling bot's workspace.
    if (serverName === MEMORY_SERVER) {
      return handleMemoryTool(
        this._memory,
        { workspaceId: opts.workspaceId },
        toolName,
        args,
      );
    }
    const win = this._getMainWindow();
    // widgetId + token are null → the widget permission gate is bypassed; bot
    // tool calls are gated upstream by the bot PermissionGate.
    const result = await this._mcp.callTool(
      win,
      serverName,
      toolName,
      args,
      null,
      null,
      opts.workspaceId || null,
      null,
    );
    return normalizeMcpResult(result);
  },
};

module.exports = botController;
