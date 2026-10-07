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
const { placeWidget, setWidgetPrefs } = require("../utils/placeWidget");

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
} = require("../llm/modelProviders");
const { resolveBotProviderId } = require("../bots/runProvider");
const {
  BOT_STREAM,
  BOT_APPROVAL_PENDING,
  BOT_BUDGET_ALERT,
  BOT_RUN_ACTIVE,
  BOT_LIST_CHANGED,
  BOT_DRAFTS_CHANGED,
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
      secretBox: host.secretBox,
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
      internalServers: [MEMORY_SERVER, TEAM_SERVER],
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
        source: sourceFromEvent(bot, event),
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
    const bot = this._store.get(botId);
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

  /** Global bot settings: { autoLeads }. */
  getBotSettings() {
    return this._store.getSettings();
  },

  setBotSettings(patch) {
    const { autoLeads } = patch || {};
    return this._store.setSettings(
      autoLeads === undefined ? {} : { autoLeads: !!autoLeads },
    );
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
  _proposeBot({ workspaceId, botId }, proposal) {
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
    // they don't go on the event bus (so they can't trigger bots).
    const publishes =
      !this._runner.listActive().includes(botId) &&
      !isLead(this._store.get(botId));
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
    // The bot's own provider, else the AI provider marked default; throws
    // NO_AI_MODEL_MESSAGE with neither (no silent fallback).
    const providerId = resolveBotProviderId(bot, providers);
    const provider = getProvider(providerId);
    const model = bot.model
      ? migrateModelId(providerId, bot.model)
      : getDefaultModel(providerId);

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
        { workspaceId: opts.workspaceId, botId: opts.botId },
        toolName,
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
