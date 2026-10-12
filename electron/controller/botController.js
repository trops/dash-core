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
const { stopBotRun } = require("../bots/stopRun");
const {
  buildTeamManifest,
  validateTeamManifest,
  planTeamInstall,
  wireTeam,
} = require("../bots/teamManifest");
const { saveTeamFile, openTeamFile } = require("./teamFiles");
const {
  buildBotPackage,
  registryManifestFor,
  toPackageName,
  nextVersion,
  checkPublishMeta,
  publishFiles,
  readPackageFiles,
  findBotPackages,
} = require("../bots/botPackage");
const { downloadBotPackage } = require("./botRegistryInstall");
const {
  placeWidget,
  setWidgetPrefs,
  addWidgetListener,
} = require("../utils/placeWidget");

// Built-in bot widgets (TEAM-012): registered by dash-core's renderer.
const BOT_WIDGETS = {
  results: "dash.bots.BotResults",
  activity: "dash.bots.BotActivity",
};
const { registryIdentity, zipAndPublish } = require("./botPublish");
const { unassignTeam, isOnTeam } = require("../bots/teams");
const {
  TEAM_SERVER,
  TEAM_TOOLS,
  handleTeamTool,
} = require("../bots/teamTools");
const { isLead, leadOf, planEnsureLead } = require("../bots/teamLeads");
// A plan build that's still going (fix / retry / resume / remove wait).
const isBuildBusy = (state) =>
  !state || state.status === "running" || state.status === "waiting";
const {
  ROLES,
  dashTeamBot,
  isDashTeam,
  planEnsureDashTeam,
  modelForRole,
  builtinToolsFor,
  mergeDashTeamSettings,
  tierModel,
} = require("../bots/dashTeam");
const {
  ROLE_SERVER,
  ROLE_BUILD_SERVER,
  serverForTool,
  roleToolsFor,
  handleRoleTool,
  HandoffCap,
} = require("../bots/roleTools");
const { compareConfigs } = require("../bots/configDiff");
const {
  createPlanBuild,
  planBotDefinition,
  triggerSubscription,
  widgetWiring,
} = require("../bots/planBuild");
const { resolveWidgetComponent } = require("../bots/widgetComponent");
const { recentRuns } = require("../bots/recentRuns");
const { coalesce } = require("../bots/coalesce");
const { buildDraft, DraftStore } = require("../bots/botDrafts");
const { findProviders } = require("../bots/providerDiscovery");
const { searchRegistry } = require("../bots/registrySearch");

// How long a lead's find_providers results stay valid for its drafts.
const FOUND_PROVIDERS_TTL_MS = 30 * 60 * 1000;
const { onWorkspaceDeleted } = require("../utils/workspaceEvents");
const {
  checkChain,
  causeFromEvent,
  sourceFromEvent,
  composeEventPrompt,
  botEventType,
} = require("../bots/botEvents");
const {
  RESULTS_SERVER,
  resultToolsFor,
  sendResult,
  latestResult,
} = require("../bots/resultTools");
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
} = require("../llm/modelProviders");
const {
  resolveBotProviderId,
  DEFAULT_BOT_PROVIDER,
} = require("../bots/runProvider");
const {
  BOT_STREAM,
  BOT_APPROVAL_PENDING,
  BOT_APPROVALS_CHANGED,
  BOT_BUDGET_ALERT,
  BOT_RUN_ACTIVE,
  BOT_LIST_CHANGED,
  BOT_DRAFTS_CHANGED,
  BOT_PLAN_BUILD_PROGRESS,
} = require("../events/botEvents");

const { runCost } = require("../bots/runCost");

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
      // The host's widget build/check hooks for the Dash team (CRE-011,
      // dash-electron teamWidgetTools.cjs). Optional.
      widgetTools = null,
    } = deps;
    this._widgetTools = widgetTools;
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
      secretBox: host.secretBox,
    });

    // Wrap the approval registry so a newly-created approval is broadcast to
    // the renderer for the Activity Manager queue (Slice 7 UI).
    const approvals = new ApprovalRegistry();
    this._approvals = approvals;
    // Every change to the queue (answered anywhere, denied, timed out) goes
    // to every window, so no copy keeps showing an answered approval.
    approvals.onChange((list) =>
      this._broadcast(BOT_APPROVALS_CHANGED, { approvals: list }),
    );
    const approvalsForRunner = {
      create: (request) => {
        const res = approvals.create(request);
        this._broadcast(BOT_APPROVAL_PENDING, { id: res.id, request });
        return res;
      },
    };

    // ask_role hand-offs per Planner run (CRE-011 AC4).
    this._handoffs = new HandoffCap();

    // Pause state (global kill switch + per-bot), enforced at the gate and
    // before a run starts; saved so it survives a restart (CRE-011 AC3).
    this._pause = new PauseController({
      persistence: {
        load: () => this._store.getPauseState(),
        save: (state) => this._store.setPauseState(state),
      },
    });

    // Budgets: accrue per-run cost, auto-pause bots over their monthly cap.
    this._budgets = new BudgetController({
      persistence: host.budgetPersistence,
      getPricing: pricingFor,
    });

    // Scoped, durable bot memory (P1: FR-010), served as in-process memory_*
    // tools that every bot can use without a consent prompt.
    this._memory = new BotMemory({ persistence: host.memoryPersistence });
    // Bots a team lead drafted, awaiting the user's review (TEAM-005). In
    // memory only — a restart drops them (the lead's answer still says so).
    this._drafts = new DraftStore();
    // What each lead's find_providers returned (leadId → { at, entries }), so
    // drafts only keep suggestions that were really found (CAP-004).
    this._foundProviders = new Map();

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
      // Team tools are a lead's read-only view of its own team.
      // Results only reach the bot's own dashboard bus (TD-001).
      // The Dash team's role tools read, or hand work to another role
      // (itself limited to its role's tools) — CRE-011.
      internalServers: [
        MEMORY_SERVER,
        TEAM_SERVER,
        RESULTS_SERVER,
        ROLE_SERVER,
      ],
      resolveRunProfile: (bot) => this._resolveRunProfile(bot),
      // A paused bot doesn't start at all (CRE-011 AC3).
      startBlocker: (botId) =>
        this._pause.isPaused(botId) ? "this bot is paused" : null,
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
      // The run's cost on its record — the same rule as the monthly totals.
      costOf: ({ providerId, model, usage }) =>
        runCost({ providerId, usage, pricing: pricingFor(providerId, model) }),
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

    // Bot definitions changed (here, from Settings, the Assistant, a lead
    // being created…) → tell every window so open team lists refresh. One
    // broadcast per burst (bulk unassign touches many bots).
    this._notifyListChanged = coalesce(() =>
      this._broadcast(BOT_LIST_CHANGED, {}),
    );
    if (this._offStoreChange) this._offStoreChange();
    this._offStoreChange = this._store.onChange(() =>
      this._notifyListChanged(),
    );
    this._notifyDraftsChanged = coalesce(() =>
      this._broadcast(BOT_DRAFTS_CHANGED, {}),
    );
    if (this._offDraftsChange) this._offDraftsChange();
    this._offDraftsChange = this._drafts.onChange(() =>
      this._notifyDraftsChanged(),
    );

    this.ensureDashTeam();

    this._ready = true;
  },

  /**
   * The Dash team (CRE-011): create any missing role bots and upgrade
   * generated instructions the user hasn't edited. Safe to call any time.
   */
  ensureDashTeam() {
    const created = [];
    for (const step of planEnsureDashTeam(this._store.list())) {
      try {
        if (step.action === "create") {
          created.push(this._store.create(step.definition));
        } else if (step.action === "upgrade") {
          this._store.update(step.bot.id, { instructions: step.instructions });
        }
      } catch (_e) {
        // A broken store shouldn't stop the app starting; the team is
        // retried on the next launch.
      }
    }
    return created;
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
      // The owner's note on the trigger that matched (TEAM-014), if any.
      const sub = (bot.subscriptions || []).find(
        (s) => s && s.eventType === event.eventType,
      );
      this._run(bot.id, {
        prompt: composeEventPrompt(event, sub && sub.note),
        trigger: "event",
        cause: causeFromEvent(event),
        source: sourceFromEvent(bot, event),
      });
    }
  },

  // ---- IPC-facing operations ---------------------------------------------

  /** Every bot the user made — the Dash team is listed separately. */
  list() {
    return this._store.list().filter((b) => !isDashTeam(b));
  },

  /**
   * The Dash team (CRE-011) in role order: each role bot with its summary,
   * tier, the model it runs on now, the tier's recommended model and
   * whether it's paused.
   */
  listDashTeam() {
    const bots = this._store.list();
    const settings = this._store.getSettings();
    return ROLES.map((spec) => {
      const bot = dashTeamBot(bots, spec.role);
      if (!bot) return null;
      const providerId = bot.provider || DEFAULT_BOT_PROVIDER;
      return {
        ...bot,
        summary: spec.summary,
        tier: spec.tier,
        providerId,
        model: bot.model || null,
        runsOn: modelForRole(bot, providerId, settings),
        recommendedModel: tierModel(providerId, spec.tier),
        paused: this._pause.isPaused(bot.id),
      };
    }).filter(Boolean);
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
    const existing =
      definition && definition.id ? this._store.get(definition.id) : null;
    // The Dash team's identity is fixed: a form can't turn a team bot into a
    // dashboard bot, and a new bot can't claim to be on the Dash team.
    if (isDashTeam(existing)) {
      definition = {
        ...definition,
        system: existing.system,
        role: existing.role,
        workspaceId: null,
        // Dash hands it work; nothing else starts it.
        schedules: [],
        subscriptions: [],
      };
    } else if (definition && isDashTeam(definition)) {
      const { system: _s, ...rest } = definition;
      definition = rest;
    }
    const saved =
      definition && definition.id && this._store.get(definition.id)
        ? this._store.update(definition.id, definition)
        : this._store.create(definition);
    this._scheduler.register(saved);
    return saved;
  },

  delete(botId) {
    const bot = this._store.get(botId);
    if (isDashTeam(bot)) {
      throw new Error(
        `${bot.name} is part of the Dash team and can't be deleted — pause it instead.`,
      );
    }
    this._scheduler.unregister(botId);
    // A deleted bot's remembered approvals go with it.
    grantStore.revokeGrant(botId);
    // Deleting a lead counts as turning it off for that dashboard, so it isn't
    // silently re-created the next time the dashboard opens (TEAM-002).
    if (isLead(bot) && bot.workspaceId) {
      this._store.setTeamSettings(bot.workspaceId, { leadEnabled: false });
    }
    // Its private memory (bots with no dashboard) goes with it; team and
    // global memory are shared and stay.
    this._memory.forgetBot(botId);
    return this._store.delete(botId);
  },

  /**
   * Run a bot. `continueConversation` resumes its last session — a reply in
   * the Bots view (TEAM-011) — logged with trigger "reply".
   */
  run(botId, prompt, { continueConversation = false } = {}) {
    return this._run(botId, {
      prompt,
      trigger: continueConversation ? "reply" : "manual",
      continueSession: !!continueConversation,
    });
  },

  /**
   * A bot's latest runs, oldest first — prompt, answer (decrypted by the
   * store), tool-call summary, status. Feeds the Bots view's conversation
   * and Activity tab.
   */
  getRuns(botId, { limit = 50 } = {}) {
    const runs = this._store.getRuns(botId) || [];
    const n = Math.max(1, Math.min(100, Number(limit) || 50));
    return runs.slice(-n);
  },

  /**
   * The latest result a bot sent, by its event type, so a widget that opens
   * later still shows it (TD-002).
   */
  getLatestResult(eventType) {
    return latestResult(this._store, eventType);
  },

  /**
   * The latest runs across every bot, newest first, tagged with bot name and
   * dashboard — the Bot monitor's "Recent" (TEAM-011 B3).
   */
  listRecentRuns({ limit = 10 } = {}) {
    return recentRuns({
      bots: this._store.list(),
      getRuns: (id) => this._store.getRuns(id),
      limit,
    });
  },

  // ---- Team leads (bot-teams TEAM-002 / TEAM-003) --------------------------

  /**
   * Make sure a dashboard has its (idle) lead. Idempotent; respects a lead
   * turned off for that dashboard and the global auto-create switch unless
   * `force` (the user turning the lead on).
   * @returns {{ lead: object|null, created: boolean, reason?: string }}
   */
  ensureLead({ workspaceId, dashboardName, force = false } = {}) {
    let providers = [];
    try {
      const win = this._getMainWindow();
      providers =
        (this._providers.listProviders(win, this._appId) || {}).providers || [];
    } catch (_e) {
      // No providers → the lead uses Claude Code.
    }
    const plan = planEnsureLead({
      bots: this._store.list(),
      workspaceId,
      dashboardName,
      teamSettings: this._store.getTeamSettings(workspaceId),
      settings: this._store.getSettings(),
      providers,
      force,
    });
    if (plan.action === "upgrade") {
      const lead = this._store.update(plan.lead.id, {
        instructions: plan.instructions,
      });
      return { lead, created: false, reason: "upgraded" };
    }
    if (plan.action !== "create") {
      return { lead: plan.lead || null, created: false, reason: plan.reason };
    }
    const lead = this._store.create(plan.definition);
    return { lead, created: true };
  },

  /** Turn a dashboard's lead off (removes it) or back on (re-creates it). */
  setLeadEnabled({ workspaceId, enabled, dashboardName } = {}) {
    this._store.setTeamSettings(workspaceId, { leadEnabled: !!enabled });
    if (enabled) {
      return this.ensureLead({ workspaceId, dashboardName, force: true });
    }
    const lead = leadOf(this._store.list(), workspaceId);
    if (lead) {
      this._scheduler.unregister(lead.id);
      grantStore.revokeGrant(lead.id);
      this._store.delete(lead.id);
    }
    return { lead: null, created: false, reason: "turned-off" };
  },

  getTeamSettings(workspaceId) {
    return this._store.getTeamSettings(workspaceId);
  },

  /** Hide the lead's one-time introduction card on that dashboard. */
  dismissLeadIntro(workspaceId) {
    return this._store.setTeamSettings(workspaceId, { introDismissed: true });
  },

  /** Global bot settings: { autoLeads, dashTeam: { models } }. */
  getBotSettings() {
    return this._store.getSettings();
  },

  setBotSettings(patch) {
    const { autoLeads, dashTeam } = patch || {};
    const next = {};
    if (autoLeads !== undefined) next.autoLeads = !!autoLeads;
    if (dashTeam !== undefined) {
      next.dashTeam = mergeDashTeamSettings(
        this._store.getSettings().dashTeam,
        dashTeam,
      );
    }
    return this._store.setSettings(next);
  },

  /**
   * Ask a team lead a question. `continueConversation` resumes the lead's
   * session (follow-ups); otherwise a new conversation starts. Logged as a
   * lead run with trigger "ask". Resolves to the run record (answer in
   * `output`).
   */
  askLead(botId, question, { continueConversation = false, via = null } = {}) {
    const bot = this._store.get(botId);
    if (!isLead(bot)) {
      return Promise.resolve({ error: "Not a team lead.", status: "failed" });
    }
    return this._run(botId, {
      prompt: question,
      trigger: "ask",
      continueSession: !!continueConversation,
      via,
    });
  },

  /**
   * Can this lead answer right now? Pause and budgets only block tool calls,
   * so a paused lead would "answer" with its team tools refused — callers
   * (the Assistant's ask_team_lead) report the status instead (TEAM-004).
   */
  leadAvailability(botId) {
    const bot = this._store.get(botId);
    return {
      paused: this._pause.isPaused(botId),
      overBudget: this._budgets.isOverBudget(botId, (bot || {}).workspaceId),
    };
  },

  /**
   * Team leads by dashboard for the AI Assistant's "To:" picker (bot-teams
   * TEAM-013), with running state and availability.
   */
  listLeads() {
    const workspaceController = require("./workspaceController");
    let workspaces = [];
    try {
      workspaces =
        (
          workspaceController.listWorkspacesForApplication(
            this._getMainWindow(),
            this._appId,
          ) || {}
        ).workspaces || [];
    } catch (_e) {
      workspaces = [];
    }
    const { summarizeLeads } = require("../bots/teamDirectory");
    return summarizeLeads({
      workspaces,
      bots: this._store.list(),
      availability: (id) => this.leadAvailability(id),
      isRunning: (id) => this._runner.listActive().includes(id),
    });
  },

  // ---- Lead drafts (TEAM-005) -----------------------------------------------

  /**
   * A lead's propose_bot: validate the proposal against the user's providers
   * and this team's bots, and keep it as a draft for review. Never saves,
   * grants or runs anything.
   */
  _proposeBot({ workspaceId, botId }, proposal, { author = "lead" } = {}) {
    const team = this._store
      .list()
      .filter(
        (b) =>
          b.workspaceId !== null &&
          b.workspaceId !== undefined &&
          String(b.workspaceId) === String(workspaceId),
      );
    const res = buildDraft({
      proposal,
      sources: this.listToolSources(workspaceId),
      team,
      workspaceId,
      leadId: botId,
      knownProviders: this._knownProvidersFor(botId),
      author,
    });
    if (res.draft) this._drafts.add(res.draft);
    return res;
  },

  /**
   * A lead's find_providers (bot-capabilities CAP-003): search the user's
   * providers, Dash's catalogs and the MCP Registry. What it returns is
   * remembered for this lead for a while, so a draft can only suggest
   * providers that were actually found (CAP-004). Read-only.
   */
  async _findProviders({ workspaceId, botId }, capability) {
    const found = await findProviders(capability, {
      listInstalled: () => this.listToolSources(workspaceId),
      getCatalog: () =>
        (this._mcp.getCatalog && this._mcp.getCatalog(null).catalog) || [],
      getKnownExternal: () =>
        (this._mcp.getKnownExternalCatalog &&
          this._mcp.getKnownExternalCatalog().servers) ||
        [],
      searchRegistry: (query) => searchRegistry(query),
    });
    const now = Date.now();
    const prev = this._foundProviders.get(botId);
    const entries =
      prev && now - prev.at < FOUND_PROVIDERS_TTL_MS ? prev.entries : {};
    for (const entry of found.results) entries[entry.id] = entry;
    this._foundProviders.set(botId, { at: now, entries });
    return found;
  },

  /** find_providers results this lead got recently (id → entry). */
  _knownProvidersFor(botId) {
    const rec = this._foundProviders && this._foundProviders.get(botId);
    return rec && Date.now() - rec.at < FOUND_PROVIDERS_TTL_MS
      ? rec.entries
      : {};
  },

  /** Drafts awaiting review on a dashboard, oldest first. */
  listDrafts(workspaceId) {
    return this._drafts ? this._drafts.list(workspaceId) : [];
  },

  /** Remove a draft (discarded, or saved as a real bot). */
  dismissDraft(draftId) {
    return { dismissed: this._drafts ? this._drafts.remove(draftId) : false };
  },

  /** The user's Dash providers (name, type, …); [] when unavailable. */
  _providerList() {
    try {
      const win = this._getMainWindow();
      return (
        (this._providers.listProviders(win, this._appId) || {}).providers || []
      );
    } catch (_e) {
      return [];
    }
  },

  /**
   * Export a dashboard's team to a `.team.json` the user saves (bot-teams
   * TEAM-006, slice 1). The lead is left out; `notIncluded` lists anything
   * that couldn't travel (widget triggers, providers of unknown type).
   */
  async exportTeam(workspaceId, { name, description } = {}) {
    const bots = this._store.list().filter((b) => isOnTeam(b, workspaceId));
    const { manifest, notIncluded } = buildTeamManifest({
      name,
      description,
      bots,
      providers: this._providerList(),
    });
    if (!manifest.members.length) {
      return { saved: false, error: "This dashboard has no bots to export." };
    }
    const result = await saveTeamFile(this._getMainWindow(), manifest, name);
    return { ...result, notIncluded, members: manifest.members.length };
  },

  /**
   * Pick a `.team.json` and check it (TEAM-007, slice 1). Returns the clean
   * manifest plus an install plan for this dashboard (providers matched by
   * type) for the review screen — nothing is created yet.
   */
  async previewTeamImport(workspaceId) {
    const file = await openTeamFile(this._getMainWindow());
    if (file.canceled || file.error) return file;
    let json;
    try {
      json = JSON.parse(file.text);
    } catch (_e) {
      return { error: "That file isn't valid JSON." };
    }
    const { valid, errors, manifest } = validateTeamManifest(json);
    if (!valid) {
      return { error: "That isn't a Dash team file.", errors };
    }
    return {
      fileName: file.fileName,
      manifest,
      plan: planTeamInstall(manifest, {
        workspaceId,
        providers: this._providerList(),
      }),
    };
  },

  /**
   * Install a team into a dashboard: a new, paused bot per role, providers
   * as chosen on the review screen, wiring resolved to the new bots. The
   * manifest is re-checked here — the renderer's copy isn't trusted.
   */
  installTeam(workspaceId, manifest, choices = {}, roles = null) {
    const { valid, errors, manifest: clean } = validateTeamManifest(manifest);
    if (!valid) return { error: "That isn't a Dash team file.", errors };
    return this._installTeamPlan(
      planTeamInstall(clean, {
        workspaceId,
        providers: this._providerList(),
        choices,
        roles,
      }),
      null,
    );
  },

  /**
   * Create a planned team's bots (paused, no grants) and wire them. With a
   * registry `source`, each bot records where it came from (TEAM-007 AC8).
   */
  _installTeamPlan(plan, source) {
    if (!plan.members.length)
      return { error: "Pick at least one bot to install." };
    const created = {};
    for (const member of plan.members) {
      const bot = this.save(
        source
          ? {
              ...member.definition,
              installedFrom: { ...source, role: member.role },
            }
          : member.definition,
      );
      // Installed in setup state: nothing runs until the user resumes it.
      this._pause.pauseBot(bot.id);
      created[member.role] = bot;
    }
    const subs = wireTeam(plan.wiring, created);
    for (const [role, subscriptions] of Object.entries(subs)) {
      this.save({ ...created[role], subscriptions });
    }
    return {
      installed: plan.members.map((m) => ({
        role: m.role,
        id: created[m.role].id,
        name: created[m.role].name,
      })),
      droppedWiring: plan.droppedWiring || [],
    };
  },

  /** Bot and team packages in the registry matching a search (TEAM-007 3b). */
  async searchBotPackages({ query = "", type = null } = {}) {
    const registryController = require("./registryController");
    const index = await registryController.fetchRegistryIndex();
    return findBotPackages((index && index.packages) || [], query, type).map(
      (p) => ({
        ref: p.scope ? `${p.scope}/${p.name}` : p.name,
        scope: p.scope || null,
        name: p.name,
        displayName: p.displayName || p.name,
        author: p.author || p.scope || "",
        description: p.description || "",
        type: p.type,
        version: p.version || p.latestVersion || null,
        visibility: p.visibility || null,
        providerTypes: p.providerTypes || [],
        team: p.team || null,
        bot: p.bot || null,
      }),
    );
  },

  /**
   * Download, verify and check a registry package, then plan installing it
   * into this dashboard (TEAM-007 3b). The checked copy is kept here under a
   * preview id — installFromRegistry installs from it, never from a copy the
   * renderer sends back.
   */
  async previewRegistryInstall(workspaceId, packageRef) {
    const dl = await downloadBotPackage(packageRef);
    if (dl.error) return dl;
    const read = readPackageFiles(dl.files);
    if (read.error) return read;
    const source = {
      package: dl.pkg.scope ? `${dl.pkg.scope}/${dl.pkg.name}` : dl.pkg.name,
      version: dl.pkg.version,
    };
    if (!this._registryPreviews) this._registryPreviews = new Map();
    // Keep only the latest few previews.
    while (this._registryPreviews.size >= 5) {
      this._registryPreviews.delete(this._registryPreviews.keys().next().value);
    }
    const previewId = `rp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this._registryPreviews.set(previewId, { manifest: read.manifest, source });
    return {
      previewId,
      kind: read.kind,
      source: {
        ...source,
        author: dl.pkg.author,
        displayName: dl.pkg.displayName,
      },
      manifest: read.manifest,
      plan: planTeamInstall(read.manifest, {
        workspaceId,
        providers: this._providerList(),
      }),
    };
  },

  /** Install the previewed registry package — all bots, or the ones picked. */
  installFromRegistry(workspaceId, previewId, choices = {}, roles = null) {
    const preview =
      this._registryPreviews && this._registryPreviews.get(previewId);
    if (!preview) {
      return { error: "That preview has expired — find the package again." };
    }
    this._registryPreviews.delete(previewId);
    return this._installTeamPlan(
      planTeamInstall(preview.manifest, {
        workspaceId,
        providers: this._providerList(),
        choices,
        roles,
      }),
      preview.source,
    );
  },

  /**
   * What would be published (TEAM-006 slice 3a): a dashboard's team
   * (`kind: "team"`) or one bot (`kind: "bot"`). Built here from the
   * stored bots — the renderer only shows it.
   */
  _publishable({ kind, workspaceId, botId, name }) {
    if (kind === "team") {
      const bots = this._store.list().filter((b) => isOnTeam(b, workspaceId));
      const { manifest, notIncluded } = buildTeamManifest({
        name,
        bots,
        providers: this._providerList(),
      });
      if (!manifest.members.length) {
        return { error: "This dashboard has no bots to publish." };
      }
      const last = this._store.getTeamSettings(workspaceId).published || null;
      return { pkg: manifest, notIncluded, last, defaultName: name };
    }
    const bot = this._store.get(botId);
    if (!bot) return { error: "That bot no longer exists." };
    if (isLead(bot)) return { error: "A team lead can't be published." };
    const { pkg, notIncluded } = buildBotPackage({
      bot,
      providers: this._providerList(),
    });
    return {
      pkg,
      notIncluded,
      last: bot.published || null,
      defaultName: bot.name,
    };
  },

  /** The publish dialog's contents: package, notes, suggested fields, sign-in. */
  async previewPublish(opts = {}) {
    const p = this._publishable(opts);
    if (p.error) return p;
    const identity = await registryIdentity();
    const lastName =
      p.last && p.last.name ? p.last.name.split("/").pop() : null;
    return {
      kind: opts.kind,
      pkg: p.pkg,
      notIncluded: p.notIncluded,
      last: p.last,
      signedIn: identity.signedIn,
      username: identity.username || null,
      suggested: {
        displayName: p.defaultName || "",
        name: lastName || toPackageName(p.defaultName),
        version: nextVersion(p.last && p.last.version),
        description: "",
        visibility: (p.last && p.last.visibility) || "private",
      },
    };
  },

  /**
   * Publish a bot or team to the registry under the user's username. The
   * package is rebuilt here; only the publish fields come from the dialog.
   */
  async publish(opts = {}) {
    const meta = (opts && opts.meta) || {};
    const errors = checkPublishMeta(meta);
    if (errors.length) return { success: false, error: errors.join(" ") };
    const p = this._publishable(opts);
    if (p.error) return { success: false, error: p.error };
    const identity = await registryIdentity();
    if (!identity.signedIn) {
      return {
        success: false,
        authRequired: true,
        error: "Sign in to the Dash registry to publish (Settings › Account).",
      };
    }
    const pkg = {
      ...p.pkg,
      name: meta.displayName,
      description: meta.description || "",
      version: meta.version,
    };
    const visibility = meta.visibility === "public" ? "public" : "private";
    const manifest = registryManifestFor(pkg, {
      scope: identity.username,
      name: meta.name,
      displayName: meta.displayName,
      version: meta.version,
      description: meta.description || "",
      visibility,
      appOrigin: this._appId,
      author: identity.displayName,
    });
    const result = await zipAndPublish(publishFiles(pkg, manifest), manifest);
    if (!result || !result.success) {
      return {
        success: false,
        authRequired: !!(result && result.authRequired),
        error: (result && result.error) || "Publish failed.",
        details: result && result.details,
      };
    }
    // Remember what was published so the next publish bumps from here.
    const published = {
      name: `${identity.username}/${meta.name}`,
      version: meta.version,
      visibility,
      at: new Date().toISOString(),
    };
    if (opts.kind === "team") {
      this._store.setTeamSettings(opts.workspaceId, { published });
    } else {
      this._store.update(opts.botId, { published });
    }
    return {
      success: true,
      package: published.name,
      version: meta.version,
      visibility,
      registryUrl: result.registryUrl || null,
      warnings: result.warnings || [],
    };
  },

  /** A saved dashboard by id, or null. */
  _loadWorkspace(workspaceId) {
    const workspaceController = require("./workspaceController");
    const res =
      workspaceController.listWorkspacesForApplication(
        this._getMainWindow(),
        this._appId,
      ) || {};
    return (
      (res.workspaces || []).find(
        (w) => String(w.id) === String(workspaceId),
      ) || null
    );
  },

  /** Save a dashboard and tell open windows to reload it. */
  _saveWorkspace(workspace) {
    const workspaceController = require("./workspaceController");
    const res = workspaceController.saveWorkspaceForApplication(
      this._getMainWindow(),
      this._appId,
      workspace,
    );
    if (res && res.error)
      return { error: res.message || "Couldn't save the dashboard." };
    this._broadcast("workspace:saved", { workspaceId: workspace.id });
    return { ok: true };
  },

  /**
   * "Show on dashboard" (TEAM-012): place a Bot results widget for one bot
   * (`kind: "results"`, its botId saved in the widget's settings) or the
   * team's Bot activity widget (`kind: "activity"`) on the dashboard.
   */
  addBotWidget(workspaceId, { kind = "results", botId = null } = {}) {
    const component = BOT_WIDGETS[kind];
    if (!component) return { error: "Unknown bot widget." };
    if (kind === "results") {
      const bot = this._store.get(botId);
      if (!bot || !isOnTeam(bot, workspaceId)) {
        return { error: "That bot isn't on this dashboard's team." };
      }
    }
    const workspace = this._loadWorkspace(workspaceId);
    if (!workspace)
      return { error: "Save the dashboard first, then try again." };
    const placed = placeWidget(workspace, {
      component,
      userPrefs: kind === "results" ? { botId } : {},
    });
    const saved = this._saveWorkspace(placed.workspace);
    if (saved.error) return saved;
    return { added: true, widgetId: placed.widgetId, cell: placed.cell };
  },

  /** Link an existing Bot results widget to a bot on its dashboard's team. */
  bindBotWidget(workspaceId, widgetId, botId) {
    const bot = this._store.get(botId);
    if (!bot || !isOnTeam(bot, workspaceId)) {
      return { error: "That bot isn't on this dashboard's team." };
    }
    const workspace = this._loadWorkspace(workspaceId);
    if (!workspace) return { error: "That dashboard wasn't found." };
    const next = setWidgetPrefs(
      workspace,
      widgetId,
      { botId },
      BOT_WIDGETS.results,
    );
    if (!next) return { error: "That widget isn't on the dashboard." };
    const saved = this._saveWorkspace(next);
    return saved.error ? saved : { bound: true };
  },

  stop(botId) {
    const { stopped } = stopBotRun({
      runner: this._runner,
      approvals: this._approvals,
      botId,
    });
    return { stopped };
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
    return this._runner.listActive().map((id) => {
      const bot = this._store.get(id) || {};
      return {
        id,
        name: bot.name || id,
        workspaceId:
          bot.workspaceId === null || bot.workspaceId === undefined
            ? null
            : String(bot.workspaceId),
        startedAt: this._runner.startedAt(id),
      };
    });
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
    // A team lead's answers are a conversation with the user, not team work —
    // they don't go on the event bus (so they can't trigger bots); nor do the
    // Dash team's runs, which are the app's own work.
    const publishes =
      !this._runner.listActive().includes(botId) &&
      !isLead(this._store.get(botId)) &&
      !isDashTeam(this._store.get(botId));
    const alreadyRunning = !publishes;
    if (!alreadyRunning) this._events.startRun(botId, opts.cause);
    const p = this._runner.run(botId, {
      prompt: opts.prompt,
      trigger: opts.trigger,
      // What triggered an event run, for the run record (Bots view).
      source: opts.source || null,
      // Who asked, when not the user directly (the AI Assistant, TEAM-004).
      via: opts.via || null,
      // Follow-ups (Ask the lead) resume the session; runs start fresh.
      continueSession: !!opts.continueSession,
      // A plan build's own team runs: no prompts (the plan was the consent).
      approvalPolicy: opts.approvalPolicy || undefined,
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
    let providers = [];
    try {
      const win = this._getMainWindow();
      ({ providers = [] } =
        this._providers.listProviders(win, this._appId) || {});
    } catch (_e) {
      // No provider list — the bot's own provider still works; with none it
      // fails below with a clear message.
    }
    // The bot's own provider, else Claude Code (CLI) — the default.
    const providerId = resolveBotProviderId(bot, providers);
    const provider = getProvider(providerId);
    // Dash team bots run on their role's model for this provider; leads with
    // no model of their own on the fast tier (they only read team data).
    let model;
    if (isDashTeam(bot)) {
      model = migrateModelId(
        providerId,
        modelForRole(bot, providerId, this._store.getSettings()),
      );
    } else if (bot.model) {
      model = migrateModelId(providerId, bot.model);
    } else if (isLead(bot)) {
      model = tierModel(providerId, "fast") || getDefaultModel(providerId);
    } else {
      model = getDefaultModel(providerId);
    }

    let credentials = {};
    try {
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
      // Engine built-ins: none for leads and most Dash team roles, read-only
      // for the Builder; undefined = the engine's full set.
      builtinTools: isLead(bot)
        ? "none"
        : isDashTeam(bot)
          ? builtinToolsFor(bot)
          : undefined,
      // Sandbox dir for engines with native file/shell tools (claude-agent).
      workingDir: this._botsRoot
        ? path.join(this._botsRoot, bot.id, "files")
        : undefined,
    };
  },

  /** Connected MCP servers with real server names + workspace buckets. */
  /**
   * Build an approved plan (create-entry CRE-004, TD-008; phase 4d-1):
   * install, create the dashboard, the Builder builds and the Checker checks
   * each new widget, then everything is placed. Progress goes to every window
   * (BOT_PLAN_BUILD_PROGRESS). Resolves at once with the build's id.
   * `resumeFrom` (Edit plan, 4d-3): an earlier build of this plan whose work
   * is reused — same dashboard, unchanged pieces kept.
   */
  startPlanBuild(plan, { dashboardName = null, resumeFrom = null } = {}) {
    if (!plan || !Array.isArray(plan.pieces) || !plan.pieces.length) {
      return { error: "The plan has nothing to build." };
    }
    if (!this._builds) this._builds = new Map();
    let resume = null;
    if (resumeFrom) {
      const earlier = this._builds.get(resumeFrom);
      if (!earlier) return { error: "The earlier build isn't there any more." };
      if (isBuildBusy(earlier.state)) {
        return { error: "The earlier build is still running." };
      }
      if (earlier.state && earlier.state.status === "removed") {
        return { error: "What the earlier build made was removed." };
      }
      resume = { plan: earlier.plan, state: earlier.state };
      // The new build owns that work now (and removes it, if asked).
      this._builds.delete(resumeFrom);
    }
    const buildId = `build_${Date.now()}`;
    const entry = { plan, state: null, build: null };
    const build = createPlanBuild(
      plan,
      {
        installWidget: (pkg, piece) => this._planInstallWidget(pkg, piece),
        createDashboard: (name, count) =>
          this._planCreateDashboard(name, count),
        askRole: (role, request) => this._planAskRole(role, request),
        abortRole: (role) => {
          const bot = dashTeamBot(this._store.list(), role);
          if (bot) this._runner.abort(bot.id);
        },
        placeWidget: ({ dashboardId, component, widget }) => {
          const res = this._teamPlaceWidget({
            dashboard: dashboardId,
            widget: component || widget,
          });
          if (res && res.error) throw new Error(res.error);
          return res;
        },
        saveBot: (req) => this._planSaveBot(req),
        placeBotResults: ({ dashboardId, botId }) => {
          const res = this.addBotWidget(dashboardId, {
            kind: "results",
            botId,
          });
          if (res && res.error) throw new Error(res.error);
          return { component: BOT_WIDGETS.results, widgetId: res.widgetId };
        },
        wireTrigger: (req) => this._planWireTrigger(req),
        wireListener: (req) => this._planWireListener(req),
        emit: (state) => {
          entry.state = state;
          this._broadcast(BOT_PLAN_BUILD_PROGRESS, { buildId, state });
        },
      },
      { dashboardName, resume },
    );
    entry.build = build;
    entry.state = JSON.parse(JSON.stringify(build.state));
    this._builds.set(buildId, entry);
    build.run().catch((err) => {
      console.error("[botController] plan build failed:", err);
    });
    return { buildId, state: entry.state };
  },

  stopPlanBuild(buildId) {
    const entry = this._builds && this._builds.get(buildId);
    if (!entry) return { error: "No such build." };
    entry.build.stop();
    return { ok: true };
  },

  getPlanBuild(buildId) {
    const entry = this._builds && this._builds.get(buildId);
    return entry ? { buildId, state: entry.state } : null;
  },

  /** A finished build and one of its steps, or { error }. */
  _finishedBuild(buildId, stepId = null) {
    const entry = this._builds && this._builds.get(buildId);
    if (!entry) return { error: "No such build." };
    if (isBuildBusy(entry.state))
      return { error: "The build is still running." };
    if (entry.state && entry.state.status === "removed") {
      return { error: "What this build made was removed." };
    }
    const step =
      stepId != null
        ? ((entry.state && entry.state.steps) || []).find(
            (x) => x.id === stepId,
          )
        : null;
    if (stepId != null && !step) return { error: "No such step." };
    return { entry, step };
  },

  _continueBuild(promise) {
    Promise.resolve(promise).catch((err) => {
      console.error("[botController] plan build failed:", err);
    });
    return { ok: true };
  },

  /** Let Builder fix it (CRE-004 AC4): the Builder fixes the step's widget. */
  fixPlanBuild(buildId, stepId) {
    const { entry, step, error } = this._finishedBuild(buildId, stepId);
    if (error) return { error };
    if (step.status !== "failed" || !step.canFix) {
      return { error: "The Builder can't fix that step." };
    }
    return this._continueBuild(entry.build.fix(stepId));
  },

  /** Try again: a failed Dash step runs again. */
  retryPlanBuild(buildId, stepId) {
    const { entry, step, error } = this._finishedBuild(buildId, stepId);
    if (error) return { error };
    if (step.status !== "failed" || !step.canRetry) {
      return { error: "That step can't be tried again." };
    }
    return this._continueBuild(entry.build.retry(stepId));
  },

  /** Providers were connected: the steps waiting for them run (AC5). */
  resumePlanBuild(buildId) {
    const { entry, error } = this._finishedBuild(buildId);
    if (error) return { error };
    if (!entry.state.steps.some((x) => x.status === "needs-provider")) {
      return { error: "Nothing is waiting." };
    }
    return this._continueBuild(entry.build.resume());
  },

  /**
   * Remove what was built (CRE-004 AC4): the dashboard, the bots saved for it
   * (and its lead), and the widgets the Builder made new for it. Registry
   * installs stay installed and updated widgets keep their changes.
   * → { removed: { dashboard, bots, widgets }, kept: { installs, updated } }
   */
  removePlanBuild(buildId) {
    const { entry, error } = this._finishedBuild(buildId);
    if (error) return { error };
    const built = (entry.state && entry.state.built) || {};
    const removed = { dashboard: null, bots: [], widgets: [] };
    const problems = [];

    const dashboardId = built.dashboard ? built.dashboard.id : null;
    const bots = (built.bots || []).slice();
    const lead = dashboardId ? leadOf(this._store.list(), dashboardId) : null;
    if (lead && !bots.some((b) => b.id === lead.id)) {
      bots.push({ id: lead.id, name: lead.name });
    }
    for (const b of bots) {
      if (!this._store.get(b.id)) continue;
      try {
        this.delete(b.id);
        removed.bots.push(b.name);
      } catch (err) {
        problems.push(`${b.name}: ${err.message}`);
      }
    }

    for (const pkg of built.widgets || []) {
      try {
        require("./schedulerController").cleanupWidget(pkg);
        if (
          require("../widgetRegistry").getWidgetRegistry().uninstallWidget(pkg)
        ) {
          removed.widgets.push(pkg);
          this._broadcast("widget:uninstalled", { widgetName: pkg });
        }
      } catch (err) {
        problems.push(`${pkg}: ${err.message}`);
      }
    }

    if (dashboardId) {
      const ws = this._loadWorkspace(dashboardId);
      if (ws) {
        const res =
          require("./workspaceController").deleteWorkspaceForApplication(
            this._getMainWindow(),
            this._appId,
            ws.id,
          );
        if (res && res.success) {
          removed.dashboard = built.dashboard.name;
          this._broadcast("workspace:saved", {
            workspaceId: ws.id,
            deleted: true,
          });
        } else {
          problems.push(
            `${built.dashboard.name}: ${(res && res.message) || "couldn't delete it"}`,
          );
        }
      }
    }

    const kept = {
      installs: built.installs || [],
      updated: built.updated || [],
    };
    entry.state = {
      ...entry.state,
      status: "removed",
      removed,
      kept,
      problems,
    };
    this._broadcast(BOT_PLAN_BUILD_PROGRESS, { buildId, state: entry.state });
    return { removed, kept, problems };
  },

  /** A registry widget, installed for a plan build → its component id. */
  async _planInstallWidget(pkgName, piece) {
    const pkg = await require("./registryController").getPackage(pkgName);
    if (!pkg) throw new Error(`${pkgName} isn't in the registry`);
    if (!pkg.downloadUrl) throw new Error(`${pkgName} can't be downloaded`);
    const registry = require("../widgetRegistry").getWidgetRegistry();
    const config = await registry.downloadWidget(pkg.name, pkg.downloadUrl);
    this._broadcast("widget:installed", { widgetName: pkg.name, config });
    const widgets = pkg.widgets || [];
    const want = String((piece && piece.name) || "").toLowerCase();
    const w =
      widgets.find(
        (x) =>
          String(x.name || "").toLowerCase() === want ||
          String(x.displayName || "").toLowerCase() === want,
      ) || widgets[0];
    const component =
      w && pkg.scope ? `${pkg.scope}.${pkg.name}.${w.name}` : null;
    return { component };
  },

  /** A new dashboard with an empty grid for the plan's widgets. */
  _planCreateDashboard(name, count) {
    const n = Math.max(1, Number(count) || 1);
    const cols = n > 1 ? 2 : 1;
    const rows = Math.ceil(n / cols);
    const grid = { rows, cols, gap: "gap-2" };
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        grid[`${r}.${c}`] = { component: null, hide: false };
      }
    }
    const ws = {
      id: Date.now(),
      name: String(name || "New dashboard").trim(),
      label: String(name || "New dashboard").trim(),
      type: "workspace",
      version: 1,
      menuId: 1,
      layout: [
        {
          id: 1,
          order: 1,
          component: "LayoutGridContainer",
          type: "grid",
          parent: 0,
          hasChildren: 1,
          scrollable: false,
          width: "w-full",
          height: "h-full",
          workspace: "layout",
          grid,
        },
      ],
    };
    const saved = this._saveWorkspace(ws);
    if (saved && saved.error) throw new Error(saved.error);
    return { id: ws.id, name: ws.name };
  },

  /**
   * A plan's new bot, saved on the build's dashboard exactly as planned
   * (team-dashboards TD-008): checked like a draft (only the user's
   * providers and tools, a valid schedule, valid result names), with its
   * providers and tools taken as chosen. A provider that isn't connected
   * fails the step instead of saving a bot that can't work.
   */
  _planSaveBot({ dashboardId, piece, botId = null }) {
    const definition = planBotDefinition(piece, {
      dashboardId,
      sources: this.listToolSources(dashboardId),
      team: this._store
        .list()
        .filter((b) => String(b.workspaceId) === String(dashboardId)),
    });
    // An edited plan's changed bot is saved over the one built before
    // (4d-3); its triggers stay.
    const existing = botId ? this._store.get(botId) : null;
    const saved = this.save(
      existing
        ? {
            ...definition,
            id: existing.id,
            subscriptions: existing.subscriptions || [],
          }
        : definition,
    );
    return { id: saved.id, name: saved.name };
  },

  /** What a placed widget sends and handles ({ events, handlers }), or null. */
  async _planWidgetWiring(component) {
    const parts = String(component || "").split(".");
    const name = parts.length >= 3 ? `@${parts[0]}/${parts[1]}` : component;
    const src = await require("../widgetRegistry").readWidgetSources({
      widgetName: name,
      componentName: component,
    });
    return src && src.success
      ? widgetWiring(src.configCode, src.componentCode)
      : null;
  },

  /** A widget event starts a bot (TD-006): the bot subscribes to it. */
  async _planWireTrigger({ dashboardId, botId, widgetId, component, event }) {
    const wiring = await this._planWidgetWiring(component);
    if (wiring && wiring.rawPublish) {
      throw new Error(
        `the widget sends "${event}" with api.publishEvent, which bots can't hear — it needs publishEvent from useWidgetEvents`,
      );
    }
    if (wiring && !wiring.events.includes(event)) {
      throw new Error(
        `the widget doesn't send "${event}" (it sends ${wiring.events.join(", ") || "nothing"})`,
      );
    }
    const bot = this._store.get(botId);
    if (!bot) throw new Error("the bot wasn't saved");
    const sub = triggerSubscription({
      dashboardId,
      widgetId,
      component,
      event,
    });
    const subs = Array.isArray(bot.subscriptions) ? bot.subscriptions : [];
    if (subs.some((x) => x && x.eventType === sub.eventType)) return;
    this.save({ ...bot, subscriptions: [...subs, sub] });
  },

  /** A widget shows a bot's result: listeners[handler] gets the result event. */
  async _planWireListener({
    dashboardId,
    widgetId,
    component,
    handler,
    botId,
    result,
  }) {
    const wiring = await this._planWidgetWiring(component);
    if (wiring && !wiring.handlers.includes(handler)) {
      throw new Error(
        `the widget has no handler "${handler}" (it has ${wiring.handlers.join(", ") || "none"})`,
      );
    }
    const bot = this._store.get(botId);
    if (!bot) throw new Error("the bot wasn't saved");
    const ws = this._loadWorkspace(dashboardId);
    if (!ws) throw new Error("the dashboard couldn't be read");
    const next = addWidgetListener(
      ws,
      widgetId,
      handler,
      botEventType(bot, `result.${result}`),
      component,
    );
    if (!next) throw new Error("the widget isn't on the dashboard");
    const saved = this._saveWorkspace(next);
    if (saved && saved.error) throw new Error(saved.error);
  },

  /** A Dash team role's run inside an approved plan build. */
  async _planAskRole(role, request) {
    const bot = dashTeamBot(this._store.list(), role);
    if (!bot) return { skipped: true, reason: `the ${role} isn't set up` };
    if (this._pause.isPaused(bot.id)) {
      return { skipped: true, reason: `the ${bot.name} is paused` };
    }
    return this._run(bot.id, {
      prompt: request,
      trigger: "ask",
      via: "plan-build",
      approvalPolicy: "allow",
    });
  },

  /** What the Dash team's role tools read and run (roleTools.js). */
  _roleToolDeps() {
    return {
      installedWidgets: () => {
        try {
          return require("../widgetRegistry").getWidgetRegistry().getWidgets();
        } catch (_e) {
          return [];
        }
      },
      searchRegistry: async (query) => {
        // Lazy: the MCP tool handlers require this controller.
        const { handleSearchWidgets } = require("../mcp/toolHandlers");
        const res = await handleSearchWidgets({ query });
        const text =
          res && res.content && res.content[0] && res.content[0].text;
        const parsed = text ? JSON.parse(text) : {};
        if (res && res.isError) {
          throw new Error(parsed.error || "registry search failed");
        }
        return parsed.widgets || [];
      },
      readWidget: ({ name, component }) =>
        require("../widgetRegistry").readWidgetSources({
          widgetName: name,
          componentName: component,
        }),
      providerTools: () => this._providerToolsWithFlags(),
      askRole: (req) => this._askRole(req),
      ...(this._widgetTools
        ? {
            widgetGuide: (req) => this._widgetTools.guide(req),
            buildWidget: (req) =>
              this._widgetTools.build({
                ...req,
                provider: this._providerPick(req.provider),
              }),
            checkWidget: (req) => this._widgetTools.check(req),
          }
        : {}),
      compareConfigs,
      listDashboards: () => this._dashboardsWithBots(),
      draftBot: (req) => this._teamDraftBot(req),
      placeWidget: (req) => this._teamPlaceWidget(req),
    };
  },

  /** The user's dashboards with their bots' names (list_dashboards). */
  _dashboardsWithBots() {
    let workspaces = [];
    try {
      const workspaceController = require("./workspaceController");
      workspaces =
        (
          workspaceController.listWorkspacesForApplication(
            this._getMainWindow(),
            this._appId,
          ) || {}
        ).workspaces || [];
    } catch (_e) {
      workspaces = [];
    }
    const bots = this._store.list();
    return workspaces.map((ws) => ({
      id: String(ws.id),
      name: ws.name || ws.label || `Dashboard ${ws.id}`,
      bots: bots
        .filter((b) => isOnTeam(b, ws.id))
        .map((b) => (isLead(b) ? `${b.name} (lead)` : b.name)),
      pages: Array.isArray(ws.pages)
        ? ws.pages.map((p) =>
            p.id === ws.activePageId ? `${p.name} (shown)` : p.name,
          )
        : [],
    }));
  },

  /**
   * place_widget: put an installed widget on a dashboard — the shown page or
   * a named one, the next free cell or a given one — then save and refresh
   * open windows (CRE-011, scenarios G4).
   */
  _teamPlaceWidget({ dashboard, widget, component, page, row, col, settings }) {
    const dashboards = this._dashboardsWithBots();
    const want = String(dashboard || "").trim();
    const hit =
      dashboards.find((d) => d.id === want) ||
      dashboards.find((d) => d.name.toLowerCase() === want.toLowerCase());
    if (!hit) {
      return {
        error: `No dashboard "${want}". The user's dashboards: ${
          dashboards.map((d) => d.name).join(", ") || "none"
        }.`,
      };
    }
    const resolved = resolveWidgetComponent(widget, component, () =>
      require("../widgetRegistry").getWidgetRegistry().getWidgets(),
    );
    if (resolved.error) return resolved;
    const ws = this._loadWorkspace(hit.id);
    if (!ws) return { error: "That dashboard couldn't be read." };
    let placed;
    try {
      placed = placeWidget(ws, {
        component: resolved.component,
        userPrefs: settings || {},
        page: page || undefined,
        row: row === undefined || row === null ? undefined : row,
        col: col === undefined || col === null ? undefined : col,
      });
    } catch (err) {
      return { error: err.message };
    }
    const saved = this._saveWorkspace(placed.workspace);
    if (saved.error) return saved;
    const { layoutOf } = require("../utils/activeLayout");
    const target = layoutOf(placed.workspace, page || undefined);
    return {
      component: resolved.component,
      dashboardName: hit.name,
      page: target.page ? target.page.name : null,
      cell: placed.cell,
      widgetId: placed.widgetId,
    };
  },

  /**
   * draft_bot: the Builder's bot draft on a dashboard (by id or name), made
   * the same way as a lead's propose_bot and waiting in that dashboard's
   * Bots view for the user to save or discard (CRE-011, G3).
   */
  _teamDraftBot({ callerId, dashboard, proposal }) {
    const dashboards = this._dashboardsWithBots();
    const want = String(dashboard || "").trim();
    const ws =
      dashboards.find((d) => d.id === want) ||
      dashboards.find((d) => d.name.toLowerCase() === want.toLowerCase());
    if (!ws) {
      return {
        error: `No dashboard "${want}". The user's dashboards: ${
          dashboards.map((d) => d.name).join(", ") || "none"
        }.`,
      };
    }
    const res = this._proposeBot(
      { workspaceId: ws.id, botId: callerId },
      proposal || {},
      { author: "dash-team" },
    );
    return res && res.draft ? { ...res, dashboardName: ws.name } : res;
  },

  /**
   * A provider type the Builder names → { type, providerClass } from the
   * user's providers, so the built config declares the right class; null
   * when they don't have one of that type.
   */
  _providerPick(type) {
    if (!type) return null;
    let all = [];
    try {
      ({ providers: all = [] } =
        this._providers.listProviders(this._getMainWindow(), this._appId) ||
        {});
    } catch (_e) {
      all = [];
    }
    const want = String(type).toLowerCase();
    const hit = (all || []).find(
      (p) => p && String(p.type || "").toLowerCase() === want,
    );
    return hit && hit.providerClass
      ? { type: hit.type, providerClass: hit.providerClass }
      : null;
  },

  /**
   * The user's providers: MCP ones with each tool's read-only flag when it's
   * known (running servers carry MCP annotations), otherwise just names;
   * credential providers marked as such.
   */
  _providerToolsWithFlags() {
    const connected = this._connectedServers();
    let all = [];
    try {
      ({ providers: all = [] } =
        this._providers.listProviders(this._getMainWindow(), this._appId) ||
        {});
    } catch (_e) {
      all = [];
    }
    // Credential providers (an API key a widget uses directly) have no tools.
    const credentials = (all || [])
      .filter((p) => p && p.name && p.providerClass !== "mcp")
      .map((p) => ({ name: p.name, type: p.type || null, credentials: true }));
    const mcp = this.listToolSources(null).map((p) => {
      const live = connected.find((c) => c.serverName === p.name);
      if (!Array.isArray(p.tools)) return p;
      const byName = new Map(
        ((live && live.tools) || []).map((t) => [t && t.name, t]),
      );
      return {
        ...p,
        tools: p.tools.map((name) => byName.get(name) || name),
      };
    });
    return [...mcp, ...credentials];
  },

  /**
   * ask_role: run another Dash team role with the Planner's request and hand
   * back its answer (CRE-011 AC4). One step deep (only the Planner has
   * ask_role), at most MAX_HANDOFFS per Planner run, never a busy role.
   */
  async _askRole({ callerId, role, request }) {
    const fail = (text) => ({ text, isError: true });
    const runKey = this._runner.startedAt(callerId) || "idle";
    if (!this._handoffs.take(callerId, runKey)) {
      return fail(
        "You've handed off as many requests as one run allows. Finish with what you have.",
      );
    }
    const target = dashTeamBot(this._store.list(), role);
    if (!target) return fail(`The ${role} isn't set up.`);
    if (this._runner.isRunning(target.id)) {
      return fail(`The ${target.name} is busy with another request.`);
    }
    const caller = this._store.get(callerId);
    const record = await this._run(target.id, {
      prompt: request,
      trigger: "ask",
      via: `dash-team:${(caller && caller.role) || "planner"}`,
    });
    if (!record || record.skipped) {
      return fail(
        `The ${target.name} didn't run: ${(record && record.reason) || "unknown reason"}.`,
      );
    }
    if (record.status === "failed") {
      return fail(
        `The ${target.name} failed: ${record.error || "no details"}.`,
      );
    }
    return {
      text: `${target.name}: ${record.output || "(no answer)"}`,
      isError: false,
    };
  },

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
    // A team lead gets ONLY its read-only team tools — no providers, no memory
    // writes (bot-teams TEAM-002 AC4). The runner also strips engine built-ins.
    if (isLead(bot)) {
      const toolServer = {};
      for (const tool of TEAM_TOOLS) toolServer[tool.name] = TEAM_SERVER;
      this._allowedByBot.set(bot.id, {});
      return {
        tools: [...TEAM_TOOLS],
        resolveServer: (toolName) => toolServer[toolName] || null,
      };
    }
    // A Dash team role gets only its role's tools (CRE-011) — no providers,
    // no memory; the runner limits engine built-ins by role.
    if (isDashTeam(bot)) {
      const tools = roleToolsFor(bot.role);
      this._allowedByBot.set(bot.id, {});
      return {
        tools,
        resolveServer: (toolName) =>
          tools.some((t) => t.name === toolName)
            ? serverForTool(toolName)
            : null,
        // build_widget's server: asked about at the gate, not refused.
        servers: tools.some((t) => serverForTool(t.name) === ROLE_BUILD_SERVER)
          ? [ROLE_BUILD_SERVER]
          : [],
      };
    }
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
    // send_result, for a bot that declares results (team-dashboards TD-001).
    for (const tool of resultToolsFor(bot)) {
      tools.push(tool);
      toolServer[tool.name] = RESULTS_SERVER;
    }
    return { tools, resolveServer: (toolName) => toolServer[toolName] || null };
  },

  async _callTool(serverName, toolName, args, opts = {}) {
    // In-process memory tools bypass MCP; scoped to the calling bot's workspace.
    if (serverName === MEMORY_SERVER) {
      return handleMemoryTool(
        this._memory,
        { workspaceId: opts.workspaceId, botId: opts.botId },
        toolName,
        args,
      );
    }
    if (serverName === RESULTS_SERVER) {
      // Saved as the latest result for its name, then put on the bus.
      return sendResult(
        { store: this._store, publisher: this._events },
        opts.botId,
        args,
      );
    }
    // A lead's read-only team tools, scoped to the lead's own dashboard.
    if (serverName === TEAM_SERVER) {
      const caller = this._store.get(opts.botId);
      if (!isLead(caller)) {
        return { text: "Team tools are only for team leads.", isError: true };
      }
      return handleTeamTool(
        {
          store: this._store,
          memory: this._memory,
          isRunning: (id) => this._runner.listActive().includes(id),
          isPaused: (id) => this._pause.isPaused(id),
          proposeBot: (teamCtx, proposal) =>
            this._proposeBot(teamCtx, proposal),
          findProviders: (teamCtx, capability) =>
            this._findProviders(teamCtx, capability),
          listProviders: () => this.listToolSources(caller.workspaceId),
          listDrafts: (ws) => this.listDrafts(ws),
        },
        { workspaceId: caller.workspaceId, botId: caller.id },
        toolName,
        args,
      );
    }
    // The Dash team's role tools, checked against the caller's role.
    if (serverName === ROLE_SERVER || serverName === ROLE_BUILD_SERVER) {
      const caller = this._store.get(opts.botId);
      if (!isDashTeam(caller)) {
        return {
          text: "These tools are only for the Dash team.",
          isError: true,
        };
      }
      // A tool that changes things only runs from the server the gate asks
      // about — never through the auto-allowed one.
      if (serverForTool(toolName) !== serverName) {
        return { text: `"${toolName}" isn't served here.`, isError: true };
      }
      return handleRoleTool(
        this._roleToolDeps(),
        { botId: caller.id, role: caller.role },
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
