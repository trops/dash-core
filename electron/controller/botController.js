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
const { normalizeMcpResult } = require("../bots/mcpResult");
const {
  getProvider,
  getDefaultModel,
  migrateModelId,
  DEFAULT_PROVIDER,
} = require("../llm/modelProviders");
const { BOT_STREAM, BOT_APPROVAL_PENDING } = require("../events/botEvents");

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

    this._runner = new BotRunner({
      engines,
      store: this._store,
      approvals: approvalsForRunner,
      resolveRunProfile: (bot) => this._resolveRunProfile(bot),
      resolveTools: (bot) => this._resolveTools(bot),
      callTool: (serverName, toolName, args, o) =>
        this._callTool(serverName, toolName, args, o),
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

  // ---- internals ----------------------------------------------------------

  _run(botId, opts) {
    return this._runner.run(botId, {
      prompt: opts.prompt,
      trigger: opts.trigger,
      emit: (event) => this._broadcast(BOT_STREAM, { botId, event }),
    });
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
    return { tools, resolveServer: (toolName) => toolServer[toolName] || null };
  },

  async _callTool(serverName, toolName, args, opts = {}) {
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
