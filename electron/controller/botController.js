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

const path = require("path");
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
const BotEventPublisher = require("../bots/BotEventPublisher");
const { unassignTeam } = require("../bots/teams");
const { onWorkspaceDeleted } = require("../utils/workspaceEvents");
const {
  checkChain,
  causeFromEvent,
  composeEventPrompt,
} = require("../bots/botEvents");
const {
  listToolSources,
  ensureBotServers,
  resolveBotTools,
  checkToolCall,
} = require("../bots/toolSources");
const {
  rememberToolGrant,
  forgetToolGrant,
  summarizeGrants,
} = require("../bots/rememberGrant");
const grantStore = require("../mcp/grantedPermissions");
const { isWriteTool, PATH_ARG_KEYS } = require("../mcp/permissionGate");
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
    this._botsRoot = host.paths && host.paths.botsRoot;
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

    // botId → { [providerName]: allowed tool names | null }, set on each run's
    // tool resolution and enforced in _callTool.
    this._allowedByBot = new Map();

    // Bots publish onto the dashboard bus (US-010): completed / failed /
    // tool.<providerType>.<tool>, each carrying the run's loop chain.
    this._events = new BotEventPublisher({
      publish: (msg) => this._publishBotEvent(msg),
      providerType: (name) => this._providerType(name),
    });

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

    // A deleted dashboard's team becomes unassigned + paused — never deleted,
    // never left running somewhere unexpected (bot-teams TEAM-001).
    if (this._offWorkspaceDeleted) this._offWorkspaceDeleted();
    this._offWorkspaceDeleted = onWorkspaceDeleted((workspaceId) => {
      unassignTeam({ store: this._store, pause: this._pause }, workspaceId);
    });

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
   * Called by dash-electron's widget-event relay tap and for bots' own events.
   * Guards: never re-trigger the origin bot, refuse bot→bot loops and deep
   * chains (US-011 AC6), skip paused bots and bots in cooldown; a bot already
   * running is skipped by the runner itself.
   * @param {{ eventType: string, content?: any, workspaceId?: string,
   *           originBotId?: string, chain?: string[], depth?: number }} event
   */
  handleEvent(event) {
    if (!this._ready || !event || !event.eventType) return;
    const bots = matchSubscribedBots(this._store.list(), event, {
      excludeBotId: event.originBotId,
    });
    for (const bot of bots) {
      if (this._pause.isPaused(bot.id)) continue;
      const loop = checkChain(event, bot.id);
      if (!loop.ok) {
        // Visible in the Activity feed rather than silently dropped.
        this._broadcast(BOT_STREAM, {
          botId: bot.id,
          event: {
            type: "warning",
            message: `Not triggered by ${event.eventType}: ${loop.reason}.`,
          },
        });
        continue;
      }
      if (!this._dispatcher.shouldDispatch(bot.id)) continue;
      this._dispatcher.note(bot.id);
      this._run(bot.id, {
        prompt: composeEventPrompt(event),
        trigger: "event",
        cause: causeFromEvent(event),
      });
    }
  },

  // ---- IPC-facing operations ---------------------------------------------

  list() {
    return this._store.list();
  },

  /**
   * The user's Dash MCP providers a bot can use (Settings → Providers), with
   * running status + tool count. Names/types only — never credentials.
   */
  listToolSources(workspaceId = null) {
    let providers = [];
    try {
      const win = this._getMainWindow();
      ({ providers = [] } =
        this._providers.listProviders(win, this._appId) || {});
    } catch (_e) {
      providers = [];
    }
    return listToolSources({
      providers,
      connected: this._connectedServers(),
      workspaceId,
    });
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
    // A deleted bot's remembered approvals go with it.
    grantStore.revokeGrant(botId);
    return this._store.delete(botId);
  },

  run(botId, prompt) {
    return this._run(botId, { prompt, trigger: "manual" });
  },

  stop(botId) {
    return { stopped: this._runner.abort(botId) };
  },

  /**
   * Resolve a pending approval. `decision.remember` ("Always allow") also
   * saves a durable grant for this bot + provider + tool (+ the folder of a
   * path argument), so later runs use that tool without asking. Only provider
   * tool approvals can be remembered — built-in agent tools have no provider
   * and always ask.
   */
  approve(approvalId, decision = {}) {
    if (!decision.allow) {
      return { ok: this._approvals.deny(approvalId, decision.reason) };
    }
    let remembered = false;
    if (decision.remember) {
      const pending = this._approvals.get(approvalId);
      const req = pending && pending.request;
      if (req && req.botId && req.serverName && req.toolName) {
        const next = rememberToolGrant(
          grantStore.getGrant(req.botId),
          {
            serverName: req.serverName,
            toolName: req.toolName,
            args: req.input,
          },
          { isWriteTool, pathArgKeys: PATH_ARG_KEYS, dirname: path.dirname },
        );
        remembered = grantStore.setGrant(req.botId, next) === true;
      }
    }
    return { ok: this._approvals.resolve(approvalId, decision), remembered };
  },

  /** Remembered approvals for a bot: { [provider]: { tools, folders } }. */
  getGrants(botId) {
    return summarizeGrants(grantStore.getGrant(botId));
  },

  /** Revoke one remembered tool approval; returns the updated summary. */
  revokeGrant(botId, serverName, toolName) {
    const current = grantStore.getGrant(botId);
    if (current) {
      const next = forgetToolGrant(current, serverName, toolName);
      if (next !== current) grantStore.setGrant(botId, next);
    }
    return this.getGrants(botId);
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
    // Track the run for bot events — unless one is already in progress (the
    // runner will skip this one, and the active run keeps its own cause).
    const alreadyRunning = this._runner.listActive().includes(botId);
    if (!alreadyRunning) this._events.startRun(botId, opts.cause);
    const p = this._runner.run(botId, {
      prompt: opts.prompt,
      trigger: opts.trigger,
      emit: (event) => {
        if (!alreadyRunning) this._events.onRunEvent(botId, event);
        this._broadcast(BOT_STREAM, { botId, event });
      },
    });
    // The runner marks the bot active synchronously, so the active count is
    // already updated here. Broadcast on start and again on completion so the
    // tray/powerSaveBlocker can react (US-018).
    this._broadcastRunActive();
    Promise.resolve(p)
      .then((record) => {
        // completed / failed → the bus (skipped runs publish nothing).
        if (!alreadyRunning) {
          this._events.endRun(this._store.get(botId), record);
        }
      })
      .catch(() => {})
      .finally(() => this._broadcastRunActive());
    return p;
  },

  /**
   * Put a bot's event on the dashboard bus: every window's widgets (via the
   * same broadcast channel widget events use) and subscribed bots. Bot
   * dispatch is deferred a tick so bot→bot chains never recurse on the stack.
   */
  _publishBotEvent(msg) {
    const { eventType, content, workspaceId } = msg;
    this._broadcast(
      "widget-event:broadcast",
      workspaceId
        ? { eventType, content, workspaceId }
        : { eventType, content },
    );
    setImmediate(() => {
      try {
        this.handleEvent(msg);
      } catch (_e) {
        // A dispatch failure must never surface into the publishing bot's run.
      }
    });
  },

  /** A Dash provider's type (e.g. "gmail") by its user-given name. */
  _providerType(providerName) {
    try {
      const win = this._getMainWindow();
      const { providers = [] } =
        this._providers.listProviders(win, this._appId) || {};
      const p = providers.find((x) => x && x.name === providerName);
      return (p && p.type) || null;
    } catch (_e) {
      return null;
    }
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
      // A bot may pin an engine (e.g. "claude-agent"); otherwise derive it from
      // the provider (tool-loop for anthropic/openai/xai).
      engineId: bot.engine || provider.engine,
      adapterId: provider.adapter,
      baseURL: provider.baseURL,
      model,
      credentials,
      // Sandbox dir for engines with native file/shell tools (claude-agent).
      workingDir: this._botsRoot
        ? path.join(this._botsRoot, bot.id, "files")
        : undefined,
    };
  },

  /** Connected MCP servers with real server names + workspace buckets. */
  _connectedServers() {
    return this._mcp && this._mcp.listConnectedServers
      ? this._mcp.listConnectedServers()
      : [];
  },

  /**
   * Build the bot's tool set + tool→server resolver. First starts any of the
   * bot's selected providers that aren't running in its bucket — through the
   * same deduping startServer factory the dashboards use — so a scheduled or
   * event-triggered bot doesn't silently run without its tools. Start
   * failures are surfaced in the run feed as warnings.
   */
  async _resolveTools(bot) {
    if (this._mcp && this._mcp.startServer && this._providers) {
      const win = this._getMainWindow();
      const { failed } = await ensureBotServers({
        bot,
        connected: this._connectedServers(),
        getProvider: async (name) =>
          this._providers.getProvider(win, this._appId, name),
        startServer: (name, mcpConfig, credentials, workspaceId) =>
          this._mcp.startServer(
            win,
            name,
            mcpConfig,
            credentials,
            workspaceId,
            null,
            this._appId,
          ),
      });
      for (const f of failed) {
        this._broadcast(BOT_STREAM, {
          botId: bot.id,
          event: {
            type: "warning",
            message: `${f.serverName} couldn't start, so its tools aren't available this run: ${f.message}`,
          },
        });
      }
    }
    // Each provider's declared tools (Settings → Providers) are the ceiling;
    // the bot's toolSelections narrow within them.
    const { tools, toolServer, allowedFor } = resolveBotTools({
      bot,
      connected: this._connectedServers(),
      providerLimits: this._providerToolLimits(),
    });
    // Remembered per bot so _callTool can hard-enforce the same whitelist.
    this._allowedByBot.set(bot.id, allowedFor);
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
    // The bot's per-provider whitelist (provider limit ∩ bot selection), from
    // the last _resolveTools for this bot. A tool outside it is rejected —
    // mirroring the allowedTools enforcement widgets get. If no entry exists
    // for this provider, the bot never had it resolved → deny.
    const check = checkToolCall(
      this._allowedByBot.get(opts.botId),
      serverName,
      toolName,
    );
    if (!check.ok) return { text: check.message, isError: true };
    const { allowed } = check;
    // widgetId + token are null → the widget permission gate is bypassed; bot
    // tool calls are gated upstream by the bot PermissionGate. `allowed` is
    // also passed as callTool's whitelist (defense in depth).
    const result = await this._mcp.callTool(
      win,
      serverName,
      toolName,
      args,
      allowed || null,
      null,
      opts.workspaceId || null,
      null,
    );
    const normalized = normalizeMcpResult(result);
    // tool.<providerType>.<tool> → the bus (successful provider calls only).
    if (opts.botId) {
      this._events.toolCalled(this._store.get(opts.botId), {
        serverName,
        toolName,
        args,
        result: normalized,
      });
    }
    return normalized;
  },

  /** { [providerName]: allowedTools | null } for the user's MCP providers. */
  _providerToolLimits() {
    const limits = Object.create(null);
    try {
      const win = this._getMainWindow();
      const { providers = [] } =
        this._providers.listProviders(win, this._appId) || {};
      for (const p of providers) {
        if (p && p.providerClass === "mcp" && p.name) {
          limits[p.name] = Array.isArray(p.allowedTools)
            ? p.allowedTools
            : null;
        }
      }
    } catch (_e) {
      // Provider info unreadable → empty map. resolveBotTools treats a
      // provider with no entry as not configured, so the bot gets NO tools
      // from it (fails closed) rather than every tool the server exposes.
    }
    return limits;
  },
};

module.exports = botController;
