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

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Cron } = require("croner");
const { createElectronHost } = require("../bots/host");
const BotStore = require("../bots/BotStore");
const ApprovalRegistry = require("../bots/approvals");
const remoteApprovals = require("../bots/remoteApprovals");
const engines = require("../bots/engines");
const BotRunner = require("../bots/BotRunner");
const BotScheduler = require("../bots/BotScheduler");
const BudgetController = require("../bots/BudgetController");
const PauseController = require("../bots/PauseController");
const { createAuditLog, fromGateEntry } = require("../bots/AuditLog");
const { failureNotice, budgetNotice } = require("../bots/botNotices");
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
const { createCheckJobs } = require("../bots/checkJobs");
const { createJobStore } = require("../jobs/jobStore");
const { createJobTracker } = require("../jobs/jobTracker");
const { PausedQueue, drainBot } = require("../bots/pausedQueue");
const { BusyQueue } = require("../bots/busyQueue");
const { startsChain, chainStartedBy } = require("../jobs/chainJobs");
const {
  stopBotRun,
  whenIdle: waitUntilIdle,
  interruptAllRuns,
} = require("../bots/stopRun");

/** Resolves once the bot has no run in progress (checked every 500ms). */
async function waitForBotIdle(runner, botId) {
  while (runner.isRunning(botId)) {
    await new Promise((r) => setTimeout(r, 500));
  }
}
const {
  buildTeamManifest,
  validateTeamManifest,
  planTeamInstall,
  resolveReviewers,
  wireTeam,
  wireWidgets,
  stripBotListeners,
} = require("../bots/teamManifest");
const {
  mergeTeamValues,
  withTeamValues,
  pickFrom,
  namesUsed,
} = require("../bots/teamValues");
const {
  contextFrom,
  mergeItem,
  insideFolders,
  withEventContext,
} = require("../jobs/jobContext");
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
  checkPackagesOf,
} = require("../bots/botPackage");
const { downloadBotPackage } = require("./botRegistryInstall");
const {
  blankDashboard,
  placeWidget,
  setWidgetPrefs,
  setItemPrefs,
  addWidgetListener,
} = require("../utils/placeWidget");

// Built-in bot widgets (TEAM-012): registered by dash-core's renderer.
const BOT_WIDGETS = {
  results: "dash.bots.BotResults",
  activity: "dash.bots.BotActivity",
};
const { registryIdentity, zipAndPublish } = require("./botPublish");
const {
  createMcpTasks,
  checkPassphrase,
  cleanFrom,
  taskNoteFor,
} = require("../bots/mcpTasks");
const {
  describeTeams,
  routePrompt,
  readRoute,
} = require("../bots/taskRouting");
// How long give_task waits for the Dash Lead to pick a team (TEAM-016).
const ROUTE_WAIT_MS = 60 * 1000;
// How long the Builder's guide or the Checker waits for a provider to start
// to learn its live tools; slower, they go on without them.
const LIVE_TOOLS_WAIT_MS = 20 * 1000;
const {
  makeRegistryRef,
  readRegistryRef,
  samePackage,
} = require("../registry/packageRef");
const { validateBotDefinition, withDefaults } = require("../bots/botSchema");
const { answerShape, resultsShape } = require("../bots/answerShape");
const { readHandoff, handOnPrompt } = require("../bots/botHandoff");
const { botUpdatePatch } = require("../bots/botUpdate");
const { publishFingerprint } = require("../registry/fingerprint");
const { remixOrigin, checkRemix, checkRemixAll } = require("../registry/remix");
const { unassignTeam, isOnTeam } = require("../bots/teams");
const { createPackageStore } = require("../checks/packageStore");
const {
  TEAM_SERVER,
  TEAM_TOOLS,
  handleTeamTool,
} = require("../bots/teamTools");
const { isLead, leadOf, planEnsureLead } = require("../bots/teamLeads");
const {
  builtinFor,
  userPartOf,
  instructionsFor,
  planLayerInstructions,
  PROMPT_LAYERS,
} = require("../bots/builtinInstructions");
// Every widget item of a workspace: main layout, pages and the sidebar.
const layoutItems = (ws) =>
  [
    ws && ws.layout,
    ...((ws && ws.pages) || []).map((p) => p && p.layout),
    ws && ws.sidebarLayout,
  ]
    .filter(Array.isArray)
    .flat();
// Every widget on a dashboard, inside grid containers too — the walk and
// id rule the trigger picker uses (src/utils/providerResolution.js
// forEachWidget, listenerResolution.js itemIdOf).
const itemIdOf = (item) =>
  item == null
    ? null
    : item.id !== undefined && item.id !== null
      ? String(item.id)
      : item.uuidString || item.uuid || null;
const allWidgetItems = (ws) => {
  const out = [];
  const seen = new Set();
  const walk = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== "object" || seen.has(item)) continue;
      seen.add(item);
      if (item.component) out.push(item);
      walk(item.items);
      walk(item.layout);
    }
  };
  walk(layoutItems(ws));
  return out;
};
// A plan build that's still going (fix / retry / resume / remove wait).
const {
  askTeamBot,
  leadRunInfo,
  withPlanDashboard,
  LEAD_ASK_WAIT_MS,
} = require("../bots/leadAsk");
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
const { userRunOptions } = require("../bots/userRun");
const { captureMarks } = require("../bots/markedSpots");
const {
  ROLE_SERVER,
  ROLE_BUILD_SERVER,
  serverForTool,
  roleToolsFor,
  handleRoleTool,
  HandoffCap,
  registryBotsOf,
} = require("../bots/roleTools");
const { compareConfigs } = require("../bots/configDiff");
const {
  createPlanBuild,
  undoOnDashboard,
  themeChoices,
  resolveTheme,
  planBotDefinition,
  triggerSubscription,
  widgetWiring,
  placeChoices,
  settingKeys,
  buildNoteOf,
} = require("../bots/planBuild");
// Pure JS, main-process safe (see its header): a plan's new theme.
const { generateCustomTheme } = require("../../src/utils/themeGenerator");
// Whose a saved theme is (theme change round) — pure, shared with the app.
const {
  hasEditorChanges,
  remixName,
  themeByName,
  themeColors,
  themeOrigin,
  themePublished,
} = require("../../src/utils/themeStanding");
const { planLost, planTarget, validatePlan } = require("../bots/teamPlan");
const { resolveEditTarget, ownsWidget } = require("../bots/editTarget");
const { checkBot } = require("../bots/checkBot");
const { summarizeSpending } = require("../bots/spending");
const { resolveWidgetComponent } = require("../bots/widgetComponent");
const { CreateRecent } = require("../bots/createRecent");
const {
  conversationFacts,
  buildFacts,
  aboutDashboard,
  MEMORY_NOTE,
} = require("../bots/planMemory");
const { recentRuns, lastRuns } = require("../bots/recentRuns");
const { coalesce } = require("../bots/coalesce");
const { findProviders } = require("../bots/providerDiscovery");
const { searchRegistry } = require("../bots/registrySearch");

const { onWorkspaceDeleted } = require("../utils/workspaceEvents");
const profileMembership = require("../profile/profileMembership");
const {
  checkChain,
  chainLimit,
  rootCause,
  causeFromEvent,
  sourceFromEvent,
  composeEventPrompt,
  botEventType,
  botRef,
} = require("../bots/botEvents");
const {
  RESULTS_SERVER,
  resultToolsFor,
  checkResult,
  sendResult,
  latestResult,
} = require("../bots/resultTools");
const {
  lastAnswers,
  latestCompleted,
  describeAnswers,
} = require("../bots/lastAnswers");
const { cleanWire, withWireProblems } = require("../bots/widgetWire");
const issueController = require("./issueController");
const goalController = require("./goalController");
const flowController = require("./flowController");
const { flowBotHooks } = require("../flows/flowBotHooks");
const {
  GOALS_SERVER,
  GOAL_TOOLS,
  LEAD_GOAL_TOOLS,
  handleGoalTool,
} = require("../goals/goalTools");
const { botRunIssues } = require("../issues/issueSources");
const {
  listToolSources,
  ensureBotServers,
  resolveBotTools,
  resolveBotConnectors,
  CONNECTOR_CLASS,
  checkToolCall,
} = require("../bots/toolSources");
const { gitTokenFor } = require("../bots/gitSignIn");
// What a bot with a GitHub provider is told about git (DASH-55).
const GIT_SIGNED_IN_NOTE =
  "git and gh are signed in to GitHub for this run, from your GitHub provider: clone, push and open pull requests with them as usual (https://github.com/… or git@github.com:… addresses both work). Never print, echo or write down the token.";
const {
  createConnectorLister,
  readClaudeAuthStatus,
} = require("../bots/claudeConnectors");
// How long Dash leaves a connector it has stopped trying, before it tries
// once more by itself.
const GIVEN_UP_MS = 60 * 60 * 1000;
const {
  rememberToolGrant,
  forgetToolGrant,
  summarizeGrants,
  rememberBuiltinGrant,
  builtinAllowed,
  forgetBuiltinGrant,
  forgetFolders,
  changeProviderGrant,
  alwaysAllowedRows,
  webFetchTarget,
} = require("../bots/rememberGrant");
// How many recent "Always allow" answers can still be undone.
const UNDO_KEPT = 50;

/**
 * Keep how an approval was settled (the last 200), so a later answer over
 * MCP hears who answered first and how (DASH-32). The first record wins.
 */
function recordAnswer(ctl, approvalId, decision) {
  if (!ctl._answerLog) ctl._answerLog = remoteApprovals.createAnswerLog();
  const answer = remoteApprovals.answerOf(decision, Date.now());
  ctl._answerLog.record(approvalId, answer);
  return ctl._answerLog.get(approvalId) || answer;
}
// A test's id, picked by the form (bot-test-run): never a saved bot's.
const TEST_ID_RE = /^test-[a-z0-9]{6,40}$/;
// The most a sample sent with a save may be (an answer is cut at 32 KB).
const MAX_SAMPLE_BYTES = 512 * 1024;

// ---- Jobs (DASH-28, DASH-31): who or what started a step ------------------

// "Delete finished jobs after 90 days", when the user turns it on.
const OLD_JOB_DAYS = 90;

/** "bot:local/designer[b1].completed" → "Completed". */
function eventWord(eventType) {
  const last =
    String(eventType || "")
      .split(".")
      .pop() || "";
  return last ? last.charAt(0).toUpperCase() + last.slice(1) : "";
}

/** Who started a lead's job: a task over MCP, or the user in Dash. */
function jobStartedBy(opts = {}) {
  const m = /^mcp-task(?::(.*))?$/.exec(String(opts.via || ""));
  if (m) return { kind: "task", label: m[1] || "MCP" };
  if (/^mcp/.test(String(opts.via || ""))) return { kind: "mcp", label: "MCP" };
  return { kind: "you" };
}

/** How many bots are on the team (dashboard) `workspaceId` (DASH-69). */
function teamSizeOf(store, workspaceId) {
  if (workspaceId === null || workspaceId === undefined) return 0;
  if (!store || typeof store.list !== "function") return 0;
  const ws = String(workspaceId);
  return store
    .list()
    .filter((b) => b && b.workspaceId != null && String(b.workspaceId) === ws)
    .length;
}

/** A hand-on: which bot's event started it. */
function handOnWhy(store, event, bot) {
  const from = event && event.originBotId ? store.get(event.originBotId) : null;
  const sub = ((bot && bot.subscriptions) || []).find(
    (s) => s && s.eventType === (event && event.eventType),
  );
  return {
    kind: "handon",
    by: (from && from.name) || null,
    label: (sub && sub.label) || eventWord(event && event.eventType),
  };
}

/** Why a run is a step in its job. */
function jobWhy(store, bot, opts = {}) {
  if (isLead(bot)) return { ...jobStartedBy(opts) };
  const lead = /^lead:(.+)$/.exec(String(opts.via || ""));
  if (lead) {
    const l = store.get(lead[1]);
    return { kind: "asked", by: (l && l.name) || null };
  }
  if (opts.trigger === "event" && opts.source) {
    const from = opts.source.originBotId
      ? store.get(opts.source.originBotId)
      : null;
    return {
      kind: "handon",
      by: (from && from.name) || null,
      label: opts.source.label || eventWord(opts.source.eventType),
    };
  }
  return { kind: opts.trigger || "run" };
}

/** A test's sample, as test() made it, small enough to keep. */
function isSample(sample) {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
    return false;
  }
  if (typeof sample.answer !== "string" || !Array.isArray(sample.results)) {
    return false;
  }
  try {
    return JSON.stringify(sample).length <= MAX_SAMPLE_BYTES;
  } catch (_e) {
    return false;
  }
}
const grantStore = require("../mcp/grantedPermissions");
const { isWriteTool, PATH_ARG_KEYS } = require("../mcp/permissionGate");
const {
  PROVIDERS: AI_PROVIDERS,
  getProvider,
  getDefaultModel,
  getCuratedModels,
  migrateModelId,
  isKnownModel,
  modelText,
  latestAlias,
} = require("../llm/modelProviders");
const {
  resolveBotProviderId,
  DEFAULT_BOT_PROVIDER,
} = require("../bots/runProvider");
const {
  readAi,
  mergeAiSettings,
  backendProvider,
  defaultModelFor,
  jobOf,
  JOB_NAMES,
  styleFor,
  runLimitsFor,
  defaultMonthlyLimitFor,
  planFollowDefault,
  runsAgainWithinHour,
} = require("../bots/aiDefaults");
const {
  BOT_STREAM,
  BOT_APPROVAL_PENDING,
  BOT_APPROVALS_CHANGED,
  BOT_BUDGET_ALERT,
  BOT_RUN_ACTIVE,
  BOT_LIST_CHANGED,
  BOT_OPEN_REQUEST,
  BOT_PLAN_BUILD_PROGRESS,
  BOT_MCP_TASKS_CHANGED,
  BOT_JOBS_CHANGED,
  CREATE_RECENT_CHANGED,
} = require("../events/botEvents");
const { LLM_MODEL_LIST_CHANGED } = require("../events/llmEvents");
const { startModelList } = require("../llm/modelListHost");
const {
  retiredUsage,
  moveTarget,
  countFollowing,
  planMove,
} = require("../llm/modelUsage");

// The Dash Lead's routing log keeps this many (TEAM-016).
const MAX_ROUTES = 50;

const { runCost } = require("../bots/runCost");

/**
 * A change's plan, held to its widget (Phase 3): its one widget piece is
 * that package as an update, or a new widget — whatever the Planner wrote.
 * Anything else stays, for validatePlan to refuse.
 */
function editPlan(plan, target) {
  let seen = false;
  // A change goes to a widget, never to a dashboard.
  const { dashboard: _dashboard, ...rest } = plan;
  return {
    ...rest,
    pieces: plan.pieces.map((p) => {
      if (!p || p.kind !== "widget" || seen) return p;
      seen = true;
      if (target.mode === "update") {
        return { ...p, source: "update", package: target.package };
      }
      const { package: _pkg, ...rest } = p;
      return { ...rest, source: "new" };
    }),
  };
}

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
      // Sends an OS notification for a bot notice (failed run, budget at
      // 80% or over — US-018 AC5, US-019 AC3). Optional.
      notify = null,
      // The host's widget build/check hooks for the Dash team (CRE-011,
      // dash-electron teamWidgetTools.cjs). Optional.
      widgetTools = null,
    } = deps;
    this._widgetTools = widgetTools;
    // The host checks a widget's provider calls against the user's live
    // tools (what each takes) — it asks here for them.
    if (widgetTools && typeof widgetTools.useLiveTools === "function") {
      widgetTools.useLiveTools((types) => this._liveToolsFor(types));
    }
    this._notify = typeof notify === "function" ? notify : null;
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

    // The saved audit log (US-003 AC5, US-014 AC9, US-019 AC6): approvals,
    // tools that ran without asking, access, pause and stop, budgets, and
    // bots created or deleted. Names only.
    this._auditLog =
      host.paths && host.paths.auditLog
        ? createAuditLog({ file: host.paths.auditLog })
        : null;

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
      create: (request) => this._createApproval(request),
    };

    // Tasks given to teams via MCP (TEAM-016). One that was running when
    // Dash closed didn't finish.
    // Every change tells open windows, so task lists and Settings › MCP
    // Server refresh (one broadcast per burst).
    this._notifyTasksChanged = coalesce(() =>
      this._broadcast(BOT_MCP_TASKS_CHANGED, {}),
    );
    this._mcpTasks = createMcpTasks({
      store: {
        loadTasks: () => this._store.getMcpTasks(),
        saveTasks: (list) => {
          this._store.setMcpTasks(list);
          this._notifyTasksChanged();
        },
        getPassphrase: () => this._store.getTaskPassphrase(),
        getLock: () => this._store.getTaskLock(),
        saveLock: (lock) => {
          this._store.setTaskLock(lock);
          this._notifyTasksChanged();
        },
      },
    });
    this._mcpTasks.recover();

    // ask_role hand-offs per Planner run (CRE-011 AC4).
    this._handoffs = new HandoffCap();

    // Pause state (global kill switch + per-bot), enforced at the gate and
    // before a run starts; saved so it survives a restart (CRE-011 AC3).
    this._pause = new PauseController({
      persistence: {
        load: () => this._store.getPauseState(),
        save: (state) => this._store.setPauseState(state),
      },
      audit: (entry) => this._logAudit(entry),
    });
    // Events that came in for paused / over-budget bots, kept until they're
    // resumed (US-011 AC8); sealed and saved with the bots.
    this._pausedQueue = new PausedQueue({
      persistence: {
        load: () => this._store.getPausedQueue(),
        save: (q) => this._store.setPausedQueue(q),
      },
    });

    // Budgets: accrue per-run cost, auto-pause bots over their monthly cap.
    this._budgets = new BudgetController({
      persistence: host.budgetPersistence,
      getPricing: pricingFor,
      // Limit changes and "Keep running this month" (US-019 AC6); per-run
      // usage isn't logged — it's in Spending.
      audit: (entry) => this._logBudgetAudit(entry),
      // Settings › AI: the monthly limit a bot without its own gets.
      defaultBudget: (botId) =>
        defaultMonthlyLimitFor(
          this._store.get(botId),
          readAi(this._store.getSettings()),
        ),
    });

    // Scoped, durable bot memory (P1: FR-010), served as in-process memory_*
    // tools that every bot can use without a consent prompt.
    this._memory = new BotMemory({ persistence: host.memoryPersistence });
    // Create's Recent (4e-1): conversations and builds survive a restart; a
    // build that was running when the app closed is "interrupted".
    this._recent = new CreateRecent({
      persistence: host.recentPersistence || {
        read: () => this._recentBlob || { entries: {} },
        write: (o) => {
          this._recentBlob = o;
        },
      },
    });
    try {
      this._recent.markInterrupted();
    } catch (err) {
      console.error("[botController] Recent couldn't be read:", err);
    }
    this._recent.onChange(() => this._broadcast(CREATE_RECENT_CHANGED, {}));

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
      // A result held for the bot's checks is saved as its latest when it
      // goes out (bot-checks PRD).
      saveResult: (bot, payload) =>
        this._store.setResult(bot.id, payload.name, payload),
    });

    // A bot's work held for its checks (bot-checks PRD): a job on the
    // ledger until it passes, then it goes on.
    this._checkJobs = createCheckJobs({
      goals: () => goalController.store(),
      // As it runs: its team's settings filled in (DASH-57).
      getBot: (id, ctx) => this.resolvedBot(id, ctx),
      publisher: this._events,
      patchRun: (id, startedAt, patch) => {
        const r = this._store.patchRun(id, startedAt, patch);
        // The job's step follows its checks (DASH-31).
        if (patch && patch.checks && patch.checks.goalId && this._jobs) {
          this._jobs.checksMoved(patch.checks.goalId, patch.checks.state);
        }
        return r;
      },
      getRuns: (id) => this._store.getRuns(id),
      // Its team uses the standard handoff (DASH-101): its checks start
      // with the built-in Handoff check.
      handoffFor: (bot) =>
        bot && this.usesHandoffs(bot.workspaceId)
          ? { handoff: true, tables: this._tableKeys(bot.workspaceId) }
          : null,
      notify: (botId, info) => {
        this._broadcast(BOT_STREAM, {
          botId,
          event: { type: "checked", ...info },
        });
        // Checks waiting on the user show on the job (DASH-31).
        if (info && info.goalId && this._jobs) {
          if (info.handOn === false) this._nothingToHandOn(info);
          else
            this._jobs.checksMoved(
              info.goalId,
              info.state,
              // A handoff's question shows on the job (DASH-101).
              info.ask ? info.reason : null,
            );
        }
      },
    });

    // Jobs (DASH-28, DASH-31): each chain of work through a team lead —
    // the lead's run, the bots it asks, their checks and hand-ons — kept on
    // this computer until the user deletes them.
    this._jobs = createJobTracker({
      store: createJobStore({
        root: path.join(path.dirname(this._botsRoot), "jobs"),
        box: host.secretBox || null,
      }),
      onChange: (job) =>
        this._broadcast(BOT_JOBS_CHANGED, {
          jobId: job.id,
          workspaceId: job.workspaceId,
          status: job.status,
        }),
    });
    this._jobs.interruptLeftovers();
    // Check packages installed on this computer (DASH-106).
    this._checkPackages = createPackageStore({
      root: path.join(path.dirname(this._botsRoot), "check-packages"),
    });
    // What waited for the jobs (tasks queued before a restart, DASH-81).
    for (const fn of this._jobsReady || []) this._callReady(fn);
    this._jobsReady = null;
    // Only if the user asked: finished jobs older than 90 days, now and
    // once a day.
    this._clearOldJobs();
    if (this._clearJobsTimer) clearInterval(this._clearJobsTimer);
    this._clearJobsTimer = setInterval(() => this._clearOldJobs(), 86400000);
    if (typeof this._clearJobsTimer.unref === "function") {
      this._clearJobsTimer.unref();
    }

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
        // The dashboard's own goals ledger (goals-ledger PRD).
        GOALS_SERVER,
      ],
      resolveRunProfile: (bot) => this._resolveRunProfile(bot),
      // A built-in tool call the user chose Always allow for.
      builtinAllowed: (req) =>
        builtinAllowed(grantStore.getGrant(req.botId), req.toolName, req.input),
      // Tools that ran (or were refused) without asking.
      audit: (entry) => {
        const logged = fromGateEntry(entry);
        if (logged) this._logAudit(logged);
      },
      // A paused bot doesn't start at all (CRE-011 AC3), and nor does one
      // over its budget (US-019 AC4) — it would still spend on the model.
      startBlocker: (botId) => {
        // A test from the bot's form (bot-test-run): only Pause all, or the
        // saved bot's budget, stops it.
        const testing = this._testing(botId);
        if (testing) return this._testBlocked(testing);
        // A test run the user started goes ahead (Phase 1d) — not while
        // everything is paused.
        const testRun =
          !!this._testRuns &&
          this._testRuns.has(botId) &&
          !this._pause.isGloballyPaused();
        if (!this._inActiveProfile(this._store.get(botId)))
          return "this bot isn't in the active profile";
        if (this._pause.isGloballyPaused()) return "all bots are paused";
        if (this._pause.isPaused(botId) && !testRun)
          return "this bot is paused";
        const bot = this._store.get(botId) || {};
        return this._budgets.isOverBudget(botId, bot.workspaceId)
          ? "this bot is over its budget"
          : null;
      },
      // The run's options too: a planning hand-off (adviseOnly) gets no
      // build tools.
      resolveTools: (bot, runOpts) => this._resolveTools(bot, runOpts),
      callTool: (serverName, toolName, args, o) =>
        this._callTool(serverName, toolName, args, o),
      // Paused at the permission gate when: globally/individually paused, or
      // over any applicable budget.
      isPaused: (botId) =>
        this._testing(botId)
          ? this._testBlocked(this._testing(botId)) !== null
          : (this._pause.isPaused(botId) &&
              !(
                this._testRuns &&
                this._testRuns.has(botId) &&
                !this._pause.isGloballyPaused()
              )) ||
            this._budgets.isOverBudget(
              botId,
              (this._store.get(botId) || {}).workspaceId,
            ),
      // A run whose model is gone: check the list, then run on what replaces
      // it, else on its job's default.
      replacementModel: (gone) => this._replacementModel(gone),
      modelName: (providerId, id) => modelText(providerId, id),
      // The run's cost on its record — the same rule as the monthly totals.
      costOf: ({ providerId, model, usage }) =>
        runCost({ providerId, usage, pricing: pricingFor(providerId, model) }),
      // After each run, accrue cost and alert on warn/exceeded.
      onUsage: (u) => {
        // Before and after, so a run that moves a limit to 80% or over it
        // notifies once (US-019 AC3).
        const before = this._budgets.status(u.botId, u.workspaceId);
        const r = this._budgets.recordUsage(u);
        this._sendNotice(
          budgetNotice({
            bot: this._store.get(u.botId),
            before,
            after: r.status,
            dashboardNameOf: (id) => this._dashboardName(id),
          }),
        );
        if (r.status.overall !== "ok" && u.botId) {
          this._broadcast(BOT_BUDGET_ALERT, {
            botId: u.botId,
            cost: r.cost,
            estimated: r.estimated,
            status: r.status,
          });
        }
      },
    });

    // A goal's runs live with the bots' runs: the ledger finds them by
    // goal id, and deleting a goal removes them.
    goalController.useRuns({
      runsFor: (goalId) => this._store.runsForGoal(goalId),
      removeRuns: (goalId) => this._store.removeRunsForGoal(goalId),
      // A run still working on a deleted goal drops its id, so the record
      // it saves and the events it sends don't bring the goal back.
      forget: (goalId) => {
        for (const g of (this._runGoals || new Map()).values()) {
          if (g && g.goalId === goalId) {
            g.goalId = null;
            g.taskId = null;
          }
        }
      },
    });
    if (this._offCheckJobs) this._offCheckJobs();
    this._offCheckJobs = goalController.onChange((change) =>
      this._checkJobs.onChange(change),
    );

    this._scheduler = new BotScheduler({
      Cron,
      runBot: (botId, opts) => this._run(botId, opts),
    });

    // A bot's checks jobs move on by running its bot, its checks and its
    // reviewers (bot-checks PRD).
    flowController.useBots(flowBotHooks(this));

    // Register schedules for existing bots and run any that were missed while
    // Dash was closed.
    const bots = this._activeBots();
    this._scheduler.registerAll(bots);
    for (const bot of bots)
      this._scheduler.catchUp(bot, this._lastRunAt(bot.id));

    // A deleted dashboard's team becomes unassigned + paused — never deleted,
    // never left running somewhere unexpected (bot-teams TEAM-001). Its lead
    // is removed: it has nothing left to lead.
    if (this._offWorkspaceDeleted) this._offWorkspaceDeleted();
    this._offWorkspaceDeleted = onWorkspaceDeleted((workspaceId) => {
      // Its goals go with it: tasks, evidence, work files and their runs.
      goalController.forgetWorkspace(workspaceId);
      unassignTeam(
        {
          store: this._store,
          pause: this._pause,
          deleteLead: (id) => this.delete(id),
        },
        workspaceId,
      );
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

    this.ensureDashTeam();
    this.layerInstructionsOnce();
    this.followDefaultOnce();

    this._ready = true;
    // The fresh model list: checked now, daily and on wake (modelList.js).
    if (!this._modelList) {
      this._modelList = startModelList({
        getApiKey: async () => this._anthropicKey(),
        onChange: (status) => this._broadcast(LLM_MODEL_LIST_CHANGED, status),
      });
    }
    // Events kept for bots that are no longer held (resumed before Dash
    // last quit, or a new month for an over-budget bot) run now.
    setImmediate(() => this._drainQueued());
  },

  /**
   * The Dash team (CRE-011): create any missing role bots. Safe to call any
   * time.
   */
  ensureDashTeam() {
    const created = [];
    for (const step of planEnsureDashTeam(this._store.list())) {
      try {
        created.push(this._store.create(step.definition));
      } catch (_e) {
        // A broken store shouldn't stop the app starting; the team is
        // retried on the next launch.
      }
    }
    return created;
  },

  /**
   * Once per bot (TEAM-017): leads and Dash team bots made before the
   * built-in instructions were kept apart hold a copy of them in
   * `instructions`. Take the copy out and keep the user's own words. Safe to
   * call any time; bots already done are skipped.
   */
  layerInstructionsOnce() {
    const done = [];
    for (const step of planLayerInstructions(this._store.list(), (id) =>
      this._dashboardName(id),
    )) {
      try {
        this._store.update(step.id, {
          instructions: step.instructions,
          promptLayers: PROMPT_LAYERS,
          // Its settings say once what happened to the user's own text.
          ...(step.instructions ? { layersNotice: true } : {}),
        });
        done.push(step.id);
      } catch (_e) {
        // Retried on the next launch; runs take the copy out meanwhile.
      }
    }
    return done;
  },

  /**
   * A bot's built-in instructions and the user's own, for its settings. No
   * id: a new bot's (the rules every bot gets).
   * @returns {{ builtin: string, user: string, notice: boolean } |
   *           { error: string }}
   */
  builtinInstructions(botId) {
    if (!botId) return { builtin: builtinFor({}), user: "", notice: false };
    const bot = this._store.get(botId);
    if (!bot) return { error: "Bot not found" };
    const dashboardName = isLead(bot)
      ? this._dashboardName(bot.workspaceId)
      : null;
    return {
      builtin: builtinFor(bot, { dashboardName }),
      user: userPartOf(bot, { dashboardName }),
      notice: bot.layersNotice === true,
    };
  },

  /** The user read the note about their text being kept (TEAM-017). */
  dismissLayersNotice(botId) {
    const bot = this._store.get(botId);
    if (!bot || !bot.layersNotice) return { ok: true };
    this._store.update(botId, { layersNotice: false });
    return { ok: true };
  },

  /**
   * Once (Settings › AI): bots that saved Claude Code (CLI) only because it
   * was the default — no model or engine of their own — follow Settings › AI
   * instead, so choosing the API key there moves them too.
   */
  followDefaultOnce() {
    try {
      const settings = this._store.getSettings();
      if (readAi(settings).migrated) return [];
      const ids = planFollowDefault(this._store.list());
      for (const id of ids) this._store.update(id, { provider: null });
      this._store.setSettings({
        ai: mergeAiSettings(settings.ai, { migrated: true }),
      });
      return ids;
    } catch (_e) {
      // Retried on the next launch.
      return [];
    }
  },

  /** Re-evaluate missed schedules on system resume (powerMonitor). */
  handleResume() {
    if (!this._ready) return;
    for (const bot of this._activeBots()) {
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
    const bots = matchSubscribedBots(this._activeBots(), event, {
      excludeBotId: event.originBotId,
    });
    for (const bot of bots) {
      const loop = checkChain(
        event,
        bot.id,
        chainLimit(teamSizeOf(this._store, bot.workspaceId)),
      );
      if (!loop.ok) {
        this._refuseHandOn(bot, event, loop.reason);
        continue;
      }
      // Paused or over budget (US-011 AC8): keep it for when the bot is
      // resumed, or log it as skipped — never drop it silently.
      if (this._isHeld(bot.id)) {
        this._holdEvent(bot, event);
        continue;
      }
      // A hand-on from another bot never drops because its bot is busy
      // (DASH-73): it waits its turn behind what's already waiting.
      if (event.originBotId && this._mustWait(bot.id)) {
        this._queueHandOn(bot, event);
        continue;
      }
      if (!this._dispatcher.shouldDispatch(bot.id)) {
        // In a job, the hand-on that didn't start is said (DASH-31).
        const jobId = this._handOnJob(event, bot);
        if (jobId) {
          this._jobs.skipStep(jobId, {
            botId: bot.id,
            botName: bot.name,
            why: handOnWhy(this._store, event, bot),
            summary: `${bot.name} ran moments ago, so this hand-on was skipped.`,
          });
        }
        continue;
      }
      this._dispatcher.note(bot.id);
      this._runEvent(bot, event);
    }
  },

  /**
   * A hand-on the loop guard refused (a loop, or a chain past its limit).
   * Never silent (DASH-69): it's said on the Activity feed, kept as a
   * skipped step on the job, and notified, since the rest of the chain
   * (its failure paths included) won't run.
   */
  _refuseHandOn(bot, event, reason) {
    const message = `Not triggered by ${event.eventType}: ${reason}.`;
    this._broadcast(BOT_STREAM, {
      botId: bot.id,
      event: { type: "warning", message },
    });
    const jobId = this._handOnJob(event, bot);
    if (jobId) {
      this._jobs.skipStep(jobId, {
        botId: bot.id,
        botName: bot.name,
        why: handOnWhy(this._store, event, bot),
        summary: `${bot.name} didn't run: ${reason}.`,
      });
    }
    if (!isDashTeam(bot)) {
      this._sendNotice({
        kind: "failed",
        botId: bot.id,
        title: "Bot chain stopped",
        body: `${bot.name} didn't run: ${reason}.`,
      });
    }
  },

  /**
   * A bot's checks passed its work with nothing to hand on (DASH-65): its
   * step is done, saying so. A chain's job that is only that step (a
   * scheduled Ticket Bot that found no ticket) isn't kept: nothing
   * happened.
   */
  _nothingToHandOn(info) {
    const jobId = this._jobs.jobForGoal(info.goalId);
    this._jobs.checksMoved(
      info.goalId,
      "passed",
      // A handoff says how it ended (DASH-101): "Nothing to do: …" or
      // "Split into DASH-97, DASH-98".
      info.ended
        ? info.reason
        : `Nothing to hand on${info.reason ? `: ${info.reason}` : ""}.`,
    );
    const job = jobId ? this._jobs.get(jobId) : null;
    // A split is kept: something happened (the job says what it became).
    if (
      job &&
      info.ended !== "split" &&
      !job.leadId &&
      (job.steps || []).length === 1
    ) {
      if (this._jobs.remove(job.id)) {
        this._broadcast(BOT_JOBS_CHANGED, {
          jobId: job.id,
          workspaceId: job.workspaceId,
          status: "deleted",
        });
      }
    }
  },

  /** Hand-ons waiting for busy bots (DASH-73), made on first use. */
  _busy() {
    if (!this._busyQueue) this._busyQueue = new BusyQueue();
    return this._busyQueue;
  },

  /**
   * A bot is busy while it runs, and while its checks are still trying a
   * run's work (a new run would mix with that work).
   */
  _isBusy(botId) {
    if (this._runner && this._runner.listActive().includes(botId)) return true;
    try {
      return !!(
        this._checkJobs &&
        this._checkJobs.checkingFor &&
        this._checkJobs.checkingFor(botId)
      );
    } catch (_e) {
      return false;
    }
  },

  /** Must a hand-on to this bot wait? Busy, others already waiting, or it
   * only just ran (the cooldown would have skipped it). */
  _mustWait(botId) {
    return (
      this._isBusy(botId) ||
      this._busy().count(botId) > 0 ||
      !this._dispatcher.shouldDispatch(botId)
    );
  },

  /**
   * Keep a hand-on for a busy bot: said on the job as queued and on the
   * Activity feed, then run in order when the bot is free. Too many already
   * waiting: refused like a chain past its limit (never silent).
   */
  _queueHandOn(bot, event) {
    const queue = this._busy();
    if (!queue.add(bot.id, event)) {
      this._refuseHandOn(
        bot,
        event,
        `${queue.max} hand-ons are already waiting for it`,
      );
      return;
    }
    const jobId = this._handOnJob(event, bot);
    if (jobId && this._jobs.queueStep) {
      this._jobs.queueStep(jobId, {
        botId: bot.id,
        botName: bot.name,
        why: handOnWhy(this._store, event, bot),
        summary: `${bot.name} is busy with another run; this starts when it's done.`,
      });
    }
    this._broadcast(BOT_STREAM, {
      botId: bot.id,
      event: {
        type: "status",
        message: `${bot.name} is busy, so ${event.eventType} waits its turn (${queue.count(bot.id)} waiting).`,
      },
    });
    this._notifyListChanged();
    this._drainBusy(bot.id);
  },

  /**
   * Run what waits for a bot, oldest first, each once the bot is free.
   * One drain per bot; fire-and-forget.
   */
  _drainBusy(botId) {
    if (!this._busyDraining) this._busyDraining = new Set();
    if (this._busyDraining.has(botId)) return;
    this._busyDraining.add(botId);
    const pollMs = this._busyPollMs || 500;
    const sleep = () => new Promise((r) => setTimeout(r, pollMs));
    const queue = this._busy();
    (async () => {
      while (queue.count(botId)) {
        while (this._isBusy(botId) || !this._dispatcher.shouldDispatch(botId)) {
          await sleep();
        }
        const event = queue.shift(botId);
        if (!event) break;
        const bot = this._store.get(botId);
        if (!bot) {
          queue.clear(botId);
          break;
        }
        // Its job was stopped meanwhile: it doesn't start.
        if (event.jobId && this._jobs && !this._jobs.isOpen(event.jobId)) {
          continue;
        }
        // Paused (or over budget) while it waited: kept for when it's back.
        if (this._isHeld(botId)) {
          this._holdEvent(bot, event);
          continue;
        }
        this._dispatcher.note(botId);
        const rec = await this._runEvent(bot, event);
        if (rec && rec.skipped && /in progress/.test(rec.reason || "")) {
          // Something else started it first: wait again.
          queue.unshift(botId, event);
        }
        this._notifyListChanged();
      }
    })()
      .catch(() => {})
      .finally(() => {
        this._busyDraining.delete(botId);
        // Something arrived as the drain ended: go again.
        if (queue.count(botId)) this._drainBusy(botId);
      });
  },

  /** Run a bot for an event it subscribes to (live, or kept while paused). */
  _runEvent(bot, event) {
    // The owner's note on the trigger that matched (TEAM-014), if any.
    const sub = (bot.subscriptions || []).find(
      (s) => s && s.eventType === event.eventType,
    );
    const note = sub && sub.note;
    return this._run(bot.id, {
      // A team that uses handoffs (DASH-101) gets the job's context and the
      // bot before's handoff, not the raw event.
      prompt:
        this._handOnPrompt(bot, event, note) || composeEventPrompt(event, note),
      trigger: "event",
      cause: causeFromEvent(event),
      source: sourceFromEvent(bot, event),
    });
  },

  /**
   * The hand-on prompt (DASH-101) for a bot whose team uses handoffs, when
   * the event is a bot's `completed` whose answer ends with a handoff; null
   * otherwise (the raw event is given, as before).
   */
  _handOnPrompt(bot, event, note) {
    try {
      if (!bot || !this.usesHandoffs(bot.workspaceId)) return null;
      if (!/\.completed$/.test(String(event && event.eventType))) return null;
      const c = event.content;
      if (!c || typeof c.output !== "string") return null;
      const tables = this._tableKeys(bot.workspaceId);
      const handoff = readHandoff(c.output, { tables });
      if (!handoff.found) return null;
      const from = event.originBotId
        ? this._store.get(event.originBotId)
        : null;
      const ctx =
        event.jobId && this._jobs && this._jobs.contextOf
          ? this._jobs.contextOf(event.jobId)
          : { item: c.item || null, workspace: c.workspace || null };
      const picks = {
        ...(event.jobId && this._jobs && this._jobs.picksOf
          ? this._jobs.picksOf(event.jobId)
          : {}),
        ...handoff.picks,
      };
      return handOnPrompt({
        from: (from && from.name) || c.botName || null,
        item: ctx.item || c.item || null,
        workspace: ctx.workspace || c.workspace || null,
        picks,
        handoff,
        note,
      });
    } catch (_e) {
      return null;
    }
  },

  /** The keys a team's table picks use in a handoff ("repo"). */
  _tableKeys(workspaceId) {
    try {
      const team = this._store.getTeamSettings(workspaceId) || {};
      return (Array.isArray(team.declared) ? team.declared : [])
        .filter((d) => d && d.type === "table")
        .map((d) => d.pick || d.name)
        .filter((n) => typeof n === "string");
    } catch (_e) {
      return [];
    }
  },

  /** A bot that won't run now: paused, or over its budget. */
  _isHeld(botId) {
    const bot = this._store.get(botId) || {};
    return (
      this._pause.isPaused(botId) ||
      this._budgets.isOverBudget(botId, bot.workspaceId)
    );
  },

  /**
   * An event for a held bot, per its `whilePaused` (US-011 AC8): "queue"
   * (default) keeps the latest per trigger for when it's resumed; "drop"
   * logs it in Activity as skipped.
   */
  _holdEvent(bot, event) {
    const source = sourceFromEvent(bot, event);
    // In a job (DASH-31): the hand-on waits for the user, or is skipped.
    const jobId = this._handOnJob(event, bot);
    if (jobId) {
      const why = handOnWhy(this._store, event, bot);
      const paused = this._pause.isPaused(bot.id);
      const held = paused ? "is paused" : "is over its budget";
      if (bot.whilePaused === "drop") {
        this._jobs.skipStep(event.jobId, {
          botId: bot.id,
          botName: bot.name,
          why,
          summary: `${bot.name} ${held} and skips events meanwhile, so it didn't run.`,
        });
      } else {
        this._jobs.waitStep(event.jobId, {
          botId: bot.id,
          botName: bot.name,
          why,
          summary: paused
            ? `${bot.name} is paused, so it hasn't started. Turn it on and it starts.`
            : `${bot.name} is over its budget, so it hasn't started.`,
          waiting: paused ? "paused" : "budget",
        });
      }
    }
    if (bot.whilePaused === "drop") {
      const now = new Date().toISOString();
      this._store.appendRun(bot.id, {
        trigger: "event",
        status: "skipped",
        skipped: "paused",
        startedAt: now,
        endedAt: now,
        usage: null,
        error: null,
        output: "",
        prompt: "",
        toolCalls: [],
        approvals: [],
        source,
      });
    } else {
      this._pausedQueue.add(bot.id, event.eventType, {
        event,
        label: (source && source.label) || event.eventType,
      });
    }
    // Lists refresh: "1 event waiting", or the skipped entry.
    this._notifyListChanged();
  },

  /**
   * Run what waited for resumed bots, one after another per bot (US-011
   * AC8). Bots still held keep theirs. Fire-and-forget.
   * @param {string[]} [botIds] defaults to every bot with something waiting
   */
  _drainQueued(botIds) {
    const ids = botIds || this._pausedQueue.botIds();
    for (const botId of ids) {
      if (!this._pausedQueue.count(botId) || this._isHeld(botId)) continue;
      // Another profile's bot keeps its events until that profile is active.
      if (!this._inActiveProfile(this._store.get(botId))) continue;
      drainBot({
        queue: this._pausedQueue,
        botId,
        isHeld: (id) => this._isHeld(id),
        runOne: (item) => this._runQueued(botId, item),
      })
        .then(() => {
          const name = (this._store.get(botId) || {}).name || "The bot";
          this._jobs.releaseWaiting(
            botId,
            `${name} ran a newer event instead of this one.`,
          );
          this._notifyListChanged();
        })
        .catch(() => {});
      this._notifyListChanged();
    }
  },

  /** One waiting event's run — after any run the bot is already doing. */
  async _runQueued(botId, item) {
    for (let tries = 0; tries < 3; tries++) {
      await waitForBotIdle(this._runner, botId);
      const bot = this._store.get(botId);
      if (!bot) return null;
      const rec = await this._runEvent(bot, item.event);
      if (!(rec && rec.skipped && /in progress/.test(rec.reason || ""))) {
        return rec;
      }
    }
    return null;
  },

  // ---- IPC-facing operations ---------------------------------------------

  /** Every bot the user made — the Dash team is listed separately. */
  list() {
    return this._activeBots().filter((b) => !isDashTeam(b));
  },

  /**
   * Bots in the active profile, plus the Dash team (shared by every
   * profile). With only Default, every bot.
   */
  _activeBots() {
    return this._store.list().filter((b) => this._inActiveProfile(b));
  },

  _inActiveProfile(bot) {
    if (!bot || isDashTeam(bot) || !this._appId) return true;
    return profileMembership.isActiveMember(this._appId, "bots", bot.id);
  },

  /**
   * After a profile switch: schedule the new profile's bots (catching up
   * missed runs), unschedule and stop the rest, and run anything queued
   * for the bots that are now active. A bot in both profiles keeps going.
   */
  applyActiveProfile() {
    if (!this._ready) return;
    for (const bot of this._store.list()) {
      if (this._inActiveProfile(bot)) {
        this._scheduler.register(bot);
        this._scheduler.catchUp(bot, this._lastRunAt(bot.id));
      } else {
        this._scheduler.unregister(bot.id);
        if (this._runner.listActive().includes(bot.id)) this.stop(bot.id);
      }
    }
    this._drainQueued();
    this._notifyListChanged();
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
      // The model it runs on now, the same pick a run makes.
      const pick = this._modelPick(bot, settings);
      const providerId = pick.providerId;
      return {
        ...bot,
        summary: spec.summary,
        tier: spec.tier,
        providerId,
        model: bot.model || null,
        runsOn: pick.model,
        style: pick.style ? pick.style.style : null,
        chosen: pick.chosen,
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
    const listed = this._claudeConnectors().cached();
    return listToolSources({
      providers,
      connected: this._connectedServers(),
      workspaceId,
      connectors: listed ? listed.connectors : null,
    });
  },

  /**
   * The connectors in the user's Claude account, as their signed-in Claude
   * Code CLI reports them (Providers › New › Claude connector). Names,
   * status and tools only.
   * @param {{ refresh?: boolean }} [opts]
   */
  listClaudeConnectors(opts = {}) {
    const o = opts || {};
    const reconnect =
      typeof o.reconnect === "string" && o.reconnect
        ? o.reconnect
        : o.reconnect === true;
    return this._claudeConnectors()
      .list({
        refresh: !!o.refresh,
        // The connector's panel: what Dash checked, the others here too.
        details: true,
        ...(reconnect ? { reconnect } : {}),
      })
      .then((r) => ({ ...r, givenUp: this._givenUpList() }));
  },

  /**
   * Use this Claude Code from now on — for connectors and every bot run
   * (a connector's details: "Use the one in ~/.local/bin"). Null: the
   * first on the PATH again. Answers with the connectors read through it.
   */
  async useClaudeCli(path = null) {
    const cli = require("./cliController");
    const res = await cli.setPreferredCli(path || null);
    if (!res.ok) return { error: res.error };
    this._claudeConnectors().forget();
    return this.listClaudeConnectors({ refresh: true });
  },

  /**
   * A connector Dash has stopped trying (held to the end of the line): every
   * fix was tried and it still can't connect or sign in. Runs leave it out
   * and say so; an hour later Dash reconnects it once, quietly, and runs try
   * it again. `on` false: try it now (Try once more now).
   * @param {string} server  the connector's server ("claude.ai Gmail")
   */
  setConnectorGivenUp(server, on = true) {
    if (!this._givenUp) this._givenUp = new Map();
    const key = String(server || "");
    if (!key) return { error: "Which connector?" };
    const was = this._givenUp.get(key);
    if (was && was.timer) clearTimeout(was.timer);
    if (!on) {
      this._givenUp.delete(key);
      return this.listClaudeConnectors({ reconnect: key });
    }
    const retryAt = Date.now() + GIVEN_UP_MS;
    const timer = setTimeout(() => {
      this._givenUp.delete(key);
      // Once, quietly: connect it again so the next run finds it ready.
      this._claudeConnectors()
        .list({ reconnect: key })
        .catch(() => null);
    }, GIVEN_UP_MS);
    if (timer && timer.unref) timer.unref();
    this._givenUp.set(key, { since: Date.now(), retryAt, timer });
    return { givenUp: this._givenUpList() };
  },

  _givenUpList() {
    return [...(this._givenUp || new Map()).entries()].map(([server, g]) => ({
      server,
      since: new Date(g.since).toISOString(),
      retryAt: new Date(g.retryAt).toISOString(),
    }));
  },

  _claudeConnectors() {
    if (!this._connectorLister) {
      this._connectorLister = createConnectorLister({
        loadQuery: async () =>
          (await import("@anthropic-ai/claude-agent-sdk")).query,
        resolveCli: () => require("./cliController").resolveCliBinary() || null,
        readAuthStatus: (cliPath) => readClaudeAuthStatus(cliPath),
        // What Dash checked: the version, and every Claude Code here.
        readVersion: (cliPath) =>
          require("./cliController").readCliVersion(cliPath),
        findClis: () => require("./cliController").findCliBinaries(),
      });
    }
    return this._connectorLister;
  },

  get(botId) {
    return this._store.get(botId);
  },

  /**
   * @param {object} definition
   * @param {{addToProfile?: string, keepId?: boolean}} [opts] loading a
   *   profile file: a new bot's id goes into that profile's list (not the
   *   active one's), and it keeps the id it has in the file. Nothing is
   *   written onto the bot itself.
   */
  save(definition, opts = {}) {
    const prepared = this._prepareSave(definition);
    const { sample, isNew, whole, errors } = prepared;
    definition = prepared.definition;
    if (errors.length) {
      throw new Error(
        `${(whole && whole.name) || "The bot"} wasn't saved:\n${errors
          .map((e) => `- ${e}`)
          .join("\n")}`,
      );
    }
    // A lead or Dash team bot keeps only the user's own words (TEAM-017): a
    // copy of its built-in text — from a profile an older Dash saved — is
    // taken out here, whatever marker the copy came with.
    if (
      (isLead(whole) || isDashTeam(whole)) &&
      typeof definition.instructions === "string"
    ) {
      const dashboardName = isLead(whole)
        ? this._dashboardName(whole.workspaceId)
        : null;
      definition = {
        ...definition,
        instructions: userPartOf(
          { ...whole, promptLayers: undefined },
          { dashboardName },
        ),
        promptLayers: PROMPT_LAYERS,
      };
    }
    const saved = isNew
      ? this._store.create(definition, { keepId: !!opts.keepId })
      : this._store.update(definition.id, definition);
    if (isNew && saved && !isDashTeam(saved)) {
      if (opts.addToProfile) {
        require("../profile/profileStore").add(
          this._appId,
          "bots",
          saved.id,
          opts.addToProfile,
        );
      } else {
        profileMembership.addToActive(this._appId, "bots", saved.id);
      }
    }
    // Every new bot starts paused until the user turns it on (Phase 1d) —
    // never the Dash team or a lead (from a profile file too): a lead
    // works when the user talks to it, and a paused one left them stuck.
    if (isNew && saved && !isDashTeam(saved) && saved.role !== "lead") {
      // PauseController logs it (pause-bot).
      this._pause.pauseBot(saved.id);
    }
    if (this._inActiveProfile(saved)) this._scheduler.register(saved);
    // `opts.audit`: more about how it was made (over MCP, by whom — DASH-37).
    if (isNew && saved)
      this._logAudit({
        type: "bot-created",
        botId: saved.id,
        ...(opts.audit || {}),
      });
    if (saved && isSample(sample)) {
      try {
        this._store.setSample(saved.id, sample);
      } catch (_e) {
        // The bot is saved; a sample that can't be kept is only lost.
      }
    }
    return saved;
  },

  /**
   * Would this save? The same check save() runs, without storing anything
   * (DASH-37: a bot made over MCP is checked before the user is asked).
   * @returns {{ errors: string[], warnings: string[], isNew: boolean }}
   */
  checkSave(definition) {
    const { errors, warnings, isNew } = this._prepareSave(definition);
    return { errors, warnings, isNew };
  },

  /** What a save would store: the definition as saved, the whole bot, and its check. */
  _prepareSave(definition) {
    // What a test of the form returned (bot-test-run): kept apart from the
    // definition, so it never goes into a profile or a package.
    let sample = null;
    if (
      definition &&
      typeof definition === "object" &&
      "sample" in definition
    ) {
      const { sample: s, ...rest } = definition;
      sample = s;
      definition = rest;
    }
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
    const isNew = !(
      definition &&
      definition.id &&
      this._store.get(definition.id)
    );
    // One check for every save, before anything is written (consolidation
    // Phase 1d): the whole bot it makes — a partial save merged onto it.
    const current = isNew ? null : this._store.get(definition.id);
    const whole = isNew ? definition : { ...current, ...definition };
    const { errors, warnings } = checkBot(
      whole,
      this._botCheckContext(current),
    );
    return { definition, sample, isNew, whole, errors, warnings };
  },

  /** What checkBot checks a save against: the user's real setup. */
  _botCheckContext(existing) {
    // The user's connections: none is an empty list (still checked); only
    // when they can't be listed is the check skipped.
    let connections = null;
    try {
      const listed = this._providers.listProviders(
        this._getMainWindow(),
        this._appId,
      );
      if (listed && Array.isArray(listed.providers)) {
        connections = listed.providers.map((p) => p && p.name).filter(Boolean);
      }
    } catch (_e) {
      connections = null;
    }
    return {
      existing,
      connections,
      // The registry itself — getProvider falls back to a default.
      knownAiProvider: (id) =>
        Object.prototype.hasOwnProperty.call(AI_PROVIDERS, id),
      cronValid: (expr) => {
        try {
          new Cron(expr, { paused: true }).stop();
          return true;
        } catch (_e) {
          return false;
        }
      },
      widgetOnDashboard: (workspaceId, widgetId, component) => {
        let ws = null;
        try {
          ws = this._loadWorkspace(workspaceId);
        } catch (_e) {
          return null;
        }
        if (!ws) return false;
        return allWidgetItems(ws).some(
          (i) =>
            itemIdOf(i) === String(widgetId) &&
            (!component || i.component === component),
        );
      },
      botExists: (id) => !!this._store.get(id),
      // A running provider's tool names; null when it isn't running.
      toolsOf: (server) => {
        const live = this._connectedServers().find(
          (c) => c.serverName === server,
        );
        return live && Array.isArray(live.tools)
          ? live.tools.map((t) => t && t.name).filter(Boolean)
          : null;
      },
    };
  },

  delete(botId) {
    const bot = this._store.get(botId);
    if (isDashTeam(bot)) {
      throw new Error(
        `${bot.name} is part of the Dash team and can't be deleted — pause it instead.`,
      );
    }
    this._scheduler.unregister(botId);
    // Logged while its name can still be read.
    if (bot) this._logAudit({ type: "bot-deleted", botId });
    // A deleted bot's remembered approvals go with it.
    grantStore.revokeGrant(botId);
    // Its issues too — there's nothing left to fix (issues PRD).
    issueController.forgetAsset({ kind: "bot", botId });
    // Tasks it held go back for another bot (goals ledger).
    goalController.release(botId);
    // Deleting a lead counts as turning it off for that dashboard, so it isn't
    // silently re-created the next time the dashboard opens (TEAM-002).
    if (isLead(bot) && bot.workspaceId) {
      this._store.setTeamSettings(bot.workspaceId, { leadEnabled: false });
    }
    // Hand-ons in jobs that were waiting for it won't run (DASH-31).
    if (this._jobs) {
      this._jobs.releaseWaiting(
        botId,
        "Its bot was deleted, so it didn't run.",
      );
    }
    // Hand-ons waiting for it while it was busy (DASH-73) go too.
    if (this._busyQueue) this._busyQueue.clear(botId);
    // Its private memory (bots with no dashboard) goes with it; team and
    // global memory are shared and stay.
    this._memory.forgetBot(botId);
    // Events it was keeping while paused go too.
    this._pausedQueue.clear(botId);
    if (this._appId) {
      profileMembership.removeEverywhere(this._appId, "bots", botId);
    }
    return this._store.delete(botId);
  },

  /**
   * Run a bot. `continueConversation` resumes its last session — a reply in
   * the Bots view (TEAM-011) — logged with trigger "reply".
   */
  run(botId, prompt, { continueConversation = false, planId = null } = {}) {
    // Only the Dash team works inside a plan (and so sees its memory).
    const inPlan =
      planId && isDashTeam(this._store.get(botId)) && this._recent.get(planId);
    return this._asUserRun(botId, () =>
      this._run(
        botId,
        userRunOptions(this._store.get(botId), {
          prompt: inPlan ? `${prompt}\n\n${MEMORY_NOTE}` : prompt,
          continueConversation,
          planId: inPlan ? planId : null,
        }),
      ),
    );
  },

  /**
   * Start a run the user asked for. On a paused bot it's a test run (Phase
   * 1d): it goes ahead — tools and all — and the bot stays paused; paused
   * only stops what a bot does on its own. Not while everything is paused.
   * Counted per bot: a second run (skipped — one run at a time) can't end
   * the first one's exemption. `_userRuns` says a run the user started is
   * going, so the bots a lead asks for it go ahead too.
   */
  _asUserRun(botId, start) {
    if (!this._testRuns) this._testRuns = new Map();
    if (!this._userRuns) this._userRuns = new Map();
    const testRun =
      this._pause.isPaused(botId) && !this._pause.isGloballyPaused();
    const add = (map) => map.set(botId, (map.get(botId) || 0) + 1);
    const drop = (map) => {
      const left = (map.get(botId) || 1) - 1;
      if (left > 0) map.set(botId, left);
      else map.delete(botId);
    };
    if (testRun) add(this._testRuns);
    add(this._userRuns);
    const done = () => {
      if (testRun) drop(this._testRuns);
      drop(this._userRuns);
    };
    let started;
    try {
      started = start();
    } catch (err) {
      done();
      throw err;
    }
    return Promise.resolve(started).then(
      (record) => {
        done();
        return record;
      },
      (err) => {
        done();
        throw err;
      },
    );
  },

  /**
   * A run that finishes a bot's checks job already started (its retry, a
   * reviewer's verdict — DASH-12): a bot paused on its own still does it,
   * as a test run does; Pause all still stops it. Unlike _asUserRun it
   * isn't a run the user started, so the bots it asks stay paused.
   */
  _asJobRun(botId, start) {
    if (!this._testRuns) this._testRuns = new Map();
    const testRun =
      this._pause.isPaused(botId) && !this._pause.isGloballyPaused();
    if (!testRun) return start();
    this._testRuns.set(botId, (this._testRuns.get(botId) || 0) + 1);
    const done = () => {
      const left = (this._testRuns.get(botId) || 1) - 1;
      if (left > 0) this._testRuns.set(botId, left);
      else this._testRuns.delete(botId);
    };
    let started;
    try {
      started = start();
    } catch (err) {
      done();
      throw err;
    }
    return Promise.resolve(started).then(
      (record) => {
        done();
        return record;
      },
      (err) => {
        done();
        throw err;
      },
    );
  },

  /** A run the user started is going on this bot (see _asUserRun). */
  _inUserRun(botId) {
    return !!this._userRuns && this._userRuns.has(botId);
  },

  /**
   * Test a bot from its form (bot-test-run PRD): run the definition as it
   * stands — unsaved changes, or a bot never saved — once, as `testId`
   * (the form picks it, to follow the run's events). Its tools run as in
   * a real run and ask as it would; nothing is handed on: no events, its
   * results are kept here instead of sent, no checks job, no run record.
   * What it returned comes back with its shape; a completed test is the
   * bot's sample, kept now for a saved bot (a new one keeps it on Create,
   * and a saved one with unsaved changes, `keep` false, on Save).
   * @returns {Promise<object>} { status, error, answer, results, shape,
   *   resultsShape, sample?, sampleKept? } | { error }
   */
  async test(definition, { testId, prompt = "", keep = true } = {}) {
    if (!definition || typeof definition !== "object") {
      return { error: "There's nothing to test." };
    }
    if (typeof testId !== "string" || !TEST_ID_RE.test(testId)) {
      return { error: "That test can't start: it has no id." };
    }
    if (this._testing(testId) || this._runner.isRunning(testId)) {
      return { error: "This test is already running." };
    }
    const saved = definition.id ? this._store.get(definition.id) : null;
    const { sample: _s, ...form } = definition;
    const whole = withDefaults(saved ? { ...saved, ...form } : form);
    if (isLead(whole) || isDashTeam(whole)) {
      return {
        error: `${whole.name || "This bot"} isn't tested here: ask it in its conversation.`,
      };
    }
    const { valid, errors } = validateBotDefinition(whole);
    if (!valid)
      return { error: `It can't be tested yet: ${errors.join("; ")}.` };
    const bot = {
      ...whole,
      id: testId,
      ref: saved ? saved.ref : botRef(whole),
      session: null,
      chatSession: null,
    };
    // Its own folder when it's saved (its files, as a run sees them); a
    // bot never saved works in a folder made for the test, then removed.
    const scratch = saved
      ? null
      : fs.mkdtempSync(path.join(os.tmpdir(), "dash-bot-test-"));
    const workingDir = saved ? this._store.workingDir(saved.id) : scratch;
    const entry = { bot, results: [], chargeTo: saved ? saved.id : null };
    if (!this._testBots) this._testBots = new Map();
    this._testBots.set(testId, entry);
    const asked =
      String(prompt || "").trim() ||
      (whole.schedules && whole.schedules[0] && whole.schedules[0].prompt) ||
      "";
    let record;
    try {
      const run = this._runner.run(testId, {
        bot,
        test: true,
        trigger: "test",
        prompt: asked,
        chargeTo: entry.chargeTo,
        workingDir,
        emit: (event) => this._broadcast(BOT_STREAM, { botId: testId, event }),
      });
      this._broadcastRunActive();
      record = await run;
    } catch (err) {
      record = { status: "failed", error: (err && err.message) || String(err) };
    } finally {
      this._testBots.delete(testId);
      this._allowedByBot.delete(testId);
      // Its private memory was the test's alone.
      this._memory.forgetBot(testId);
      if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
      this._broadcastRunActive();
    }
    if (record.skipped) {
      return {
        testId,
        status: "skipped",
        error: `It didn't run: ${record.reason}.`,
      };
    }
    let warnings = [];
    try {
      warnings = record.warnings ? JSON.parse(record.warnings) : [];
    } catch (_e) {
      warnings = [];
    }
    const answer = record.answer || "";
    const out = {
      testId,
      status: record.status,
      error: record.error || null,
      startedAt: record.startedAt || null,
      endedAt: record.endedAt || null,
      provider: record.provider || null,
      model: record.model || null,
      cost: record.cost || null,
      toolCalls: record.toolCalls || [],
      approvals: record.approvals || [],
      warnings,
      prompt: asked,
      answer,
      answerCut: !!record.answerCut,
      results: entry.results,
      shape: record.answerShape || answerShape(answer),
      resultsShape: resultsShape(entry.results),
    };
    if (record.status === "completed") {
      out.sample = {
        at: out.endedAt,
        prompt: asked,
        answer,
        answerCut: out.answerCut,
        results: out.results,
        shape: out.shape,
        resultsShape: out.resultsShape,
      };
      // A saved bot's form with unsaved changes: its sample goes with Save
      // (`keep` false), so a discarded edit doesn't replace it.
      if (saved && keep !== false) {
        try {
          this._store.setSample(saved.id, out.sample);
          out.sampleKept = true;
        } catch (_e) {
          out.sampleKept = false;
        }
      }
    }
    return out;
  },

  /** The test running as `botId` (see test), or null. */
  _testing(botId) {
    return (this._testBots && this._testBots.get(botId)) || null;
  },

  /**
   * Why a test can't start or go on, or null: only Pause all, or a budget
   * used up (the saved bot's, its dashboard's or the global one). A bot
   * paused on its own is still tested.
   */
  _testBlocked(testing) {
    if (this._pause.isGloballyPaused()) return "all bots are paused";
    // A bot never saved: its dashboard's and the global limits.
    return this._budgets.isOverBudget(
      testing.chargeTo || null,
      testing.bot.workspaceId,
    )
      ? testing.chargeTo
        ? "this bot is over its budget"
        : "the budget is used up"
      : null;
  },

  /**
   * A test's send_result: checked as a real one is, then kept for the form
   * (the latest per name, as a real one replaces the last) — never saved
   * or sent.
   */
  _keepTestResult(testing, args) {
    const check = checkResult(testing.bot, args);
    if (!check.ok) return { text: check.message, isError: true };
    const { name, label, items, summary } = check.result;
    testing.results = [
      ...testing.results.filter((r) => r.name !== name),
      { name, label, items, summary: summary || null },
    ];
    const n = items.length;
    return {
      text: `Kept "${label}" (${n} item${n === 1 ? "" : "s"}): this is a test, so nothing was sent.`,
      isError: false,
    };
  },

  // ── Create's Recent (create-entry CRE-007 AC2, phase 4e-1) ──────────────

  /** Recent conversations, newest first (summaries). */
  listCreateRecent() {
    return this._recent.list();
  },

  /** One conversation, whole — to reopen it. */
  getCreateRecent(id) {
    return this._recent.get(id);
  },

  /**
   * Save a conversation as it goes ({ id?, prompt?, conversation? }); a new
   * one gets its id. Its facts go to the plan's memory (no AI).
   */
  saveCreateRecent(req = {}) {
    // Deleted: a late save (a window switching away from it) doesn't bring
    // it back.
    if (
      req &&
      req.id &&
      this._removedRecent &&
      this._removedRecent.has(req.id)
    ) {
      return { error: "It was deleted." };
    }
    // A plan from the Create window carried on as a conversation (release
    // 6c): its build moves with it; not while it's still building.
    if (req && req.carryFrom) {
      const old = this._recent.get(req.carryFrom);
      if (!old || old.kind !== "plan") {
        return { error: "That plan isn't in Recent any more." };
      }
      const buildId = old.build && old.build.buildId;
      const live = buildId && this._builds && this._builds.get(buildId);
      if (live && isBuildBusy(live.state)) {
        return { error: "It's still building — stop it first." };
      }
      const { carryFrom, ...rest } = req;
      const carried = this._recent.carryOver(carryFrom, rest);
      if (!carried) return { error: "That plan isn't in Recent any more." };
      // A build restored here (none can be running: the Create window is
      // gone) now belongs to the new conversation.
      if (live) live.recentId = carried.id;
      // What the team noted while planning and building it moves too.
      for (const { key, value } of this._memory.list("plan", carryFrom)) {
        try {
          this._memory.set("plan", carried.id, key, value);
        } catch (_e) {
          // a value that can't be kept is left behind
        }
      }
      this._memory.forget("plan", carryFrom);
      this._writePlanMemory(carried.id, conversationFacts(carried));
      return { id: carried.id, title: carried.title };
    }
    const entry = this._recent.save(req || {});
    // A bot form (TST-003) is no conversation: it has no plan memory.
    if (entry.kind !== "botform") {
      this._writePlanMemory(entry.id, conversationFacts(entry));
    }
    return { id: entry.id, title: entry.title };
  },

  /**
   * Remove a conversation from Recent, and its plan memory with it — and,
   * when asked (`deleteGoals`), the goals it started (goals ledger).
   */
  removeCreateRecent(id, opts = {}) {
    const entry = this._recent.get(id);
    if (!entry) return { error: "It isn't in Recent." };
    const buildId = entry.build && entry.build.buildId;
    const live = buildId && this._builds && this._builds.get(buildId);
    if (live && isBuildBusy(live.state)) {
      return { error: "It's still building — stop it first." };
    }
    // A lead still answering in it would save it back when it finishes.
    if (this._answeringIn(id)) {
      return { error: "It's still answering — stop it first." };
    }
    // Its goals first: one a bot is still working on keeps the
    // conversation too, so nothing is half deleted.
    if (opts && opts.deleteGoals) {
      const ids = goalController.forConversation(id).map((g) => g.id);
      if (ids.length) {
        const busy = ids.filter((g) => goalController.store().isBusy(g));
        if (busy.length) {
          return {
            error:
              "A bot is still working on one of its goals — stop it first.",
          };
        }
        goalController.delete(ids);
      }
    }
    if (live) this._builds.delete(buildId);
    this._recent.remove(id);
    this._memory.forget("plan", id);
    if (!this._removedRecent) this._removedRecent = new Set();
    this._removedRecent.add(id);
    return { ok: true };
  },

  /** Is a bot's run, asked from this conversation, still going? */
  _answeringIn(conversationId) {
    if (!conversationId || !this._runVia) return false;
    const active = new Set(this._runner.listActive());
    for (const [botId, via] of this._runVia) {
      if (via && via.conversationId === conversationId && active.has(botId)) {
        return true;
      }
    }
    return false;
  },

  _writePlanMemory(planId, facts) {
    if (!planId) return;
    for (const [key, value] of Object.entries(facts || {})) {
      try {
        this._memory.set("plan", planId, key, value);
      } catch (err) {
        console.error("[botController] plan memory:", err);
      }
    }
  },

  /** A build's progress, kept on its conversation and in its memory. */
  _keepBuild(recentId, buildId, plan, state) {
    if (!recentId) return;
    try {
      const entry = this._recent.saveBuild(recentId, { buildId, plan, state });
      this._writePlanMemory(recentId, buildFacts(state, plan));
      // Finished with a dashboard it made: its team learns why it exists.
      // A dashboard the user had keeps what its team knows (5e-2b).
      if (
        entry &&
        state &&
        state.dashboard &&
        !state.dashboard.targeted &&
        !isBuildBusy(state)
      ) {
        const about = aboutDashboard(entry, plan, state);
        if (about)
          this._memory.set("workspace", state.dashboard.id, "about", about);
      }
    } catch (err) {
      console.error("[botController] Recent:", err);
    }
  },

  /**
   * A build from an earlier session, from Recent: its last state, with no
   * live run behind it (Continue building, Edit plan and Remove work on it).
   */
  _restoredBuild(buildId) {
    const saved = this._recent.findByBuild(buildId);
    if (!saved || !saved.build) return null;
    if (!this._builds) this._builds = new Map();
    const entry = {
      plan: saved.build.plan,
      state: saved.build.state,
      build: null,
      recentId: saved.id,
    };
    this._builds.set(buildId, entry);
    return entry;
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
   * later still shows it (TD-002) — or, for its `completed` event, its last
   * finished answer (TD-009).
   */
  getLatestResult(eventType) {
    return (
      latestResult(this._store, eventType) ||
      latestCompleted(this._store, eventType)
    );
  },

  /**
   * The latest runs across every bot, newest first, tagged with bot name and
   * dashboard — the Bot monitor's "Recent" (TEAM-011 B3).
   */
  listRecentRuns({ limit = 10 } = {}) {
    return recentRuns({
      bots: this._activeBots(),
      getRuns: (id) => this._store.getRuns(id),
      limit,
    });
  },

  /** Each user bot's latest run — the Bots dock's contacts (TEAM-015). */
  lastRuns() {
    return lastRuns({
      bots: this.list(),
      getRuns: (id) => this._store.getRuns(id),
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
      // A lead renames from the saved name only — never one being typed.
      savedDashboardName: this._dashboardName(workspaceId),
      teamSettings: this._store.getTeamSettings(workspaceId),
      settings: this._store.getSettings(),
      providers,
      force,
    });
    if (plan.action !== "create") {
      // A lead from a profile or an older Dash may still hold a copy of its
      // built-in instructions.
      if (plan.lead) this.layerInstructionsOnce();
      // Its dashboard was renamed: a lead with Dash's own name follows it.
      if (plan.lead && plan.rename) {
        try {
          plan.lead = this._store.update(plan.lead.id, plan.rename);
        } catch (_e) {
          // Tried again the next time the dashboard opens or is saved.
        }
      }
      // Opening a dashboard in a profile brings its lead along.
      if (plan.lead && this._appId) {
        profileMembership.addToActive(this._appId, "bots", plan.lead.id);
      }
      return { lead: plan.lead || null, created: false, reason: plan.reason };
    }
    const lead = this._store.create(plan.definition);
    if (this._appId)
      profileMembership.addToActive(this._appId, "bots", lead.id);
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

  /**
   * A team's settings (DASH-57): what it declares, its values, and which
   * bots use each ({ [name]: [botName] }).
   */
  teamValues(workspaceId) {
    const t = this._store.getTeamSettings(workspaceId) || {};
    const declared = Array.isArray(t.declared) ? t.declared : [];
    const usedBy = {};
    for (const bot of this._store.list()) {
      if (!isOnTeam(bot, workspaceId)) continue;
      for (const name of namesUsed(bot)) {
        if (!declared.some((d) => d.name === name)) continue;
        (usedBy[name] = usedBy[name] || []).push(bot.name || bot.id);
      }
    }
    return {
      declared,
      values: (t.values && typeof t.values === "object" && t.values) || {},
      usedBy,
    };
  },

  /**
   * Change a team's settings: `{ declare, values, remove }`
   * (teamValues.mergeTeamValues). Saves nothing when there are errors.
   * @returns {{ declared, values, usedBy } | { errors: string[] }}
   */
  setTeamValues(workspaceId, change = {}, opts = {}) {
    if (workspaceId === null || workspaceId === undefined) {
      return { errors: ["Team settings belong to a dashboard's team."] };
    }
    const merged = mergeTeamValues(
      this._store.getTeamSettings(workspaceId),
      change || {},
    );
    if (merged.errors.length) return { errors: merged.errors };
    if (opts.dryRun) {
      return { declared: merged.declared, values: merged.values };
    }
    this._store.setTeamSettings(workspaceId, {
      declared: merged.declared,
      values: merged.values,
    });
    return this.teamValues(workspaceId);
  },

  /** A job remembers the table rows an answer picked (DASH-84). */
  _rememberPicks(jobId, workspaceId, output) {
    if (!jobId || workspaceId == null || !this._jobs.setPicks) return;
    try {
      const picks = pickFrom(
        String(output),
        this._store.getTeamSettings(workspaceId),
      );
      if (Object.keys(picks).length) this._jobs.setPicks(jobId, picks);
    } catch (_e) {
      // A pick that can't be read is no pick; the next run says so.
    }
  },

  /**
   * A job remembers what an answer says it's about and where its files are
   * (DASH-100): "item" (once; its id never changes after) and "workspace"
   * (only a folder inside the bot's own folders).
   */
  _rememberContext(jobId, botId, output) {
    if (!jobId || !this._jobs || !this._jobs.setItem) return;
    try {
      const named = contextFrom(String(output), {
        home: require("os").homedir(),
      });
      if (named.item) {
        const r = this._jobs.setItem(jobId, named.item);
        if (r && r.refused) {
          console.warn(
            `[jobs] ${jobId} is about ${r.item && r.item.id}; an answer named ${r.refused}, which was ignored.`,
          );
        }
      }
      if (named.workspace) {
        const bot = this.resolvedBot(botId, { jobId });
        const folders = (bot && bot.projects) || [];
        if (insideFolders(named.workspace.dir, folders)) {
          this._jobs.setWorkspace(jobId, named.workspace);
        } else {
          console.warn(
            `[jobs] ${jobId}: workspace ${named.workspace.dir} is outside the bot's folders, so it was ignored.`,
          );
        }
      }
    } catch (_e) {
      // What can't be read isn't remembered; the next run says what's missing.
    }
  },

  /**
   * A run's work item and workspace (DASH-100): its job's, then what its
   * answer (ctx.output) names — the job's item id always wins.
   */
  _runContext(jobId, output = null) {
    const fromJob =
      jobId && this._jobs && this._jobs.contextOf
        ? this._jobs.contextOf(jobId)
        : { item: null, workspace: null };
    if (typeof output !== "string" || !output) return fromJob;
    const named = contextFrom(output, { home: require("os").homedir() });
    return {
      item: mergeItem(fromJob.item, named.item).item,
      workspace: fromJob.workspace || named.workspace || null,
    };
  },

  /** A bot's completed/failed event says its job and work item (DASH-100). */
  _withJobContext(msg) {
    try {
      if (!msg || !msg.jobId || !msg.content || !this._jobs) return msg;
      return withEventContext(
        msg,
        this._runContext(
          msg.jobId,
          typeof msg.content.output === "string" ? msg.content.output : null,
        ),
      );
    } catch (_e) {
      // The event still goes out, without them.
      return msg;
    }
  },

  /**
   * The table rows a run starts with (DASH-92): its job's, then the ones
   * its input picks. Its `failed` event carries them, so whatever reports
   * the failure knows the repo too.
   */
  _runPicks(botId, jobId, prompt) {
    try {
      const bot = this._store.get(botId);
      const team =
        bot && bot.workspaceId != null
          ? this._store.getTeamSettings(bot.workspaceId)
          : null;
      return {
        ...(jobId && this._jobs && this._jobs.picksOf
          ? this._jobs.picksOf(jobId)
          : {}),
        ...(team
          ? pickFrom(typeof prompt === "string" ? prompt : "", team)
          : {}),
      };
    } catch (_e) {
      return {};
    }
  },

  /**
   * A bot as it runs: its team's settings filled in (DASH-57). `ctx`
   * (DASH-84): the rows of its team's tables are the ones its answer
   * (ctx.output) picks, else its input (ctx.prompt), else its job.
   */
  resolvedBot(id, ctx = null) {
    const bot = this._store.get(id);
    if (!bot || bot.workspaceId == null) return bot || null;
    const team = this._store.getTeamSettings(bot.workspaceId);
    const c = ctx || {};
    const picks = {
      ...(c.jobId && this._jobs && this._jobs.picksOf
        ? this._jobs.picksOf(c.jobId)
        : {}),
      ...pickFrom(typeof c.prompt === "string" ? c.prompt : "", team),
      ...pickFrom(typeof c.output === "string" ? c.output : "", team),
    };
    return withTeamValues(bot, team, {
      home: require("os").homedir(),
      picks,
      // The job's work item and workspace (DASH-100).
      context: this._runContext(
        c.jobId,
        typeof c.output === "string" ? c.output : null,
      ),
    }).bot;
  },

  // ---- Tasks via MCP (TEAM-016) ------------------------------------------

  /** Does this dashboard's team take tasks via MCP? Off unless turned on. */
  takesMcpTasks(workspaceId) {
    return this._store.getTeamSettings(workspaceId).takesMcpTasks === true;
  },

  setTakesMcpTasks(workspaceId, on) {
    const saved = this._store.setTeamSettings(workspaceId, {
      takesMcpTasks: !!on,
    });
    this._notifyTasksChanged();
    return saved;
  },

  /**
   * Does this team run one job at a time (DASH-81)? On unless turned off: a
   * job made while one is going waits its turn (a schedule's run is
   * skipped instead).
   */
  /**
   * Do this team's bots use the standard handoff (DASH-101)? Off unless
   * turned on: each bot's answer has its handoff checked (Dash's Handoff
   * check, first), Dash handles none / ask / split, and the next bot gets
   * the job's context and the handoff instead of the raw event.
   */
  usesHandoffs(workspaceId) {
    if (workspaceId === null || workspaceId === undefined) return false;
    const t = this._store.getTeamSettings(workspaceId);
    return !!(t && t.usesHandoffs === true);
  },

  /** The check packages here: Dash's, installed ones, the built-in kinds. */
  listCheckPackages() {
    return this._checkPackages
      ? this._checkPackages.list()
      : { packages: [], builtIns: [] };
  },

  /** One check package (its manifest and files), or null. */
  getCheckPackage(ref) {
    return this._checkPackages ? this._checkPackages.get(ref) : null;
  },

  /**
   * Install a check package from the registry (DASH-106): downloaded,
   * its signature verified, its files checked, then kept here.
   * @returns {Promise<{ ok, id, manifest } | { error }>}
   */
  async installCheckPackage(ref, opts = {}) {
    const { downloadCheckPackage } = require("./botRegistryInstall");
    const got = await downloadCheckPackage(ref, {
      version: opts.version || null,
    });
    if (got.error) return got;
    if (!got.pkg.scope) return { error: `"${ref}" has no scope` };
    return this._checkPackages.install({
      scope: got.pkg.scope,
      name: got.pkg.name,
      files: got.files,
      from: "registry",
      version: got.pkg.version,
    });
  },

  /** Check packages in the registry (DASH-106), by words. */
  async searchCheckPackages({ query = "" } = {}) {
    const registryController = require("./registryController");
    const index = await registryController.fetchRegistryIndex();
    const q = String(query || "")
      .trim()
      .toLowerCase();
    return ((index && index.packages) || [])
      .filter((p) => p && p.type === "check")
      .filter(
        (p) =>
          !q ||
          [
            p.name,
            p.displayName,
            p.description,
            p.author,
            p.scope,
            ...(p.tags || []),
          ]
            .filter(Boolean)
            .join("\n")
            .toLowerCase()
            .includes(q),
      )
      .map((p) => ({
        ref: p.scope ? `@${p.scope}/${p.name}` : p.name,
        name: p.name,
        displayName: p.displayName || p.name,
        author: p.author || p.scope || "",
        description: p.description || "",
        version: p.version || p.latestVersion || null,
        check: p.check || null,
        installed: !!(p.scope && this.getCheckPackage(`@${p.scope}/${p.name}`)),
      }));
  },

  removeCheckPackage(ref) {
    return this._checkPackages
      ? this._checkPackages.remove(ref)
      : { error: "No packages here" };
  },

  /** A provider of this type the bot has (else any here), for a tool package. */
  serverForType(botId, type) {
    const bot = this._store.get(botId);
    if (!bot || !type) return null;
    const sources = this.listToolSources(bot.workspaceId) || [];
    const ofType = sources.filter(
      (s) =>
        s &&
        s.type &&
        String(s.type).toLowerCase() === String(type).toLowerCase(),
    );
    const mine = ofType.find((s) => (bot.mcpServers || []).includes(s.name));
    return (mine || ofType[0] || {}).name || null;
  },

  setUsesHandoffs(workspaceId, on) {
    if (workspaceId === null || workspaceId === undefined) {
      return { error: "Which team?" };
    }
    return this._store.setTeamSettings(workspaceId, { usesHandoffs: !!on });
  },

  oneJobAtATime(workspaceId) {
    if (workspaceId === null || workspaceId === undefined) return false;
    return this._store.getTeamSettings(workspaceId).oneJobAtATime !== false;
  },

  setOneJobAtATime(workspaceId, on) {
    const saved = this._store.setTeamSettings(workspaceId, {
      oneJobAtATime: !!on,
    });
    // Turned off: what's waiting starts now.
    if (!on && this._jobs) {
      for (const job of this._jobs.queuedFor(workspaceId)) {
        this._jobs.releaseQueued(job.id);
      }
    }
    return saved;
  },

  /** Does this team have a job going, or waiting, so a new one must wait? */
  _teamBusy(workspaceId) {
    if (!this._jobs || !this.oneJobAtATime(workspaceId)) return false;
    return (
      !!this._jobs.activeFor(workspaceId) ||
      this._jobs.queuedFor(workspaceId).length > 0
    );
  },

  /** Is the team's queue full (20 waiting)? */
  teamQueueFull(workspaceId) {
    return (
      !!this._jobs &&
      this.oneJobAtATime(workspaceId) &&
      this._jobs.queueFull(workspaceId)
    );
  },

  /** Where a queued job is: { position, waitingFor } or null (DASH-81). */
  jobQueue(jobId) {
    return this._jobs ? this._jobs.queueInfo(String(jobId || "")) : null;
  },

  /** Run `fn` once the jobs are loaded (now, if they are). */
  whenJobsReady(fn) {
    if (this._jobs) return this._callReady(fn);
    if (!this._jobsReady) this._jobsReady = [];
    this._jobsReady.push(fn);
    return null;
  },

  _callReady(fn) {
    setTimeout(() => {
      try {
        fn();
      } catch (_e) {
        // One that fails never stops the rest.
      }
    }, 0);
  },

  /** Resolves true when a queued job's turn comes, false if it won't. */
  waitForJobStart(jobId) {
    return this._jobs
      ? this._jobs.waitForStart(String(jobId || ""))
      : Promise.resolve(true);
  },

  /** Does this team ask for the task passphrase first? Off unless turned on. */
  asksTaskPassphrase(workspaceId) {
    return this._store.getTeamSettings(workspaceId).asksTaskPassphrase === true;
  },

  setAsksTaskPassphrase(workspaceId, on) {
    const saved = this._store.setTeamSettings(workspaceId, {
      asksTaskPassphrase: !!on,
    });
    this._notifyTasksChanged();
    return saved;
  },

  /**
   * The dashboards whose teams take tasks via MCP, and whether each asks
   * for the passphrase first: [{ id, asksPassphrase }].
   */
  listMcpTaskTeams() {
    const all = this._store.listTeamSettings();
    return Object.keys(all)
      .filter((id) => all[id].takesMcpTasks === true)
      .map((id) => ({
        id,
        asksPassphrase: all[id].asksTaskPassphrase === true,
      }));
  },

  /** The task store (mcpTasks.js), for the MCP tools. */
  mcpTasks() {
    return this._mcpTasks;
  },

  // ---- Bots made or changed via MCP (DASH-37) ----------------------------

  /** May MCP clients list, create and change this team's bots? Off unless turned on. */
  takesMcpBots(workspaceId) {
    return this._store.getTeamSettings(workspaceId).takesMcpBots === true;
  },

  setTakesMcpBots(workspaceId, on) {
    this._store.setTeamSettings(workspaceId, { takesMcpBots: !!on });
    return this.getMcpBotSettings();
  },

  /** Is the task passphrase asked for before a bot is made or changed? On unless turned off. */
  asksBotPassphrase() {
    return this._store.getSettings().mcpBotsAskPassphrase !== false;
  },

  setAsksBotPassphrase(on) {
    this._store.setSettings({ mcpBotsAskPassphrase: !!on });
    return this.getMcpBotSettings();
  },

  /** Settings › MCP Server › Tools › Bots: { asksPassphrase, teams: [ids] }. */
  getMcpBotSettings() {
    const all = this._store.listTeamSettings();
    return {
      asksPassphrase: this.asksBotPassphrase(),
      teams: Object.keys(all).filter((id) => all[id].takesMcpBots === true),
    };
  },

  /**
   * What the host does after a bot is saved outside its own save handler
   * (dash-electron: syncBackgroundMode, so the tray and background mode
   * follow a bot made over MCP).
   */
  setAfterSave(fn) {
    this._afterSaveHook = typeof fn === "function" ? fn : null;
  },

  afterSave() {
    if (!this._afterSaveHook) return;
    try {
      this._afterSaveHook();
    } catch (err) {
      console.error("[botController] after-save hook failed:", err);
    }
  },

  /** A notice for the user (OS notification); nothing waits on it. */
  sendNotice(notice) {
    this._sendNotice(notice);
  },

  /** An audit log entry from outside the controller (the MCP bot tools). */
  logAudit(entry) {
    this._logAudit(entry);
  },

  /**
   * A task with no team named: the Dash Lead picks from the teams that take
   * tasks (taskRouting.js). It comes before any passphrase, so the run has
   * no tools at all — not even ask_role — and answers from its prompt; a run
   * past ROUTE_WAIT_MS is stopped. Each pick goes in the routing log (the
   * Dash Lead's Activity: "Routed via MCP").
   * @param {string} task
   * @param {{ id, name }[]} teams
   * @param {{ from?: string|null }} [opts]  the agent's name for itself
   * @returns {Promise<{ team } | { ambiguous } | { none: true } | { error }>}
   */
  async routeMcpTask(task, teams, { from = null } = {}) {
    const route = await this._pickTeam(task, teams);
    const entry = {
      id: `route_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      task: String(task || "").slice(0, 300),
      from: cleanFrom(from),
      ...(route.team
        ? { team: { id: String(route.team.id), name: route.team.name } }
        : route.ambiguous
          ? { ambiguous: route.ambiguous.map((t) => t.name) }
          : route.none
            ? { none: true }
            : { error: route.error || "unknown error" }),
    };
    const log = [...this._store.getMcpRoutes(), entry].slice(-MAX_ROUTES);
    this._store.setMcpRoutes(log);
    this._notifyTasksChanged();
    return route;
  },

  /** The routing log, newest first. */
  listMcpRoutes({ limit = 20 } = {}) {
    return this._store.getMcpRoutes().slice().reverse().slice(0, limit);
  },

  async _pickTeam(task, teams) {
    const lead = dashTeamBot(this._store.list(), "dashlead");
    if (!lead) return { error: "The Dash team isn't set up." };
    if (this._runner.isRunning(lead.id)) {
      return { error: "The Dash Lead is busy with another request." };
    }
    const run = this._run(lead.id, {
      prompt: routePrompt(task, describeTeams(teams, this._store.list())),
      trigger: "ask",
      via: "mcp-route",
      noTools: true,
    });
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ROUTE_WAIT_MS);
    });
    let record;
    try {
      record = await Promise.race([run, late]);
    } finally {
      clearTimeout(timer);
    }
    if (record === null) {
      this.stop(lead.id);
      return { error: "The Dash Lead took too long to pick a team." };
    }
    if (!record || record.skipped) {
      return {
        error: `The Dash Lead didn't run: ${(record && record.reason) || "unknown reason"}.`,
      };
    }
    if (record.status !== "completed") {
      return { error: record.error || "The Dash Lead couldn't pick a team." };
    }
    return readRoute(record.output, teams);
  },

  /** Recent tasks via MCP, newest first — all, or one team's. */
  listMcpTasks({ teamId = null, limit = 20 } = {}) {
    return this._mcpTasks.list({ teamId, limit });
  },

  /** Settings › MCP Server: is a passphrase set, and is it short? Never the phrase. */
  getTaskPassphraseState() {
    const phrase = this._store.getTaskPassphrase();
    return {
      set: !!phrase,
      short: phrase ? !!checkPassphrase(phrase).short : false,
      setAt: this._store.getTaskPassphraseSetAt(),
      lockedUntil: this._mcpTasks.lockedUntil(),
    };
  },

  /** Its Show button. */
  revealTaskPassphrase() {
    return this._store.getTaskPassphrase();
  },

  /** Set it: { ok, short } or { ok: false, error }. */
  setTaskPassphrase(text) {
    const check = checkPassphrase(text);
    if (!check.ok) return check;
    this._store.setTaskPassphrase(String(text).trim());
    this._mcpTasks.unlock(); // tells windows (saveLock)
    return check;
  },

  removeTaskPassphrase() {
    this._store.setTaskPassphrase(null);
    this._notifyTasksChanged();
    return { ok: true };
  },

  /**
   * What a task's team couldn't do because a bot didn't run (paused, over
   * budget…) — collected while the lead does a task via MCP, then taken
   * once by the task (it's "done, but needs you").
   */
  takeTaskNotes(leadId) {
    const notes = (this._taskNotes && this._taskNotes.get(leadId)) || [];
    if (this._taskNotes) this._taskNotes.delete(leadId);
    return notes;
  },

  // ---- Jobs (DASH-28, DASH-31) --------------------------------------------

  /**
   * Jobs, newest change first — one dashboard's with workspaceId; `open`:
   * only those still going (the nav's count); `limit`: at most that many.
   * Steps come without what each bot said (getJob has it), except a step
   * waiting on the user, so a long history stays light.
   */
  listJobs({ workspaceId = null, open = false, limit = null } = {}) {
    if (!this._jobs) return [];
    let list = this._jobs.list({ workspaceId });
    if (open) {
      list = list.filter(
        (j) =>
          j.status === "running" ||
          j.status === "needs-you" ||
          j.status === "queued",
      );
    }
    if (limit > 0) list = list.slice(0, limit);
    // What was asked is left out too (getJob has it).
    return list.map(({ request, ...j }) => ({
      ...j,
      // Its place in its team's queue (DASH-81).
      ...(j.status === "queued" ? { queue: this._jobs.queueInfo(j.id) } : {}),
      steps: (j.steps || []).map(({ summary, ...st }) =>
        st.status === "needs-you" ? { ...st, summary } : st,
      ),
    }));
  },

  getJob(jobId) {
    const job = this._jobs ? this._jobs.get(String(jobId || "")) : null;
    if (!job || job.status !== "queued") return job;
    return { ...job, queue: this._jobs.queueInfo(job.id) };
  },

  /** A task given via MCP: its job, made before the lead starts on it. */
  startTaskJob(task) {
    if (!this._jobs || !task) return null;
    const lead = this._store.get(task.leadId) || {};
    return this._jobs.startJob({
      // One job at a time (DASH-81): behind what the team is doing.
      queued: this._teamBusy(lead.workspaceId),
      workspaceId: lead.workspaceId,
      leadId: task.leadId,
      leadName: lead.name || task.teamName || "",
      title: task.task,
      request: task.task,
      // What the task is about, when it says (DASH-100).
      item: task.item || null,
      startedBy: {
        kind: "task",
        label: task.from || "MCP",
        taskId: task.id,
      },
    }).id;
  },

  /** The lead never started on the job (busy, paused…): it stops, said why. */
  abandonJob(jobId, summary) {
    const job = this.getJob(jobId);
    if (!job) return null;
    // Its lead's run already has a step (it ran, or was skipped).
    if (job.steps.some((s) => s.botId === job.leadId)) return null;
    return this._jobs.skipStep(job.id, {
      botId: job.leadId,
      botName: job.leadName,
      why: job.startedBy,
      summary,
    });
  },

  /**
   * The job a hand-on joins: its event's, while that job is still open and
   * on the bot's own dashboard — never one that has ended, or another
   * dashboard's (DASH-31).
   */
  _handOnJob(event, bot) {
    const jobId = event && event.jobId;
    if (!jobId || !this._jobs || !this._jobs.isOpen(jobId)) return null;
    const job = this._jobs.get(jobId);
    const ws = bot && bot.workspaceId != null ? String(bot.workspaceId) : null;
    return job && job.workspaceId === ws ? jobId : null;
  },

  /**
   * When the user turned on "Delete finished jobs after 90 days": those
   * that ended longer ago go. Never otherwise (DASH-31).
   */
  _clearOldJobs() {
    if (!this._jobs || !this._store.getSettings().clearOldJobs) return 0;
    const cutoff = new Date(Date.now() - OLD_JOB_DAYS * 86400000).toISOString();
    const n = this._jobs.clearEndedBefore(cutoff);
    if (n) {
      this._broadcast(BOT_JOBS_CHANGED, { jobId: null, status: "cleared" });
    }
    return n;
  },

  /** Resolves with the job once its whole chain has finished. */
  waitForJob(jobId) {
    return this._jobs ? this._jobs.waitForEnd(jobId) : Promise.resolve(null);
  },

  /** Stop every bot still running in the job. */
  stopJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) return { ok: false };
    for (const s of job.steps) {
      if (s.status === "running") this.stop(s.botId);
      // Its checks: their job closes, so no more retries.
      if (s.status === "checking" && s.goalId) {
        try {
          goalController.close(s.goalId);
        } catch (_e) {
          // The step still stops below.
        }
        this._jobs.checksMoved(s.goalId, "stopped");
      }
    }
    this._jobs.stopWaiting(job.id);
    return { ok: true };
  },

  /** Delete a job — only ever because the user asked. Not while it runs. */
  deleteJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) return { ok: false };
    const going = job.steps.some((s) =>
      ["queued", "running", "checking"].includes(s.status),
    );
    if (job.status === "running" || going) {
      return { ok: false, error: "Stop the job before deleting it." };
    }
    const ok = this._jobs.remove(job.id);
    if (ok) {
      this._broadcast(BOT_JOBS_CHANGED, {
        jobId: job.id,
        workspaceId: job.workspaceId,
        status: "deleted",
      });
    }
    return { ok };
  },

  /** "Unlock now" after 5 wrong passphrases. */
  unlockMcpTasks() {
    this._mcpTasks.unlock();
    return { ok: true };
  },

  /** Hide the lead's one-time introduction card on that dashboard. */
  dismissLeadIntro(workspaceId) {
    return this._store.setTeamSettings(workspaceId, { introDismissed: true });
  },

  /**
   * Global bot settings: { autoLeads, dashTeam: { models }, background,
   * startAtLogin, keepAwake } (background mode — US-018 AC1-AC4), and `ai`
   * (Settings › AI — aiDefaults.js).
   */
  getBotSettings() {
    const settings = this._store.getSettings();
    // Settings › AI with every value filled in (the built-in limits where
    // none is set), for the screens; patches still go to `ai`.
    return { ...settings, aiResolved: readAi(settings) };
  },

  setBotSettings(patch) {
    const {
      autoLeads,
      dashTeam,
      background,
      startAtLogin,
      keepAwake,
      ai,
      clearOldJobs,
    } = patch || {};
    const next = {};
    if (autoLeads !== undefined) next.autoLeads = !!autoLeads;
    // Delete finished jobs after 90 days — off unless the user turns it on
    // (DASH-31): jobs are their history, on their computer.
    if (clearOldJobs !== undefined) next.clearOldJobs = !!clearOldJobs;
    if (background !== undefined) next.background = !!background;
    if (startAtLogin !== undefined) next.startAtLogin = !!startAtLogin;
    if (keepAwake !== undefined) next.keepAwake = !!keepAwake;
    if (dashTeam !== undefined) {
      next.dashTeam = mergeDashTeamSettings(
        this._store.getSettings().dashTeam,
        dashTeam,
      );
    }
    // Settings › AI: backend, default model and style per job, run limits.
    if (ai !== undefined) {
      next.ai = mergeAiSettings(this._store.getSettings().ai, ai);
    }
    const saved = this._store.setSettings(next);
    if (next.clearOldJobs) this._clearOldJobs();
    // A model change shows wherever the team is listed (which model ran it).
    if ((ai !== undefined || dashTeam !== undefined) && this._notifyListChanged)
      this._notifyListChanged();
    return saved;
  },

  /**
   * Ask a team lead a question. `continueConversation` resumes the lead's
   * session (follow-ups); otherwise a new conversation starts. Logged as a
   * lead run with trigger "ask". Resolves to the run record (answer in
   * `output`).
   */
  askLead(
    botId,
    question,
    {
      continueConversation = false,
      via = null,
      conversationId = null,
      // What to show as asked (an MCP task without the app's notes), and who.
      shown = null,
      from = null,
      // A task's job, made before the lead starts (DASH-28).
      jobId = null,
    } = {},
  ) {
    const bot = this._store.get(botId);
    if (!isLead(bot)) {
      return Promise.resolve({ error: "Not a team lead.", status: "failed" });
    }
    const viaMcp = /^mcp/.test(via || "");
    // Asked from outside the app: kept as a conversation with the lead, so
    // Open conversation shows the ask, the answer and any plan to say yes
    // to (not an empty one).
    // A task (give_task), not a quick question (ask_team_lead): quick
    // questions would crowd the user's own conversations out of Recent.
    const kept =
      /^mcp-task(:|$)/.test(via || "") && !conversationId
        ? this._keepBackgroundConversation(bot, shown || question, from)
        : null;
    const start = () =>
      this._run(botId, {
        prompt: question,
        trigger: "ask",
        continueSession: !!continueConversation,
        via,
        // The lead-workspace conversation asking (release 5): the bots it
        // asks record it on their runs.
        conversationId: conversationId || (kept && kept.id) || null,
        ...(kept ? { onEvent: kept.onEvent } : {}),
        ...(jobId ? { jobId } : {}),
        // The job is named for what was asked, not the app's notes.
        ...(shown ? { jobTitle: shown } : {}),
      });
    // Asked in the app, it's the user's run: a paused lead still answers.
    // Asked over MCP ("mcp", "mcp-task…"), pause holds.
    const run = viaMcp ? start() : this._asUserRun(botId, start);
    if (!kept) return run;
    return Promise.resolve(run).then(
      (result) => {
        kept.finish(result);
        return result;
      },
      (err) => {
        kept.finish({ status: "failed", error: err && err.message });
        throw err;
      },
    );
  },

  /**
   * A lead asked from outside the app (an MCP task or question): a Recent
   * conversation with it, holding what was asked, the lead's hand-offs as
   * they happen (calls and results — the app turns them into its steps,
   * plan and all) and its answer. → { id, onEvent, finish } or null.
   */
  _keepBackgroundConversation(bot, asked, from) {
    let recipient = null;
    try {
      recipient =
        (this.listLeads() || []).find((l) => l && l.botId === bot.id) || null;
    } catch (_e) {
      recipient = null;
    }
    recipient = recipient || { botId: bot.id, leadName: bot.name };
    const background = {
      from: from || "mcp",
      status: "running",
      events: [],
      answer: "",
      error: null,
    };
    let entry;
    try {
      entry = this._recent.save({
        kind: "question",
        prompt: String(asked || ""),
        conversation: { recipient, background },
      });
    } catch (_e) {
      return null;
    }
    const id = entry.id;
    const HANDOFF = /(^|__)(team_ask_dash_team|team_ask_bot|ask_role)$/;
    const calls = new Set();
    const keep = () => {
      try {
        this._recent.save({ id, conversation: { background } });
      } catch (_e) {
        // kept in memory; the next event tries again
      }
    };
    return {
      id,
      onEvent: (event) => {
        if (!event) return;
        if (
          event.type === "tool_call" &&
          HANDOFF.test(String(event.name || ""))
        ) {
          calls.add(String(event.id));
          background.events.push({
            type: "tool_call",
            id: event.id,
            name: event.name,
            input: event.input ?? event.args ?? null,
          });
          keep();
        } else if (
          event.type === "tool_result" &&
          calls.has(String(event.id))
        ) {
          background.events.push({
            type: "tool_result",
            id: event.id,
            output: event.output,
            isError: !!event.isError,
          });
          keep();
        }
      },
      finish: (result) => {
        const r = result || {};
        // It never started (busy, paused): nothing to keep.
        if (r.skipped) {
          try {
            this._recent.remove(id);
          } catch (_e) {
            // left as it is
          }
          return;
        }
        background.status = r.skipped ? "skipped" : r.status || "completed";
        background.answer = String(r.wholeAnswer || r.output || "");
        background.error = r.error || r.reason || null;
        keep();
      },
    };
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
      // Why a task's lead wouldn't start at all (TEAM-016): checked before
      // the user is asked for their passphrase.
      allPaused: this._pause.isGloballyPaused(),
      otherProfile: !this._inActiveProfile(bot),
    };
  },

  /**
   * One copy of a widget package on the user's dashboards — its connection
   * and settings ({ providers, settings }), or null when none is placed. A
   * copy on `workspaceId` (the dashboard the change is about) comes first.
   */
  _widgetCopyInputs(pkg, workspaceId = null) {
    const name = String(pkg || "").toLowerCase();
    const m = /^@([^/]+)\/(.+)$/.exec(name);
    const prefix = m ? `${m[1]}.${m[2]}.` : null;
    const low = (v) => String(v || "").toLowerCase();
    const isCopy = (it) =>
      it &&
      it.type !== "layout" &&
      (low(it.packageId) === name ||
        low(it._sourcePackage) === name ||
        (prefix && low(it.component).startsWith(prefix)));
    let workspaces = [];
    try {
      workspaces =
        (
          require("./workspaceController").listWorkspacesForApplication(
            this._getMainWindow(),
            this._appId,
          ) || {}
        ).workspaces || [];
    } catch (_e) {
      return null;
    }
    const first =
      workspaceId != null
        ? workspaces.filter((w) => String(w.id) === String(workspaceId))
        : [];
    for (const w of [...first, ...workspaces]) {
      const it = allWidgetItems(w).find(isCopy);
      if (it)
        return {
          providers: it.selectedProviders || null,
          settings: it.userPrefs || null,
        };
    }
    return null;
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
    const bots = this._activeBots();
    const settings = this._store.getSettings();
    return summarizeLeads({
      workspaces,
      bots,
      availability: (id) => this.leadAvailability(id),
      isRunning: (id) => this._runner.listActive().includes(id),
    }).map((l) => {
      // The model the lead runs on now (which model ran it).
      const bot = bots.find((b) => b && b.id === l.botId);
      if (!bot) return l;
      try {
        const pick = this._modelPick(bot, settings);
        return {
          ...l,
          runsOn: pick.model,
          style: pick.style ? pick.style.style : null,
          chosen: pick.chosen,
        };
      } catch (_e) {
        return l; // not known now: the listing still shows
      }
    });
  },

  /**
   * A lead's find_providers (bot-capabilities CAP-003): search the user's
   * providers, Dash's catalogs and the MCP Registry. Read-only — the user
   * adds what they choose.
   */
  _findProviders({ workspaceId }, capability) {
    return findProviders(capability, {
      listInstalled: () => this.listToolSources(workspaceId),
      getCatalog: () =>
        (this._mcp.getCatalog && this._mcp.getCatalog(null).catalog) || [],
      getKnownExternal: () =>
        (this._mcp.getKnownExternalCatalog &&
          this._mcp.getKnownExternalCatalog().servers) ||
        [],
      searchRegistry: (query) => searchRegistry(query),
    });
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
      // Its widget triggers and result listeners go along (5a).
      dashboardId: workspaceId,
      workspace: this._loadWorkspace(workspaceId),
      // Its settings travel, never their values (DASH-57).
      settings: this.teamValues(workspaceId).declared,
    });
    if (!manifest.members.length) {
      return { saved: false, error: "This dashboard has no bots to export." };
    }
    const result = await saveTeamFile(this._getMainWindow(), manifest, name);
    return { ...result, notIncluded, members: manifest.members.length };
  },

  /**
   * A dashboard's team for a dashboard package (create-entry 5a, US-027):
   * the manifest (with widget triggers and result listeners by layout widget
   * id), the workspace without bot listener entries (they travel as
   * role-based listeners), and what couldn't travel. Null team when the
   * dashboard has no bots.
   */
  teamForDashboard(workspace, { name, description } = {}) {
    const workspaceId = workspace && workspace.id;
    const bots = this._store
      .list()
      .filter((b) => b.role !== "lead" && isOnTeam(b, workspaceId));
    if (!bots.length) return { team: null, workspace, notIncluded: [] };
    const { manifest, notIncluded } = buildTeamManifest({
      name: name || (workspace && workspace.name) || "Team",
      description,
      bots,
      providers: this._providerList(),
      dashboardId: workspaceId,
      workspace,
      settings: this.teamValues(workspaceId).declared,
    });
    return {
      team: manifest,
      workspace: stripBotListeners(
        workspace,
        bots.map((b) => b.id),
      ),
      notIncluded,
    };
  },

  /**
   * Install a dashboard package's team into the dashboard it just created
   * (create-entry 5a, US-027 AC4/AC7): bots paused, providers by type, and
   * the wiring re-pointed to the new bots and this dashboard. The manifest
   * is re-checked here.
   */
  installDashboardTeam(workspaceId, manifest, embedded = null, values = null) {
    const { valid, errors, manifest: clean } = validateTeamManifest(manifest);
    if (!valid) return { error: "The dashboard's team isn't valid.", errors };
    return this._installTeamPlan(
      planTeamInstall(clean, {
        workspaceId,
        providers: this._providerList(),
      }),
      null,
      // The dashboard package it came with (`{ package, version }`).
      embedded,
      // Its settings as filled in on the install form (DASH-57).
      values,
    );
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
  installTeam(
    workspaceId,
    manifest,
    choices = {},
    roles = null,
    values = null,
  ) {
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
      null,
      values,
    );
  },

  /**
   * Create a planned team's bots (paused, no grants) and wire them. With a
   * registry `source`, each bot records where it came from (TEAM-007 AC8).
   */
  /**
   * What each installed bot (and its team) is as installed — taken once it's
   * wired, so a profile save sees only later edits (registry/fingerprint).
   * A dashboard's own team (`embedded`: the dashboard package it came with)
   * remembers that package: its bots are the dashboard author's work.
   */
  _recordInstalled(plan, created, registryRef, embedded) {
    const teamDashboard =
      plan.members[0] && plan.members[0].definition.workspaceId;
    const ids = Object.values(created).map((b) => b.id);
    const fresh = () => ids.map((id) => this._store.get(id)).filter(Boolean);
    if (registryRef) {
      for (const b of fresh()) {
        this._store.update(b.id, {
          registryRef: {
            ...registryRef,
            contentHash: publishFingerprint("bot", b),
          },
        });
      }
      if (registryRef.kind === "bot-team" && teamDashboard != null) {
        this._store.setTeamSettings(teamDashboard, {
          registryRef: {
            ...registryRef,
            contentHash: publishFingerprint("bot-team", fresh()),
          },
        });
      }
    }
    if (embedded && embedded.package && teamDashboard != null) {
      const origin = {
        package: embedded.package,
        version: embedded.version || null,
      };
      for (const id of ids) this._store.update(id, { remixedFrom: origin });
      this._store.setTeamSettings(teamDashboard, {
        embeddedFrom: {
          ...origin,
          contentHash: publishFingerprint("bot-team", fresh()),
        },
      });
    }
  },

  _installTeamPlan(plan, source, embedded = null, values = null) {
    if (!plan.members.length)
      return { error: "Pick at least one bot to install." };
    // Its settings (DASH-57): checked before anything is created.
    const dashboardOf =
      plan.members[0] && plan.members[0].definition.workspaceId;
    let teamValues = null;
    if ((plan.settings || []).length && dashboardOf != null) {
      teamValues = mergeTeamValues(this._store.getTeamSettings(dashboardOf), {
        declare: plan.settings,
        values,
      });
      if (teamValues.errors.length) {
        return {
          error: `The team wasn't installed:\n${teamValues.errors.map((p) => `- ${p}`).join("\n")}`,
          errors: teamValues.errors,
        };
      }
    }
    // Every member checked before any is created (Phase 1d) — a bad one
    // can't leave half a team installed.
    const problems = [];
    for (const member of plan.members) {
      const { errors } = checkBot(
        member.definition,
        this._botCheckContext(null),
      );
      for (const e of errors) {
        problems.push(`${member.definition.name || member.role}: ${e}`);
      }
    }
    if (problems.length) {
      return {
        error: `The team wasn't installed:\n${problems.map((p) => `- ${p}`).join("\n")}`,
        errors: problems,
      };
    }
    const created = {};
    const registryRef =
      source &&
      makeRegistryRef({
        package: source.package,
        kind: source.kind === "bot-team" ? "bot-team" : "bot",
        version: source.version,
        origin: "installed",
      });
    const definitionOf = (member) =>
      source
        ? {
            ...member.definition,
            installedFrom: { ...source, role: member.role },
            ...(registryRef ? { registryRef } : {}),
          }
        : member.definition;
    for (const member of plan.members) {
      const bot = this.save(definitionOf(member));
      // Installed in setup state: nothing runs on its own until the user
      // resumes it. Not the lead — it only works when the user asks it.
      if (bot.role !== "lead") this._pause.pauseBot(bot.id);
      created[member.role] = bot;
    }
    const subs = wireTeam(plan.wiring, created);
    // The dashboard's widgets (5a): triggers become subscriptions on this
    // dashboard; listeners go into its layout. A widget that isn't there
    // isn't wired, and says so.
    const dashboardId =
      plan.members[0] && plan.members[0].definition.workspaceId;
    const unwired = [];
    let ws = dashboardId != null ? this._loadWorkspace(dashboardId) : null;
    const hasWidget = (id, component) =>
      !!ws &&
      layoutItems(ws).some(
        (i) =>
          i &&
          String(i.id) === String(id) &&
          (!component || i.component === component),
      );
    const widgetWiring = wireWidgets(plan, created, dashboardId);
    for (const [role, list] of Object.entries(widgetWiring.subscriptions)) {
      for (const sub of list) {
        if (hasWidget(sub.source.instanceId, sub.source.ref)) {
          (subs[role] = subs[role] || []).push(sub);
        } else {
          unwired.push(
            `${created[role].name}: ${sub.label} (that widget isn't on the dashboard)`,
          );
        }
      }
    }
    let layoutChanged = false;
    for (const l of widgetWiring.listeners) {
      const next = ws
        ? addWidgetListener(ws, l.widget, l.handler, l.eventType, l.component)
        : null;
      if (next) {
        ws = next;
        layoutChanged = true;
      } else {
        unwired.push(`${l.handler} (that widget isn't on the dashboard)`);
      }
    }
    // Bot results widgets show their new bot (their bot is a personal
    // setting, so it doesn't travel in the layout — 5b).
    for (const r of plan.resultWidgets || []) {
      const bot = created[r.role];
      const next =
        ws && bot
          ? setWidgetPrefs(ws, r.widget, { botId: bot.id }, BOT_WIDGETS.results)
          : null;
      if (next) {
        ws = next;
        layoutChanged = true;
      } else if (bot) {
        unwired.push(
          `${bot.name}'s results widget (it isn't on the dashboard)`,
        );
      }
    }
    if (layoutChanged) {
      const saved = this._saveWorkspace(ws);
      if (saved && saved.error) unwired.push(`listeners: ${saved.error}`);
    }
    for (const role of Object.keys(created)) {
      const patch = {};
      if (subs[role]) patch.subscriptions = subs[role];
      // Reviewer checks: the role it named is now a bot.
      const checks = created[role].checks;
      if (
        checks &&
        (checks.steps || []).some((st) => /^role:/.test(String(st.botId)))
      ) {
        patch.checks = resolveReviewers(checks, created);
      }
      if (Object.keys(patch).length) {
        created[role] = this.save({ ...created[role], ...patch });
      }
    }
    // Settings left with no value: its bots that use them can't run yet.
    const needsSettings = [];
    if (teamValues) {
      this._store.setTeamSettings(dashboardOf, {
        declared: teamValues.declared,
        values: teamValues.values,
      });
      for (const d of teamValues.declared) {
        if (d.type === "boolean") continue;
        const v = Object.prototype.hasOwnProperty.call(
          teamValues.values,
          d.name,
        )
          ? teamValues.values[d.name]
          : d.default;
        if (v === undefined || v === null || v === "") {
          needsSettings.push(d.label || d.name);
        }
      }
    }
    // Commands that came with it: off until turned on (DASH-57).
    const heldChecks = [];
    for (const m of plan.members) {
      const bot = created[m.role];
      for (const st of (bot && bot.checks && bot.checks.steps) || []) {
        if (st && st.held) heldChecks.push(`${bot.name}: ${st.name}`);
      }
    }
    this._recordInstalled(plan, created, registryRef, embedded);
    return {
      installed: plan.members.map((m) => ({
        role: m.role,
        id: created[m.role].id,
        name: created[m.role].name,
      })),
      droppedWiring: plan.droppedWiring || [],
      unwired,
      ...(needsSettings.length ? { needsSettings } : {}),
      ...(heldChecks.length ? { heldChecks } : {}),
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
  async previewRegistryInstall(workspaceId, packageRef, opts = {}) {
    // opts.version: an exact version (a profile lists them), else the latest.
    const dl = await downloadBotPackage(packageRef, {
      version: opts.version || null,
    });
    if (dl.error) return dl;
    const read = readPackageFiles(dl.files);
    if (read.error) return read;
    const source = {
      package: dl.pkg.scope ? `${dl.pkg.scope}/${dl.pkg.name}` : dl.pkg.name,
      version: dl.pkg.version,
      kind: dl.pkg.type,
    };
    if (!this._registryPreviews) this._registryPreviews = new Map();
    // Keep only the latest few previews.
    while (this._registryPreviews.size >= 5) {
      this._registryPreviews.delete(this._registryPreviews.keys().next().value);
    }
    const previewId = `rp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this._registryPreviews.set(previewId, { manifest: read.manifest, source });
    // The check packages it uses (DASH-106), and which are here already.
    const checkPackages = checkPackagesOf(
      (read.manifest.members || [])
        .map((m) => m.embedded)
        .concat(read.manifest.bot ? [read.manifest.bot] : []),
    ).map((id) => ({ id, installed: !!this.getCheckPackage(id) }));
    return {
      previewId,
      kind: read.kind,
      source: {
        ...source,
        author: dl.pkg.author,
        displayName: dl.pkg.displayName,
      },
      manifest: read.manifest,
      checkPackages,
      plan: planTeamInstall(read.manifest, {
        workspaceId,
        providers: this._providerList(),
      }),
    };
  },

  /**
   * Update bots already on this computer from the previewed package (a
   * newer version of what they were installed from or published as):
   * `botIdsByRole` names the existing bot for each of the package's roles
   * (one bot: its only role). What a bot does comes from the package; how
   * it runs here — providers, approvals, wiring, run state — stays. A role
   * with no bot here is skipped (installFromRegistry adds new ones).
   */
  updateFromRegistry(previewId, botIdsByRole = {}) {
    const preview =
      this._registryPreviews && this._registryPreviews.get(previewId);
    if (!preview) {
      return { error: "That preview has expired — find the package again." };
    }
    this._registryPreviews.delete(previewId);
    const plan = planTeamInstall(preview.manifest, {
      workspaceId: null,
      providers: this._providerList(),
    });
    const source = preview.source;
    const registryRef = makeRegistryRef({
      package: source.package,
      kind: source.kind === "bot-team" ? "bot-team" : "bot",
      version: source.version,
      origin: "installed",
    });
    const skipped = [];
    const missingProviders = [];
    const changes = [];
    const fromPackage = readRegistryRef("bot", { installedFrom: source });
    // Every bot checked before any changes: it must be a copy of this
    // package (installed from it or published as it), and its updated
    // definition must be valid — a bad one can't leave half a team updated.
    for (const member of plan.members) {
      const id = botIdsByRole[member.role];
      const existing = id ? this._store.get(id) : null;
      if (!existing) {
        skipped.push(member.role);
        continue;
      }
      const ref =
        readRegistryRef("bot", existing) ||
        readRegistryRef("bot-team", existing);
      if (!samePackage(ref, fromPackage)) {
        return {
          error: `${existing.name} isn't a copy of ${source.package}, so it wasn't updated.`,
        };
      }
      const { patch, missingProviders: missing } = botUpdatePatch(
        existing,
        member,
        {
          installedFrom: { ...source, role: member.role },
          ...(registryRef ? { registryRef } : {}),
        },
      );
      const { valid, errors } = validateBotDefinition({
        ...existing,
        ...patch,
      });
      if (!valid) {
        return {
          error: `${existing.name} wasn't updated: ${errors.join("; ")}`,
        };
      }
      changes.push({ id, patch });
      for (const type of missing) {
        missingProviders.push(`${existing.name}: ${type}`);
      }
    }
    for (const { id, patch } of changes) this._store.update(id, patch);
    // Settings the new version declares (DASH-57) join each team's, so
    // the {name}s its bots now use are there to fill in.
    if ((plan.settings || []).length) {
      const teams = new Set(
        changes
          .map((c) => this._store.get(c.id))
          .filter((b) => b && b.workspaceId != null)
          .map((b) => String(b.workspaceId)),
      );
      for (const ws of teams) {
        const merged = mergeTeamValues(this._store.getTeamSettings(ws), {
          declare: plan.settings.filter(
            (d) =>
              !((this._store.getTeamSettings(ws) || {}).declared || []).some(
                (x) => x && x.name === d.name,
              ),
          ),
        });
        if (!merged.errors.length) {
          this._store.setTeamSettings(ws, {
            declared: merged.declared,
            values: merged.values,
          });
        }
      }
    }
    return {
      updated: changes.map((c) => c.id),
      skipped,
      missingProviders,
    };
  },

  /** Install the previewed registry package — all bots, or the ones picked. */
  installFromRegistry(
    workspaceId,
    previewId,
    choices = {},
    roles = null,
    values = null,
  ) {
    const preview =
      this._registryPreviews && this._registryPreviews.get(previewId);
    if (!preview) {
      return { error: "That preview has expired — find the package again." };
    }
    this._registryPreviews.delete(previewId);
    const res = this._installTeamPlan(
      planTeamInstall(preview.manifest, {
        workspaceId,
        providers: this._providerList(),
        choices,
        roles,
      }),
      preview.source,
      null,
      values,
    );
    // The check packages its checks use (DASH-106): installed with it.
    const missing = checkPackagesOf(
      (preview.manifest.members || []).map((m) => m.embedded),
    ).filter((id) => !this.getCheckPackage(id));
    if (!missing.length || !res || res.error) return res;
    return Promise.all(
      missing.map((id) =>
        this.installCheckPackage(id).then(
          (r) => ({ id, ...(r.error ? { error: r.error } : { ok: true }) }),
          (e) => ({ id, error: (e && e.message) || String(e) }),
        ),
      ),
    ).then((checkPackages) => ({ ...res, checkPackages }));
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
        settings: this.teamValues(workspaceId).declared,
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
  /**
   * Whether a bot (or a dashboard's team) being published is a copy of
   * someone else's package and may be: every member's original is checked
   * (one that doesn't allow remixes stops the publish), and the credit is
   * the one this was published with before, if any.
   */
  _remixCheck(opts, username) {
    if (opts.kind === "team") {
      const settings = this._store.getTeamSettings(opts.workspaceId) || {};
      const credited = remixOrigin(
        "bot-team",
        { remixedFrom: settings.remixedFrom },
        username,
      );
      const origins = [credited];
      for (const bot of this._store.list()) {
        if (isOnTeam(bot, opts.workspaceId)) {
          origins.push(remixOrigin("bot-team", bot, username));
        }
      }
      return checkRemixAll(origins, undefined, credited);
    }
    const bot = this._store.get(opts.botId);
    return checkRemix(bot ? remixOrigin("bot", bot, username) : null);
  },

  /** What a bot (or a dashboard's team) is as published (registry/fingerprint). */
  _publishFingerprint(opts) {
    if (opts.kind === "team") {
      return publishFingerprint(
        "bot-team",
        this._store
          .list()
          .filter((b) => isOnTeam(b, opts.workspaceId) && !isLead(b)),
      );
    }
    return publishFingerprint("bot", this._store.get(opts.botId));
  },

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
    // A bot or team installed from someone else's package is published as a
    // remix of it, credited — unless its author doesn't allow remixes.
    const remix = await this._remixCheck(opts, identity.username);
    if (remix.error) return { success: false, error: remix.error };
    const visibility = meta.visibility === "public" ? "public" : "private";
    // `keepVisibility`: republishing an existing package sends none, so
    // the registry keeps what it has.
    const keepVisibility = !!meta.keepVisibility;
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
    if (remix.remixedFrom) manifest.remixedFrom = remix.remixedFrom;
    if (typeof meta.allowRemix === "boolean") {
      manifest.allowRemix = meta.allowRemix;
    }
    if (keepVisibility) delete manifest.visibility;
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
    const before =
      opts.kind === "team"
        ? (this._store.getTeamSettings(opts.workspaceId) || {}).published
        : (this._store.get(opts.botId) || {}).published;
    const published = {
      name: `${identity.username}/${meta.name}`,
      version: meta.version,
      visibility: keepVisibility
        ? (before && before.visibility) || null
        : visibility,
      at: new Date().toISOString(),
    };
    const registryRef = makeRegistryRef({
      package: published.name,
      kind: manifest.type,
      version: published.version,
      origin: "published",
      at: published.at,
      contentHash: this._publishFingerprint(opts),
    });
    const record = registryRef ? { published, registryRef } : { published };
    // A remix remembers its original: a later publish — even under another
    // name — is still a remix of it (and checked against it).
    if (remix.remixedFrom) {
      record.remixedFrom = {
        package: `${remix.remixedFrom.scope}/${remix.remixedFrom.name}`,
        version: remix.remixedFrom.version,
      };
    }
    if (opts.kind === "team") {
      this._store.setTeamSettings(opts.workspaceId, record);
    } else {
      this._store.update(opts.botId, record);
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

  /**
   * Publish a bot, or a dashboard's team, to the user's account without the
   * dialog (a profile's bots, dash-profiles v2): the name is picked
   * automatically — its own package if it has one, else a free one — at the
   * next version the registry doesn't have; private when new, an existing
   * package keeps its visibility.
   *
   * @param {{kind: "bot"|"team", botId?: string, workspaceId?: string}} opts
   */
  async publishHeadless(opts = {}) {
    const identity = await registryIdentity();
    if (!identity.signedIn) {
      return {
        success: false,
        authRequired: true,
        error: "Sign in to publish.",
      };
    }
    const isTeam = opts.kind === "team";
    const record = isTeam
      ? this._store.getTeamSettings(opts.workspaceId) || {}
      : this._store.get(opts.botId);
    if (!record) return { success: false, error: "That bot isn't here." };
    const ws = isTeam ? this._loadWorkspace(opts.workspaceId) : null;
    const displayName = isTeam
      ? `${(ws && (ws.name || ws.label)) || "Dashboard"} team`
      : record.name || "Bot";
    const { planPackagePublish } = require("../registry/registryPackages");
    const plan = await planPackagePublish({
      kind: isTeam ? "bot-team" : "bot",
      record,
      displayName,
      localVersion: (record.published && record.published.version) || null,
      username: identity.username,
    });
    if (plan.error) return { success: false, error: plan.error };
    const res = await this.publish({
      ...opts,
      meta: {
        name: plan.name,
        displayName: displayName.slice(0, 100),
        version: plan.version,
        description: "",
        visibility: "private",
        keepVisibility: plan.exists,
      },
    });
    return res && res.success
      ? {
          ...res,
          renamed: plan.renamed,
          visibility: plan.exists ? "unchanged" : "private",
        }
      : res;
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
    return {
      added: true,
      widgetId: placed.widgetId,
      cell: placed.cell,
      pageId: placed.pageId,
    };
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
    if (stopped) this._logAudit({ type: "run-stopped", botId });
    // A lead stopped while it waits on its bots (team_ask_bot): stop them too.
    const asked = this._leadAsked ? this._leadAsked.get(botId) : null;
    for (const id of asked ? [...asked] : []) this.stop(id);
    return { stopped };
  },

  /**
   * Dash is quitting with runs in progress and the user chose to stop them
   * (US-018 AC6): stop every run — each is saved as "interrupted" — and
   * resolve once their records are written, or after `timeoutMs`.
   * @returns {Promise<{ interrupted: number, unfinished: number }>}
   */
  interruptAll({ timeoutMs = 5000 } = {}) {
    // Which bots, read before their runs end.
    const botIds = this._runner.listActive();
    return interruptAllRuns({
      runner: this._runner,
      approvals: this._approvals,
      timeoutMs,
    }).then((result) => {
      if (result && result.interrupted) {
        this._logAudit({
          type: "runs-interrupted",
          count: result.interrupted,
          botNames: botIds.map((id) => this._botName(id)),
        });
      }
      return result;
    });
  },

  /**
   * Resolves when no bot is running ("Quit when they finish", US-018 AC6) —
   * or after `timeoutMs`, when given.
   * @returns {Promise<boolean>} true when idle, false on timeout
   */
  whenIdle({ timeoutMs = null } = {}) {
    return waitUntilIdle({ runner: this._runner, timeoutMs });
  },

  // ---- Approvals answered over MCP (DASH-32) ------------------------------

  /**
   * A bot's tool approval: queued for the user, broadcast, and logged — the
   * ask, then however it was answered (Allow, Deny, Stop, timeout). Every
   * engine's approvals (built-in tools too) come through here.
   *
   * One in a job started over MCP waits only as long as its team's "Wait
   * for approvals up to" (4 h unless changed); then the bot's run stops,
   * failed, saying which approval wasn't answered — so the job and its task
   * end failed instead of hanging. Approvals in Dash's own conversations
   * keep the 24 h auto-deny.
   */
  _createApproval(request) {
    const req = request || {};
    const job = this._jobOfBot(req.botId);
    const overMcp = remoteApprovals.startedOverMcp(job);
    const hours = overMcp ? this.approvalWaitHours(job.workspaceId) : null;
    const res = overMcp
      ? this._approvals.create(request, {
          timeoutMs: hours * remoteApprovals.HOUR_MS,
        })
      : this._approvals.create(request);
    this._broadcast(BOT_APPROVAL_PENDING, { id: res.id, request });
    const about = {
      botId: req.botId,
      tool: req.toolName || null,
      provider: req.serverName || null,
      runStartedAt: req.runStartedAt || null,
    };
    this._logAudit({ type: "approval-asked", ...about });
    Promise.resolve(res && res.promise)
      .then((decision) => {
        const d = decision || {};
        const answer = recordAnswer(this, res.id, d);
        // Who answered: the user in Dash, or an app over MCP (its name).
        const by =
          answer.via === "mcp" || answer.via === "dash"
            ? {
                via: answer.via,
                ...(answer.answeredBy ? { answeredBy: answer.answeredBy } : {}),
              }
            : {};
        this._logAudit(
          d.allow
            ? {
                type: "approval-allowed",
                ...about,
                always: !!d.remember,
                ...by,
              }
            : {
                type: "approval-denied",
                ...about,
                reason: d.reason || null,
                ...by,
              },
        );
        if (d.timedOut && overMcp) {
          this._failRun(
            req.botId,
            remoteApprovals.timeoutMessage({
              toolName: req.toolName,
              provider: req.serverName,
              hours,
            }),
          );
        }
      })
      .catch(() => {});
    return res;
  },

  /** Stop a bot's run as failed, with `message` as its error (DASH-32). */
  _failRun(botId, message) {
    const { stopped } = stopBotRun({
      runner: this._runner,
      approvals: this._approvals,
      botId,
      reason: "fail",
      message,
    });
    if (stopped)
      this._logAudit({ type: "run-stopped", botId, reason: message });
    return { stopped };
  },

  /**
   * The job a bot's run in progress belongs to: the one it has a running
   * step in, or null (a run outside any job).
   */
  _jobOfBot(botId) {
    if (!botId || !this._jobs) return null;
    const via = this._runVia && this._runVia.get(botId);
    const job = via && via.jobId ? this._jobs.get(via.jobId) : null;
    return job && remoteApprovals.jobForBot([job], botId) ? job : null;
  },

  /** The team's "Wait for approvals up to", in hours (4 unless changed). */
  approvalWaitHours(workspaceId) {
    let saved = null;
    try {
      saved = (this._store.getTeamSettings(workspaceId) || {})
        .approvalWaitHours;
    } catch (_e) {
      saved = null;
    }
    return remoteApprovals.waitHoursOf(saved);
  },

  setApprovalWaitHours(workspaceId, hours) {
    const n = Number(hours);
    if (!remoteApprovals.WAIT_HOURS.includes(n)) {
      return { error: "Choose 1, 4, 12 or 24 hours." };
    }
    this._store.setTeamSettings(workspaceId, { approvalWaitHours: n });
    return { hours: n };
  },

  /**
   * What a job waits on (get_task_status): each pending approval of a bot
   * running in it, and each paused bot a hand-on waits for.
   */
  jobApprovals(jobId) {
    const job = this.getJob(jobId);
    if (!job) return [];
    const asks = this._approvals
      .list()
      .filter((a) => {
        const j = this._jobOfBot(a && a.request && a.request.botId);
        return j && j.id === job.id;
      })
      .map((a) =>
        remoteApprovals.approvalEntry(a, {
          job,
          botName: this._botName(a.request.botId),
        }),
      );
    return [...asks, ...remoteApprovals.pausedEntries(job)];
  },

  /**
   * May this approval be answered over MCP? { ok, approval, job } or
   * { error, message } — unknown_approval, already_answered (who and how),
   * not_remote (a built-in tool, or work started in Dash).
   */
  checkRemoteApproval(approvalId) {
    const id = String(approvalId || "");
    const pending = id ? this._approvals.get(id) : null;
    if (!pending) {
      const answer = this._answerLog ? this._answerLog.get(id) : null;
      if (answer) {
        return {
          error: "already_answered",
          message: remoteApprovals.alreadyAnsweredText(answer),
          answeredVia: answer.via,
          ...(answer.answeredBy ? { answeredBy: answer.answeredBy } : {}),
          answeredAt: answer.at,
          allowed: answer.allow,
        };
      }
      return {
        error: "unknown_approval",
        message:
          "No approval with that approvalId is waiting. get_task_status lists the ones that are.",
      };
    }
    const req = pending.request || {};
    const job = this._jobOfBot(req.botId);
    if (!remoteApprovals.isRemoteApproval(req, job)) {
      const builtin =
        !req.serverName || remoteApprovals.BUILTIN_TOOLS.has(req.toolName);
      return {
        error: "not_remote",
        message: builtin
          ? "This is a built-in tool (not a provider's), so it can only be answered in Dash."
          : "This approval isn't for a task given over MCP (it's work started in Dash, or a question asked with ask_team_lead), so it can only be answered in Dash.",
      };
    }
    return { ok: true, approval: pending, job };
  },

  /**
   * Answer an approval over MCP: exactly Allow once or Deny, as on the
   * Needs you card — never Always allow. The caller has checked the
   * user's task passphrase. Whichever answer comes first wins; a later
   * one is told who answered.
   */
  answerApproval(approvalId, { allow = false, answeredBy = null } = {}) {
    const check = this.checkRemoteApproval(approvalId);
    if (check.error) return check;
    const id = check.approval.id;
    // Only here is an answer "mcp": approve() (Dash's IPC) is always "dash".
    const meta = {
      via: "mcp",
      ...(answeredBy ? { answeredBy: String(answeredBy).slice(0, 100) } : {}),
    };
    // Allow once only: never a saved grant.
    const ok = allow
      ? this._approvals.resolve(id, { allow: true, remember: false, ...meta })
      : this._approvals.deny(id, undefined, meta);
    if (ok) recordAnswer(this, id, { ...meta, allow: !!allow });
    if (!ok) return this.checkRemoteApproval(approvalId);
    return {
      ok: true,
      allowed: !!allow,
      approval: remoteApprovals.approvalEntry(check.approval, {
        job: check.job,
        botName: this._botName(check.approval.request.botId),
      }),
    };
  },

  /**
   * Resolve a pending approval. `decision.remember` ("Always allow") also
   * saves a durable grant, so later runs go ahead without asking: for a
   * provider tool, this bot + provider + tool (+ the folder of a path
   * argument); for a built-in web fetch, this bot + the site
   * (`decision.scope` "site", the default) or only the page ("page"). Other
   * built-in tools always ask.
   *
   * `decision.undo` takes back the Always allow of an approval answered just
   * before: the grant goes back to what it was (or, if it changed since,
   * only what that answer added is removed). The call it allowed has run.
   */
  approve(approvalId, decision = {}) {
    if (decision.undo) return { ok: this._undoAlwaysAllow(approvalId) };
    // Answered in Dash (DASH-32): always "dash", whatever the renderer
    // sends — only answerApproval answers over MCP. Kept so a later answer
    // can say who got there first, and in the log.
    const { via: _via, answeredBy: _by, ...given } = decision;
    decision = given;
    const via = "dash";
    if (!decision.allow) {
      const ok = this._approvals.deny(approvalId, decision.reason, { via });
      if (ok) recordAnswer(this, approvalId, { via, allow: false });
      return { ok };
    }
    let remembered = false;
    const asked = this._approvals.get(approvalId);
    // A test's Always allow isn't kept: the bot it tests may never be saved.
    const fromTest = !!(
      this._testBots &&
      asked &&
      asked.request &&
      this._testBots.has(asked.request.botId)
    );
    if (decision.remember && !fromTest) {
      const pending = asked;
      const req = pending && pending.request;
      const before = req && req.botId ? grantStore.getGrant(req.botId) : null;
      let next = null;
      if (req && req.botId && req.serverName && req.toolName) {
        next = rememberToolGrant(
          before,
          {
            serverName: req.serverName,
            toolName: req.toolName,
            args: req.input,
            // "Anywhere in the provider's files" instead of this folder
            // (DASH-30).
            ...(decision.scope === "provider" ? { scope: "provider" } : {}),
          },
          { isWriteTool, pathArgKeys: PATH_ARG_KEYS, dirname: path.dirname },
        );
      } else if (req && req.botId && req.toolName) {
        next = rememberBuiltinGrant(before, {
          toolName: req.toolName,
          input: req.input,
          scope: decision.scope,
        });
      }
      if (next) {
        remembered = grantStore.setGrant(req.botId, next) === true;
      }
      if (remembered) {
        const after = grantStore.getGrant(req.botId);
        // Folders this answer added to the provider (Undo takes them back).
        const paths = (g) => {
          const sv = (g && g.servers && g.servers[req.serverName]) || {};
          return [...(sv.readPaths || []), ...(sv.writePaths || [])];
        };
        const had = req.serverName ? paths(before) : [];
        this._rememberUndo(approvalId, {
          req,
          scope: decision.scope,
          before,
          after,
          addedFolders: req.serverName
            ? paths(after).filter((p) => !had.includes(p))
            : [],
        });
        this._logAudit({
          type: "grant-saved",
          botId: req.botId,
          tool: req.toolName,
          provider: req.serverName || null,
        });
      }
    }
    // The run's record says "always allowed" only when it was saved.
    const ok = this._approvals.resolve(approvalId, {
      ...decision,
      remember: remembered,
      via,
    });
    if (ok) recordAnswer(this, approvalId, { allow: true, via });
    return { ok, remembered };
  },

  _rememberUndo(approvalId, entry) {
    if (!this._alwaysUndo) this._alwaysUndo = new Map();
    this._alwaysUndo.set(approvalId, entry);
    while (this._alwaysUndo.size > UNDO_KEPT) {
      this._alwaysUndo.delete(this._alwaysUndo.keys().next().value);
    }
  },

  _undoAlwaysAllow(approvalId) {
    const entry = this._alwaysUndo && this._alwaysUndo.get(approvalId);
    if (!entry) return false;
    const { req, scope, before, after, addedFolders = [] } = entry;
    const current = grantStore.getGrant(req.botId);
    let ok;
    if (JSON.stringify(current) === JSON.stringify(after)) {
      // Nothing else changed since: back to exactly what it was.
      ok = before
        ? grantStore.setGrant(req.botId, before) === true
        : grantStore.revokeGrant(req.botId) === true;
    } else if (req.serverName) {
      // Only what this answer added: the tool (unless the bot already had
      // it) and any folder it added.
      const had =
        (before && before.servers && before.servers[req.serverName]) || {};
      let next = forgetFolders(current, req.serverName, addedFolders);
      if (!(had.tools || []).includes(req.toolName)) {
        next = forgetToolGrant(next, req.serverName, req.toolName);
      }
      ok = next === current || grantStore.setGrant(req.botId, next) === true;
    } else {
      const target = webFetchTarget(req.input);
      const was = alwaysAllowedRows(before);
      const added =
        scope === "page"
          ? { tool: req.toolName, page: target && target.url }
          : { tool: req.toolName, site: target && target.site };
      const kept = was.some(
        (r) =>
          r.tool === added.tool &&
          r.site === added.site &&
          r.page === added.page,
      );
      ok =
        !target ||
        kept ||
        grantStore.setGrant(
          req.botId,
          forgetBuiltinGrant(current, req.toolName, added),
        ) === true;
    }
    if (ok) {
      // Only once it worked, so a failed Undo can be tried again.
      this._alwaysUndo.delete(approvalId);
      this._logAudit({
        type: "grant-revoked",
        botId: req.botId,
        tool: req.toolName,
        provider: req.serverName || null,
      });
    }
    return ok;
  },

  /**
   * Everything a bot may do without asking, one row each:
   * { kind: "tool", provider, tool } or { kind: "builtin", tool, site|page }.
   */
  listAlwaysAllowed(botId) {
    return alwaysAllowedRows(grantStore.getGrant(botId));
  },

  /** "Ask again" for one row of listAlwaysAllowed; returns the new list. */
  forgetAlwaysAllowed(botId, row = {}) {
    const current = grantStore.getGrant(botId);
    if (current && row.tool) {
      const next =
        row.kind === "builtin"
          ? forgetBuiltinGrant(current, row.tool, row)
          : forgetToolGrant(current, row.provider, row.tool);
      if (next !== current && grantStore.setGrant(botId, next) === true) {
        this._logAudit({
          type: "grant-revoked",
          botId,
          tool: row.tool,
          provider: row.kind === "builtin" ? null : row.provider,
        });
      }
    }
    return this.listAlwaysAllowed(botId);
  },

  /**
   * Widen or narrow what a provider's remembered tools cover, or allow all
   * of them ahead of time (DASH-30, DASH-29): `action` is "anywhere",
   * "folders" or "all-tools" (changeProviderGrant). Only on a provider the
   * bot uses. Returns the new list.
   */
  changeAlwaysAllowed(botId, { provider, action } = {}) {
    const bot = this._store && this._store.get(botId);
    const uses =
      bot && Array.isArray(bot.mcpServers) && bot.mcpServers.includes(provider);
    if (uses) {
      const current = grantStore.getGrant(botId);
      const next = changeProviderGrant(current, provider, action);
      if (next !== current && grantStore.setGrant(botId, next) === true) {
        this._logAudit({
          type: "grant-saved",
          botId,
          tool: action === "all-tools" ? "*" : null,
          provider,
        });
      }
    }
    return this.listAlwaysAllowed(botId);
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
      if (next !== current) {
        grantStore.setGrant(botId, next);
        this._logAudit({
          type: "grant-revoked",
          botId,
          tool: toolName,
          provider: serverName,
        });
      }
    }
    return this.getGrants(botId);
  },

  // ---- opening a bot from a notification (US-018 AC5) ---------------------

  /**
   * A notification for this bot was clicked. Kept until the window takes it —
   * a window just reopened for the click asks once its dock is up; an open
   * one is told now. No bot (the tray's Open Bots panel) opens the list.
   */
  requestOpen(botId = null) {
    this._openRequest = { botId: botId ? String(botId) : null };
    this._broadcast(BOT_OPEN_REQUEST, {});
  },

  /** @returns {{ botId: (string|null) } | null} the pending request, cleared */
  takeOpenRequest() {
    const req = this._openRequest || null;
    this._openRequest = null;
    return req;
  },

  // ---- audit log (US-003 AC5, US-014 AC9, US-019 AC6) ---------------------

  /**
   * The saved audit log, newest first.
   * @param {{ botIds?: string[], kinds?: string[], before?: string,
   *   limit?: number }} [filters]
   * @returns {{ entries: object[], more: boolean }}
   */
  auditLog(filters = {}) {
    if (!this._auditLog) return { entries: [], more: false };
    return this._auditLog.read(filters || {});
  },

  /** A bot's name for the log — kept on the entry so it outlives the bot. */
  _botName(botId) {
    const testing = this._testBots && this._testBots.get(botId);
    if (testing) return `${testing.bot.name} (test)`;
    const bot = botId ? this._store.get(botId) : null;
    return (bot && bot.name) || null;
  },

  _logAudit(entry) {
    if (!this._auditLog || !entry) return;
    try {
      const named =
        entry.botId && !entry.botName
          ? { ...entry, botName: this._botName(entry.botId) }
          : entry;
      this._auditLog.append(named);
    } catch (err) {
      console.error("[botController] audit log write failed:", err);
    }
  },

  /** BudgetController's audit entries, in the log's shape. */
  _logBudgetAudit(entry) {
    if (!entry) return;
    if (entry.type === "budget-set") {
      const [scope, ...rest] = String(entry.scope || "").split(":");
      const id = rest.join(":") || null;
      const out = { type: "budget-set", scope, monthlyUsd: entry.monthlyUsd };
      if (scope === "bot") out.botId = id;
      if (scope === "workspace") {
        out.workspaceId = id;
        let ws = null;
        try {
          ws = this._loadWorkspace(id);
        } catch (_e) {
          ws = null;
        }
        out.dashboardName = (ws && ws.name) || null;
      }
      this._logAudit(out);
    } else if (entry.type === "budget-override") {
      const bot = this._store.get(entry.botId) || {};
      const st = this._budgets.botStatus(entry.botId, bot.workspaceId);
      this._logAudit({
        type: "budget-override",
        botId: entry.botId,
        month: entry.month,
        budgetUsd: (st && st.limit && st.limit.budget) || null,
        // Whose limit it went over: "bot", "workspace" or "global".
        budgetScope:
          (st && st.limit && String(st.limit.scope).split(":")[0]) || null,
      });
    }
    // "usage" (per-run cost) isn't logged — it's in Spending.
  },

  listApprovals() {
    return this._approvals.list();
  },

  // ---- budgets (US-019) ---------------------------------------------------

  getBudgets() {
    return this._budgets.getBudgets();
  },

  setBudget(scope, id, monthlyUsd) {
    const v = this._budgets.setBudget(scope, id, monthlyUsd);
    // "Over budget" / "80% of budget" may have changed.
    this._broadcast(BOT_LIST_CHANGED, {});
    // A raised limit frees bots — what waited for them runs (US-011 AC8).
    this._drainQueued();
    return v;
  },

  /** Current-month (or given month) spend buckets by scope. */
  getSpend(month) {
    return this._budgets.getSpend(month);
  },

  /** Explicit, audited override to keep a budget-exceeded bot running. */
  resumeBudget(botId) {
    const ok = this._budgets.resumeOverBudget(botId);
    // Lists showing "Over budget" refresh.
    this._broadcast(BOT_LIST_CHANGED, {});
    // What waited while it was over budget runs now (US-011 AC8).
    this._drainQueued([botId]);
    return ok;
  },

  /**
   * This month's spending by bot, dashboard and AI provider, and overall,
   * with limits (US-019 AC2/AC5 — the Spending view and budget fields).
   */
  spendingSummary() {
    let workspaces = [];
    try {
      workspaces =
        (
          require("./workspaceController").listWorkspacesForApplication(
            this._getMainWindow(),
            this._appId,
          ) || {}
        ).workspaces || [];
    } catch (_e) {
      workspaces = [];
    }
    return summarizeSpending({
      month: this._budgets.currentMonth(),
      spend: this._budgets.getSpend(),
      budgets: this._budgets.getBudgets(),
      bots: this.list(),
      workspaces,
      isOver: (id, ws) => this._budgets.isOverBudget(id, ws),
    });
  },

  /**
   * Every user bot's budget picture, by bot id (US-019; the Bots dock shows
   * "Over budget" / "80% of budget" and the over-budget note).
   */
  budgetStatus() {
    const out = {};
    for (const bot of this.list()) {
      if (!bot || !bot.id) continue;
      out[bot.id] = this._budgets.botStatus(bot.id, bot.workspaceId);
    }
    return out;
  },

  // ---- background / pause (US-014, US-018) ---------------------------------

  /** @returns {Array<{id: string, name: string}>} bots with an in-flight run */
  listRunning() {
    // A test from a bot's form isn't a bot running (bot-test-run): it
    // saves nothing, and quitting just stops it.
    return this._activeRuns().map((id) => {
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
    this._drainQueued();
    return this._pause.list();
  },

  pauseBot(botId) {
    this._pause.pauseBot(botId);
    return this._pause.list();
  },

  resumeBot(botId) {
    this._pause.resumeBot(botId);
    this._drainQueued([botId]);
    return this._pause.list();
  },

  isGloballyPaused() {
    return this._pause.isGloballyPaused();
  },

  /**
   * Who's paused, and how many events wait for each held bot (US-011 AC8):
   * { global, bots, queued: { [botId]: n } }.
   */
  getPauseState() {
    return { ...this._pause.list(), queued: this._pausedQueue.counts() };
  },

  // ---- internals ----------------------------------------------------------

  /**
   * Would this run start a job while its team has one going (DASH-81)? Then
   * it's held (_holdForTeam): the run's promise. Otherwise null, and it runs
   * as usual. What the user does in Dash, and what's asked over MCP, isn't
   * held; give_task queues in startTaskJob.
   */
  _gateTeamJob(botId, bot, { jobId, willStart, opts }) {
    const startsJob =
      !jobId &&
      willStart &&
      !isDashTeam(bot) &&
      !opts.noTools &&
      (isLead(bot)
        ? opts.trigger !== "schedule" && opts.trigger !== "catch-up"
        : opts.trigger !== "flow" && startsChain(this._store, bot));
    if (!startsJob || !this._teamBusy(bot.workspaceId)) return null;
    return this._holdForTeam(botId, bot, opts);
  },

  /**
   * A run that would start a job while its team has one going (DASH-81).
   * A schedule's run is skipped, saying why; a trigger's waits as a queued
   * job and runs when its turn comes. Returns the run's promise, or null
   * when it isn't held (the user's own runs, MCP asks).
   */
  _holdForTeam(botId, bot, opts) {
    const trigger = opts.trigger || "manual";
    const ws = bot.workspaceId;
    const skip = (reason) => {
      this._broadcast(BOT_STREAM, {
        botId,
        event: { type: "skipped", reason },
      });
      return Promise.resolve({ botId, skipped: true, reason });
    };
    const active = this._jobs.activeFor(ws);
    const busyWith = active
      ? `the team is busy with "${active.title}"`
      : "the team has jobs waiting their turn";
    if (trigger === "schedule" || trigger === "catch-up") {
      return skip(`${busyWith} (one job at a time)`);
    }
    if (trigger !== "event") return null;
    if (this._jobs.queueFull(ws)) {
      return skip("the team's queue is full (20 jobs waiting)");
    }
    const asked = String(opts.jobTitle || opts.prompt || "").split("\n")[0];
    const lead = isLead(bot);
    const job = this._jobs.startJob({
      workspaceId: ws,
      leadId: lead ? bot.id : null,
      leadName: bot.name,
      title: lead ? asked : asked ? `${bot.name}: ${asked}` : bot.name,
      request: lead ? String(opts.jobTitle || opts.prompt || "") : "",
      startedBy: lead
        ? jobStartedBy(opts)
        : chainStartedBy(bot, opts, jobStartedBy(opts)),
      conversationId: opts.conversationId || null,
      queued: true,
    });
    return this._jobs.waitForStart(job.id).then((started) =>
      started
        ? this._run(botId, { ...opts, jobId: job.id })
        : {
            botId,
            skipped: true,
            reason: "it was taken out of the team's queue",
          },
    );
  },

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
    // The goal this run works on (goals ledger): carried from the event
    // that started it, or set by the goal tools when the bot claims a task.
    // The same object rides on the cause, so the run's events carry it.
    // A bot asked by its lead starts on the lead's goal (its own copy); a
    // flow step, on its goal's task.
    const cause =
      opts.cause ||
      (opts.goal && opts.goal.goalId
        ? {
            ...rootCause(),
            goal: {
              goalId: opts.goal.goalId,
              taskId: opts.goal.taskId || null,
            },
          }
        : rootCause());
    const goal = cause.goal || { goalId: null, taskId: null };
    cause.goal = goal;
    // The job (DASH-28, DASH-31): a team lead's own run starts one; every
    // run in its chain joins it — a bot it asks, a hand-on, a check's
    // retry. Its id rides the cause, so the run's events carry it on.
    const bot = this._store.get(botId) || {};
    const willStart = !this._runner.listActive().includes(botId);
    let jobId =
      opts.jobId ||
      (cause.jobId ? this._handOnJob(cause, bot) : null) ||
      (goal.goalId ? this._jobs.jobForGoal(goal.goalId) : null) ||
      null;
    // One job at a time per team (DASH-81): held, or run as usual.
    const held = this._gateTeamJob(botId, bot, { jobId, willStart, opts });
    if (held) return held;
    if (
      !jobId &&
      willStart &&
      isLead(bot) &&
      !isDashTeam(bot) &&
      !opts.noTools &&
      opts.trigger !== "schedule" &&
      opts.trigger !== "catch-up"
    ) {
      jobId = this._jobs.startJob({
        workspaceId: bot.workspaceId,
        leadId: bot.id,
        leadName: bot.name,
        title: String(opts.jobTitle || opts.prompt || "").split("\n")[0],
        request: String(opts.jobTitle || opts.prompt || ""),
        startedBy: jobStartedBy(opts),
        conversationId: opts.conversationId || null,
      }).id;
    }
    // A chain's first run is a job too (DASH-70): a bot on a team whose
    // runs start other bots (a scheduled Ticket Bot, say) — so one ticket
    // is one job, all its steps on it. A check's retry joins its own.
    if (
      !jobId &&
      willStart &&
      !isLead(bot) &&
      !isDashTeam(bot) &&
      !opts.noTools &&
      opts.trigger !== "flow" &&
      startsChain(this._store, bot)
    ) {
      const asked = String(opts.jobTitle || opts.prompt || "").split("\n")[0];
      jobId = this._jobs.startJob({
        workspaceId: bot.workspaceId,
        leadId: null,
        leadName: bot.name,
        title: asked ? `${bot.name}: ${asked}` : bot.name,
        request: "",
        startedBy: chainStartedBy(bot, opts, jobStartedBy(opts)),
        conversationId: opts.conversationId || null,
      }).id;
    }
    if (jobId) cause.jobId = jobId;
    // A check's retry or review is part of its step's checks, not a step.
    let jobStep = null;
    if (jobId && willStart && opts.trigger !== "flow") {
      jobStep = this._jobs.startStep(jobId, {
        botId,
        botName: bot.name,
        why: jobWhy(this._store, bot, opts),
        conversationId: opts.conversationId || null,
      });
    } else if (jobId && !willStart && opts.trigger === "event") {
      this._jobs.skipStep(jobId, {
        botId,
        botName: bot.name,
        why: jobWhy(this._store, bot, opts),
        summary: `${bot.name} was busy with another run, so this hand-on didn't start.`,
      });
    }
    let jobStepEnded = false;
    const endJobStep = (record, checking = null) => {
      if (!jobStep || jobStepEnded) return;
      jobStepEnded = true;
      this._jobs.endStep(jobId, { botId, record, checking });
      // The rows of the team's tables its answer picked (DASH-84): the
      // job's later runs fill {repo.*} from them.
      if (record && record.status === "completed" && record.output) {
        this._rememberPicks(jobId, bot.workspaceId, record.output);
        // What it's about and where its files are (DASH-100).
        this._rememberContext(jobId, botId, record.output);
      }
    };
    // A bot with checks holds the results it sends until they pass
    // (bot-checks PRD).
    if (!alreadyRunning) {
      this._events.startRun(botId, cause, {
        hold: this._checkJobs.holdsRun(this._store.get(botId), opts),
        // What it was given (DASH-92): its `failed` event carries it, so
        // whatever reports the failure knows what it was working on.
        input: typeof opts.prompt === "string" ? opts.prompt : "",
        picks:
          typeof this._runPicks === "function"
            ? this._runPicks(botId, jobId, opts.prompt)
            : null,
      });
    }
    // Who started the bot's current run — a lead asked from outside Dash
    // can't run its bots (leadAsk.js). Only a run that will start counts.
    let viaEntry = null;
    if (!this._runner.listActive().includes(botId)) {
      if (!this._runVia) this._runVia = new Map();
      viaEntry = {
        via: opts.via || null,
        conversationId: opts.conversationId || null,
        jobId,
      };
      this._runVia.set(botId, viaEntry);
      // The run's goal, so a goal deleted mid-run is forgotten by it.
      if (!this._runGoals) this._runGoals = new Map();
      this._runGoals.set(botId, goal);
    }
    const p = this._runner.run(botId, {
      prompt: opts.prompt,
      trigger: opts.trigger,
      // What triggered an event run, for the run record (Bots view).
      source: opts.source || null,
      // The rows of its team's tables this job picked (DASH-84).
      ...(jobId && this._jobs.picksOf
        ? { teamPicks: this._jobs.picksOf(jobId) }
        : {}),
      // Its job's work item and workspace (DASH-100).
      ...(jobId && this._jobs.contextOf
        ? { teamContext: this._jobs.contextOf(jobId) }
        : {}),
      // Who asked, when not the user directly (the AI Assistant, TEAM-004).
      via: opts.via || null,
      // The conversation it came from (release 5).
      ...(opts.conversationId
        ? { conversationId: String(opts.conversationId) }
        : {}),
      // Follow-ups (Ask the lead) resume the session; runs start fresh.
      continueSession: !!opts.continueSession,
      // A plan build's own team runs: no prompts (the plan was the consent).
      approvalPolicy: opts.approvalPolicy || undefined,
      // A run its team lead started: tools that delete or send still ask
      // (DASH-29).
      ...(opts.leadRequest ? { leadRequest: true } : {}),
      // A hand-off while the user is still planning: answers only — none
      // of the tools that change things (no approvals to wait on).
      ...(opts.adviseOnly ? { adviseOnly: true } : {}),
      // No tools at all: answer from the prompt (TEAM-016 routing).
      ...(opts.noTools ? { noTools: true } : {}),
      // A Dash team run inside a plan (or a question): that plan's memory
      // tools, and its memory calls go to the plan's bucket (4e-1). Dropped
      // here before, so the prompt's MEMORY_NOTE named tools it never had.
      ...(opts.planId ? { planId: String(opts.planId) } : {}),
      goal,
      // A flow task's own copy of the bot's folder, and its step's limits
      // (flows PRD, phase 5).
      ...(opts.workingDir ? { workingDir: String(opts.workingDir) } : {}),
      ...(opts.limits ? { limits: opts.limits } : {}),
      emit: (event) => {
        if (!alreadyRunning) this._events.onRunEvent(botId, event);
        this._broadcast(BOT_STREAM, { botId, event });
        if (typeof opts.onEvent === "function") {
          try {
            opts.onEvent(event);
          } catch {
            // What the caller does with it never stops the run.
          }
        }
      },
    });
    // The runner marks the bot active synchronously, so the active count is
    // already updated here. Broadcast on start and again on completion so the
    // tray/powerSaveBlocker can react (US-018).
    this._broadcastRunActive();
    // The run in progress, so a lead asking a bot that a hand-on in the same
    // job already started waits for that run (DASH-28).
    let activeEntry = null;
    if (willStart) {
      if (!this._runsInProgress) this._runsInProgress = new Map();
      activeEntry = { jobId, promise: Promise.resolve(p) };
      this._runsInProgress.set(botId, activeEntry);
    }
    Promise.resolve(p)
      .then((record) => {
        // A bot with checks: its work is held as a job until they pass
        // (bot-checks PRD). Otherwise completed / failed → the bus
        // (skipped runs publish nothing).
        let held = false;
        if (!alreadyRunning) {
          try {
            held = this._checkJobs.afterRun({ botId, opts, record, jobId });
          } catch (_e) {
            held = false;
          }
        }
        if (!alreadyRunning && !held) {
          this._events.endRun(this._store.get(botId), record);
        }
        endJobStep(
          record,
          held && record && record.checks && record.checks.goalId
            ? { goalId: record.checks.goalId }
            : null,
        );
        // A failed run notifies (US-018 AC5).
        this._sendNotice(failureNotice(this._store.get(botId), record));
        // What went wrong goes in Issues; a clean run resolves the bot's.
        this._recordRunIssues(this._store.get(botId), record);
      })
      .catch((e) => {
        endJobStep({ status: "failed", error: (e && e.message) || null });
      })
      .finally(() => {
        // A run that ended without a record still ends its step.
        endJobStep({ status: "stopped" });
        if (activeEntry && this._runsInProgress.get(botId) === activeEntry) {
          this._runsInProgress.delete(botId);
        }
        if (viaEntry && this._runVia.get(botId) === viaEntry) {
          this._runVia.delete(botId);
        }
        // A task the run claimed but never wrote a done record for is let
        // go, so the next bot can pick it up (only for a run that started).
        if (viaEntry) {
          goalController.release(botId);
          if (this._runGoals.get(botId) === goal) this._runGoals.delete(botId);
        }
        this._broadcastRunActive();
      });
    return p;
  },

  /**
   * Put a bot's event on the dashboard bus: every window's widgets (via the
   * same broadcast channel widget events use) and subscribed bots. Bot
   * dispatch is deferred a tick so bot→bot chains never recurse on the stack.
   */
  _publishBotEvent(msg) {
    this._withJobContext(msg);
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

  /** Hand a bot notice to the host to send as an OS notification. */
  _sendNotice(notice) {
    if (!notice || !this._notify) return;
    try {
      this._notify(notice);
    } catch (err) {
      console.error("[botController] notification failed:", err);
    }
  },

  /** A dashboard's name by id, or null. */
  _dashboardName(workspaceId) {
    try {
      const w = this._loadWorkspace(workspaceId);
      return (w && w.name) || null;
    } catch (_e) {
      return null;
    }
  },

  /** Bots running now — not tests from a bot's form (bot-test-run). */
  _activeRuns() {
    return this._runner
      .listActive()
      .filter((id) => !(this._testBots && this._testBots.has(id)));
  },

  _broadcastRunActive() {
    const running = this._activeRuns();
    this._broadcast(BOT_RUN_ACTIVE, { count: running.length, running });
  },

  /** The fresh model list: where it came from and when it was checked. */
  modelListStatus() {
    return this._modelList ? this._modelList.status() : null;
  },

  /** Check for new and retired models now. */
  checkModelList() {
    return this._modelList ? this._modelList.check() : Promise.resolve(null);
  },

  /** Settings, bots and dashboards: where models are saved. */
  _modelUsageInput() {
    // Every dashboard on this computer — a retired model can sit in a
    // profile that isn't open — and which ones the active profile shows.
    let workspaces = [];
    let activeIds = null;
    try {
      const { getAppFilePath } = require("../utils/appPaths");
      const { getFileContents } = require("../utils/file");
      const all = getFileContents(
        getAppFilePath(this._appId, "workspaces.json"),
      );
      workspaces = Array.isArray(all) ? all : [];
      const res =
        require("./workspaceController").listWorkspacesForApplication(
          this._getMainWindow(),
          this._appId,
        ) || {};
      activeIds = new Set((res.workspaces || []).map((w) => String(w.id)));
    } catch (_e) {
      workspaces = [];
      activeIds = null;
    }
    return {
      settings: this._store.getSettings() || {},
      bots: this._store.list() || [],
      workspaces,
      activeIds,
    };
  },

  /**
   * Where retired models are still saved (Settings › AI's notice), and how
   * many widgets follow each family (the new-model note).
   * @returns {{ retired: object[], widgetsFollowing: object }}
   */
  modelUsage() {
    const input = this._modelUsageInput();
    const retired = retiredUsage(input).map(({ choices, ...u }) => ({
      ...u,
      bots: choices
        .filter((c) => c.kind === "bot")
        .map((c) => ({ id: c.botId, name: c.name })),
      // Settings › AI defaults, and the Dash team's older per-role picks.
      defaultJobs: choices
        .filter((c) => c.kind === "default" || c.kind === "teamPick")
        .map((c) =>
          c.kind === "default"
            ? JOB_NAMES[c.job] || c.job
            : `Create · ${c.role}`,
        ),
    }));
    const families = [
      ...new Set(
        getCuratedModels("claude-code")
          .map((m) => m.family)
          .filter(Boolean),
      ),
    ];
    const widgetsFollowing = {};
    for (const f of families) {
      widgetsFollowing[latestAlias(f)] = countFollowing(
        input,
        latestAlias(f),
        "widget",
      );
    }
    return { retired, widgetsFollowing };
  },

  /**
   * Move every saved choice of a retired model — job defaults, bots, the
   * Dash team's picks and widgets on every dashboard — to `to` (else what
   * replaces it). Written to the saved settings, so they say what runs.
   * @returns {{ moved: number, to: string, dashboards: number,
   *   failed: number } | { error: string }}
   */
  moveRetiredModel(from, to = null, { forAll = false } = {}) {
    const target = to || moveTarget(from);
    if (!target) return { error: "Choose a model to move them to." };
    if (!isKnownModel("claude-code", target)) {
      return { error: `${target} isn't a model Dash can run.` };
    }
    const input = this._modelUsageInput();
    const plan = planMove(input, from, target, { forAll });
    const current = this._store.getSettings() || {};
    const next = {};
    if (Object.keys(plan.aiDefaults).length) {
      next.ai = mergeAiSettings(current.ai, { defaults: plan.aiDefaults });
    }
    if (plan.teamPicks) {
      next.dashTeam = { ...(current.dashTeam || {}), models: plan.teamPicks };
    }
    if (Object.keys(next).length) this._store.setSettings(next);
    for (const b of plan.bots) this._store.update(b.id, { model: b.model });
    let failed = 0;
    for (const ws of plan.workspaces) {
      const res = this._saveWorkspace(ws);
      if (res && res.error) failed++;
    }
    if (this._notifyListChanged) this._notifyListChanged();
    this._broadcast(LLM_MODEL_LIST_CHANGED, this.modelListStatus());
    return {
      moved: plan.count,
      to: target,
      dashboards: plan.workspaces.length - failed,
      failed,
      exact: plan.exact,
    };
  },

  /** Settings showed the new-model note. */
  modelListSeen() {
    return this._modelList ? this._modelList.clearAdded() : null;
  },

  /**
   * The saved Anthropic API key, only while Settings › AI runs on one: it
   * narrows the model list to what the key can use.
   */
  _anthropicKey() {
    try {
      if (readAi(this._store.getSettings()).backend !== "api") return null;
      const win = this._getMainWindow();
      const { providers = [] } =
        this._providers.listProviders(win, this._appId) || {};
      const match =
        providers.find((p) => p.type === "anthropic" && p.isDefaultForType) ||
        providers.find((p) => p.type === "anthropic");
      return (match && match.credentials && match.credentials.apiKey) || null;
    } catch (_e) {
      return null;
    }
  },

  /**
   * A run found its model gone: check the list again, then run on what
   * replaces it — else on the bot's job default, else the provider's.
   * `label` says which default, for the issue the run records.
   * @returns {Promise<{ model: string, known: boolean, label?: string }|null>}
   */
  async _replacementModel(gone) {
    const pick = await this._replacementPick(gone);
    if (!pick) return null;
    const takesEffort = getCuratedModels(gone.providerId).some(
      (m) =>
        m.value === pick.model &&
        m.reasoning &&
        m.reasoning.control === "effort",
    );
    return { ...pick, takesEffort };
  },

  async _replacementPick({ botId, providerId, model }) {
    if (this._modelList) await this._modelList.checkNow();
    const next = migrateModelId(providerId, model);
    if (next && next !== model) return { model: next, known: true };
    const testing = this._testBots && this._testBots.get(botId);
    const bot = testing ? testing.bot : this._store.get(botId);
    if (bot) {
      const settings = this._store.getSettings();
      const fallback = this._modelPick({ ...bot, model: null }, settings);
      if (fallback.model && fallback.model !== model) {
        const job = jobOf(bot);
        const saved = defaultModelFor(
          { ...bot, model: null },
          readAi(settings),
        );
        return {
          model: fallback.model,
          known: false,
          label: fallback.chosen
            ? `your ${JOB_NAMES[job] || "job's"} default (${modelText(providerId, saved || fallback.model)})`
            : modelText(providerId, fallback.model),
        };
      }
    }
    const def = getDefaultModel(providerId);
    return def && def !== model
      ? { model: def, known: false, label: modelText(providerId, def) }
      : null;
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

  /**
   * Which model a bot runs on, and why (which model ran it): its own model,
   * then its job's default in Settings › AI (a Claude model, only for bots
   * on Claude), else Dash team bots on their role's model for the provider,
   * leads on the fast tier (they only read team data), others on the
   * provider's default. `chosen`: the user picked it (the bot's own model or
   * a job default), not built in.
   * @returns {{ providerId, model, style: object|null, chosen: boolean }}
   */
  _modelPick(bot, settings = this._store.getSettings()) {
    const ai = readAi(settings);
    const providerId = resolveBotProviderId(bot, backendProvider(ai));
    const jobDefault = defaultModelFor(bot, ai);
    // A job default this provider can run: a family ("Latest Haiku"), a
    // listed model, or a retired one with a known replacement.
    const jobModel =
      jobDefault && isKnownModel(providerId, jobDefault) ? jobDefault : null;
    let model;
    if (bot.model) {
      model = migrateModelId(providerId, bot.model);
    } else if (jobModel) {
      model = migrateModelId(providerId, jobModel);
    } else if (isDashTeam(bot)) {
      model = migrateModelId(
        providerId,
        modelForRole(bot, providerId, settings),
      );
    } else if (isLead(bot)) {
      model = tierModel(providerId, "fast") || getDefaultModel(providerId);
    } else {
      model = getDefaultModel(providerId);
    }
    return {
      providerId,
      model,
      style: styleFor(bot, ai),
      chosen: !!(bot.model || jobModel),
    };
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
    // Settings › AI: what a bot without its own provider runs on, each job's
    // default model and style, and the limits on one run.
    const settings = this._store.getSettings();
    const ai = readAi(settings);
    // The bot's own provider, else Settings › AI's, else Claude Code (CLI).
    const followsDefault = !bot.provider;
    const { providerId, model, style, chosen } = this._modelPick(bot, settings);
    const provider = getProvider(providerId);

    let credentials = {};
    try {
      const match =
        providers.find((p) => p.type === providerId && p.isDefaultForType) ||
        providers.find((p) => p.type === providerId);
      if (match && match.credentials) credentials = match.credentials;
    } catch (_e) {
      // Leave credentials empty — the engine will surface a clear auth error.
    }

    // Following Settings › AI onto the API key with no key saved: say so,
    // never fall back to the Claude login quietly.
    if (followsDefault && providerId === "anthropic" && !credentials.apiKey) {
      throw new Error(
        "Settings › AI runs AI with an Anthropic API key, but no key is saved. Add one in Settings › AI, or switch back to your Claude subscription.",
      );
    }

    // The style's effort, when the model takes one (Haiku 4.5 and other
    // providers' models don't).
    const takesEffort = getCuratedModels(providerId).some(
      (m) =>
        m.value === model && m.reasoning && m.reasoning.control === "effort",
    );
    // An API key pays per run: the cost cap applies (Claude Code is the plan).
    const limits = runLimitsFor(bot, ai, {
      paid: providerId !== DEFAULT_BOT_PROVIDER,
    });

    return {
      providerId,
      // A bot may pin an engine (e.g. "claude-agent"). A bot following
      // Settings › AI onto the API key runs on the Claude Agent engine too —
      // tools, cache and effort, like the CLI. Otherwise derive it from the
      // provider (tool-loop for anthropic/openai/xai).
      engineId:
        bot.engine ||
        (followsDefault && providerId === "anthropic"
          ? "claude-agent"
          : provider.engine),
      effort: style && takesEffort ? style.effort : null,
      // The answer-length line isn't for Create's roles: their answers have
      // formats the next step reads (a verdict, a list of matches).
      styleLine: style && !isDashTeam(bot) ? style.line : null,
      // The style's name ("thorough"), kept with the run (which model ran it).
      style: style ? style.style : null,
      // The user picked that model (Settings › AI or the bot's own).
      modelChosen: !!chosen,
      maxTurns: limits.maxTurns,
      maxMinutes: limits.minutes,
      maxCostUsd: limits.costPerRun,
      // Keep the cache an hour for runs that come back within one: Create,
      // leads (conversations) and bots scheduled at least hourly.
      longCache: runsAgainWithinHour(bot),
      adapterId: provider.adapter,
      baseURL: provider.baseURL,
      model,
      credentials,
      // Dash's built-in instructions, then the user's own.
      instructions: instructionsFor(bot, {
        dashboardName: isLead(bot)
          ? this._dashboardName(bot.workspaceId)
          : null,
      }),
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
   * is reused — same dashboard, unchanged pieces kept. A plan that names a
   * dashboard (plan.dashboard, 5e-2b) adds to that one instead of making one.
   * `cell` (consolidation Phase 2b): one widget for a cell of a dashboard
   * being edited — built, checked, previewed by the user (approvePlanStep /
   * revisePlanStep), installed; never placed here: the editor places it.
   * `bot` (Phase 2c-1): one bot — checked, saved paused on the dashboard
   * the plan names (or Unassigned); never a new dashboard.
   * `edit` (Phase 3): a change to one widget the user has — { component,
   * mode: "update" | "new", displayName, settings, providers } — built,
   * checked and previewed like a cell build. Which package it is, and
   * whether the user may change it in place, is worked out here.
   */
  startPlanBuild(
    plan,
    {
      dashboardName = null,
      resumeFrom = null,
      recentId = null,
      cell = false,
      // A widget on its own (Phase 3b): built as a cell's, not for a dashboard.
      standalone = false,
      bot = false,
      edit = null,
      // Only a widget's settings (lead-workspace release 6c): { workspaceId,
      // itemId, pageId, scope, component, displayName } — that copy.
      settings = null,
    } = {},
  ) {
    if (!plan || !Array.isArray(plan.pieces) || !plan.pieces.length) {
      return { error: "The plan has nothing to build." };
    }
    const settingsOf =
      settings &&
      typeof settings === "object" &&
      settings.workspaceId != null &&
      settings.itemId != null &&
      typeof settings.component === "string"
        ? {
            workspaceId: settings.workspaceId,
            itemId: settings.itemId,
            pageId: settings.pageId ?? null,
            scope: settings.scope || "main",
            component: settings.component,
            displayName:
              typeof settings.displayName === "string"
                ? settings.displayName.slice(0, 80)
                : "",
          }
        : null;
    if (settings && !settingsOf) {
      return { error: "Couldn't tell which widget's settings to change." };
    }
    if (settingsOf) {
      // A settings change goes to that copy — never a dashboard plan.
      const { dashboard: _d, ...rest } = plan;
      plan = rest;
    }
    let editTarget = null;
    if (edit) {
      editTarget = this._editTarget(edit);
      if (editTarget.error) return { error: editTarget.error };
      plan = editPlan(plan, editTarget);
    }
    // Checked against the user's own dashboards and themes (consolidation
    // Phase 1b): a plan with errors isn't built.
    const checked = validatePlan(plan, {
      dashboards: this._dashboardsWithBots(),
      // A theme this conversation made is the plan's own, not taken
      // (carrying on, a changed plan, building again: theme round).
      themes: this._themeNames(recentId),
      // A change can be to any saved theme, this conversation's too.
      savedThemes: this._themeNames(),
      cell: !!cell,
      standalone: !!(cell && standalone),
      bot: !!bot,
      settings: !!settingsOf,
      edit: editTarget
        ? { package: editTarget.package, mode: editTarget.mode }
        : null,
    });
    if (checked.errors.length) {
      return {
        error: `The plan can't be built yet: ${checked.errors.join(" ")}`,
      };
    }
    if (!this._builds) this._builds = new Map();
    // Its conversation in Recent (4e-1) — a build without one isn't kept.
    const planId = recentId && this._recent.get(recentId) ? recentId : null;
    let resume = null;
    if (resumeFrom) {
      const earlier =
        this._builds.get(resumeFrom) || this._restoredBuild(resumeFrom);
      if (!earlier) return { error: "The earlier build isn't there any more." };
      if (isBuildBusy(earlier.state)) {
        return { error: "The earlier build is still running." };
      }
      if (earlier.state && earlier.state.status === "removed") {
        return { error: "What the earlier build made was removed." };
      }
      // An edit can't move the work to another dashboard.
      const was =
        earlier.state && earlier.state.dashboard
          ? earlier.state.dashboard
          : null;
      const target = planTarget(plan);
      if (
        was &&
        (target
          ? !was.targeted || String(was.id) !== target.id
          : !!was.targeted)
      ) {
        return {
          error:
            "This plan now changes a different dashboard — start a new plan for it.",
        };
      }
      resume = { plan: earlier.plan, state: earlier.state };
      // The new build owns that work now (and removes it, if asked).
      this._builds.delete(resumeFrom);
    }
    const buildId = `build_${Date.now()}`;
    const entry = {
      plan,
      state: null,
      build: null,
      recentId: planId,
      cell: !!cell,
    };
    const build = createPlanBuild(
      plan,
      {
        installWidget: (pkg, piece) => this._planInstallWidget(pkg, piece),
        createDashboard: (name, count, pages) =>
          this._planCreateDashboard(name, count, pages),
        useDashboard: (id) => this._planUseDashboard(id),
        applyTheme: (req) => this._planApplyTheme(req),
        makeTheme: (req) => this._planMakeTheme({ ...req, madeIn: planId }),
        changeTheme: (req) => this._planChangeTheme({ ...req, madeIn: planId }),
        setWidgetSettings: (req) => this._planSetWidgetSettings(req),
        // A cell build's own Builder / Checker: while they run, the Dash
        // team's place_widget / installDraft refuse (Phase 2b).
        askRole: editTarget
          ? (role, request, live) =>
              this._editAskRole(role, request, editTarget, live)
          : cell
            ? async (role, request, live) => {
                this._cellRoleRuns = (this._cellRoleRuns || 0) + 1;
                try {
                  return await this._planAskRole(role, request, planId, live);
                } finally {
                  this._cellRoleRuns -= 1;
                }
              }
            : (role, request, live) =>
                this._planAskRole(role, request, planId, live),
        abortRole: (role) => {
          const bot = dashTeamBot(this._store.list(), role);
          if (bot) this._runner.abort(bot.id);
        },
        placeWidget: (req) => this._planPlaceWidget(req),
        // A cell build hands the editor the component to place (Phase 2b).
        resolveComponent: (pkg, name) => {
          const r = resolveWidgetComponent(
            pkg,
            null,
            () => require("../widgetRegistry").getWidgetRegistry().getWidgets(),
            { name },
          );
          return r && !r.error ? r.component : null;
        },
        // A change's preview runs with a copy's own connection and settings.
        copyInputs: ({ package: pkg, workspaceId }) =>
          this._widgetCopyInputs(pkg, workspaceId),
        // A draft's code, held to what the user chose (specChecks) before
        // the Checker runs — compiled or not.
        draftCode: async ({ draft }) => {
          const tools = this._widgetTools;
          if (!draft || !tools) return null;
          const r = tools.draftCode
            ? tools.draftCode({ name: draft })
            : tools.previewDraft
              ? tools.previewDraft({ name: draft })
              : null;
          return r && r.success
            ? { componentCode: r.componentCode, configCode: r.configCode }
            : null;
        },
        // The widget's provider tools, running — their read-only flags.
        liveTools: (types) => this._liveToolsFor(types),
        // While the Builder builds: build_widget holds each draft to what
        // the user chose (null when it's done).
        // (Only the plan's Builder hears it; letting go clears only its own.)
        holdBuilder: (fn) => {
          const hold = { fn };
          this._builderHold = hold;
          return () => {
            if (this._builderHold === hold) this._builderHold = null;
          };
        },
        // A cell build's preview inputs: the draft's (or installed widget's)
        // config source — parsed, never run, in planBuild.
        previewConfig: async ({ draft, component }) => {
          if (draft && this._widgetTools && this._widgetTools.previewDraft) {
            const r = this._widgetTools.previewDraft({ name: draft });
            return r && r.success
              ? { configCode: r.configCode, componentName: r.componentName }
              : null;
          }
          const parts = String(component || "").split(".");
          if (parts.length < 3) return null;
          // Found by its component: registry packages are kept under their
          // bare name ("clock"), not "@trops/clock".
          const reg = require("../widgetRegistry");
          const installed = (reg.getWidgetRegistry().getWidgets() || []).find(
            (w) => w && (w.componentNames || []).includes(component),
          );
          const widgetName = installed
            ? installed.name
            : `@${parts[0]}/${parts[1]}`;
          const src = await reg.readWidgetSources({
            widgetName,
            componentName: component,
          });
          return src && src.success
            ? {
                configCode: src.configCode,
                componentName: parts[parts.length - 1],
                widgetName,
              }
            : { widgetName };
        },
        // The Install step: the draft the Checker passed (Phase 1b).
        installBuilt: (draft) =>
          editTarget
            ? this._planInstallEdit(draft, editTarget)
            : this._widgetTools && this._widgetTools.installDraft
              ? this._widgetTools.installDraft({ name: draft })
              : { success: false, error: "installing isn't available here" },
        // A bot build's check before the save (2c-1).
        checkBot: (req) => this._planCheckBot(req),
        // What the user tests before it's saved (bot-test-run TST-003).
        botDefinition: (req) => this._planBotDefinition(req),
        saveBot: (req) => this._planSaveBot(req),
        placeBotResults: ({ dashboardId, botId }) => {
          const res = this.addBotWidget(dashboardId, {
            kind: "results",
            botId,
          });
          if (res && res.error) throw new Error(res.error);
          return {
            component: BOT_WIDGETS.results,
            widgetId: res.widgetId,
            pageId: res.pageId,
          };
        },
        wireTrigger: (req) => this._planWireTrigger(req),
        wireListener: (req) => this._planWireListener(req),
        emit: (state) => {
          entry.state = state;
          this._broadcast(BOT_PLAN_BUILD_PROGRESS, { buildId, state });
          this._keepBuild(planId, buildId, plan, state);
        },
      },
      {
        dashboardName,
        resume,
        autoFix: true,
        cell: !!cell,
        standalone: !!(cell && standalone),
        bot: !!bot,
        edit: editTarget,
        settings: settingsOf,
      },
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
    const entry =
      (this._builds && this._builds.get(buildId)) ||
      this._restoredBuild(buildId);
    // `restored`: nothing runs it now (a restart, or a plan carried on from
    // the Create window) — Carry on building starts it again.
    return entry
      ? { buildId, state: entry.state, restored: !entry.build }
      : null;
  },

  /** A finished build and one of its steps, or { error }. */
  _finishedBuild(buildId, stepId = null) {
    const entry =
      (this._builds && this._builds.get(buildId)) ||
      this._restoredBuild(buildId);
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
    if (!entry.build) return { error: "Continue building first." };
    // The end of the line (held to your choices): the user took the
    // closest that works — the Builder builds it that way.
    if (
      step.status === "failed" &&
      step.endOfLine &&
      step.endOfLine.closest &&
      entry.build.settle
    ) {
      return this._continueBuild(entry.build.settle(stepId));
    }
    if (step.status !== "failed" || !step.canFix) {
      return { error: "The Builder can't fix that step." };
    }
    return this._continueBuild(entry.build.fix(stepId));
  },

  /** Try again: a failed Dash step runs again. */
  retryPlanBuild(buildId, stepId) {
    const { entry, step, error } = this._finishedBuild(buildId, stepId);
    if (error) return { error };
    if (!entry.build) return { error: "Continue building first." };
    if (step.status !== "failed" || !step.canRetry) {
      return { error: "That step can't be tried again." };
    }
    return this._continueBuild(entry.build.retry(stepId));
  },

  /**
   * Looks good (a cell build's preview, Phase 2b): carry on with the user's
   * picks { providers, settings } — the widget is installed.
   */
  approvePlanStep(buildId, stepId, inputs = {}) {
    const { entry, step, error } = this._finishedBuild(buildId, stepId);
    if (error) return { error };
    if (!entry.build) return { error: "Continue building first." };
    // A widget's preview, or a bot's test (bot-test-run TST-003).
    if (
      (step.kind !== "preview" && step.kind !== "testbot") ||
      step.status !== "needs-you"
    ) {
      return { error: "Nothing is waiting there." };
    }
    return this._continueBuild(entry.build.approve(stepId, inputs));
  },

  /**
   * Change something (a cell build's preview): back to the Builder. With
   * marks (Mark a spot), a picture of the preview with the boxes on it is
   * taken from the window that sent them (webContents) for the Builder;
   * the chat gets a small copy (thumb).
   */
  async revisePlanStep(
    buildId,
    stepId,
    note,
    marks = null,
    webContents = null,
  ) {
    const { entry, step, error } = this._finishedBuild(buildId, stepId);
    if (error) return { error };
    if (!entry.build) return { error: "Continue building first." };
    if (step.kind !== "preview" || step.status !== "needs-you") {
      return { error: "Nothing is waiting there." };
    }
    if (!String(note || "").trim()) return { error: "Say what to change." };
    // Refused (too many changes, still running): said, never a fix.
    const problem =
      entry.build.reviseProblem && entry.build.reviseProblem(stepId, note);
    if (problem) return { error: problem };
    const shot =
      marks && webContents && webContents.capturePage
        ? await captureMarks(webContents, marks)
        : null;
    const res = this._continueBuild(entry.build.revise(stepId, note, shot));
    return shot
      ? {
          ...res,
          marked: shot.spots.length,
          ...(shot.thumb ? { thumb: shot.thumb } : {}),
          ...(shot.error ? { pictureError: shot.error } : {}),
        }
      : res;
  },

  /**
   * A cell build's Builder or Checker is at work: the editor places that
   * widget after the user previews it, so nothing is installed or placed
   * by the team meanwhile.
   */
  _cellBuildRunning() {
    return (this._cellRoleRuns || 0) > 0;
  },

  /**
   * The widget a change goes to (Phase 3): found from what's installed —
   * the renderer only names the component — with the cell's connection and
   * settings to preview it with. In place needs the user signed in to the
   * registry (unless the AI built it); the install checks it's theirs.
   */
  _editTarget(edit) {
    const t = resolveEditTarget(
      edit,
      require("../widgetRegistry").getWidgetRegistry().getWidgets() || [],
    );
    if (t.error) return t;
    if (
      t.mode === "update" &&
      !t.aiBuilt &&
      !require("./registryAuthController").getAuthStatus().authenticated
    ) {
      return {
        error: `Sign in to the registry to change ${t.componentName} in place — or save the change as a new widget.`,
      };
    }
    const text = (v) => (typeof v === "string" ? v.trim().slice(0, 80) : "");
    const obj = (v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? JSON.parse(JSON.stringify(v))
        : null;
    return {
      ...t,
      displayName: text(edit.displayName) || t.componentName,
      settings: obj(edit.settings),
      providers: obj(edit.providers),
      // Showing what a bot sends (TD-009): the listener it must have, and
      // the widget's copy on its dashboard that gets it.
      wire: cleanWire(edit.wire),
      workspaceId:
        edit.workspaceId !== undefined && edit.workspaceId !== null
          ? String(edit.workspaceId)
          : null,
      itemId:
        edit.itemId !== undefined && edit.itemId !== null
          ? String(edit.itemId)
          : null,
    };
  },

  /**
   * A change's Builder or Checker (Phase 3): while it works, build_widget
   * is held to that widget (_editRun), and — as for a cell build — the
   * team installs or places nothing. One change builds at a time.
   */
  async _editAskRole(role, request, target, live = null) {
    if (this._editRun && this._editRun !== target) {
      return {
        status: "failed",
        error:
          "Another change to a widget is being built — try again when it's done.",
      };
    }
    this._editRun = target;
    this._cellRoleRuns = (this._cellRoleRuns || 0) + 1;
    try {
      return await this._planAskRole(role, request, null, live);
    } finally {
      this._cellRoleRuns -= 1;
      if (this._editRun === target) this._editRun = null;
    }
  },

  /**
   * The listener a change from the Bots diagram asked for (TD-009): the
   * bot's event → the widget's new handler, on its copy on the dashboard.
   * Saved like a plan's wiring (the dashboard reloads on workspace:saved);
   * adding one it already has changes nothing.
   */
  _wireEditedWidget(target) {
    const wire = target && target.wire;
    if (!wire || target.workspaceId == null || target.itemId == null) {
      return { error: "no widget on a dashboard to connect" };
    }
    const bot = this._store.get(wire.botId);
    if (!bot) return { error: `${wire.botName} isn't there any more` };
    const workspace = this._loadWorkspace(target.workspaceId);
    if (!workspace) return { error: "that dashboard wasn't found" };
    const next = addWidgetListener(
      workspace,
      target.itemId,
      wire.handlerName,
      botEventType(bot, wire.event),
    );
    if (!next) return { error: "that widget isn't on the dashboard any more" };
    return this._saveWorkspace(next);
  },

  /**
   * A change's Install step (Phase 3): the draft the Checker passed and the
   * user approved. In place on a package that isn't AI-built only when it's
   * the user's own — checked against who's signed in now.
   */
  async _planInstallEdit(draft, target) {
    if (!this._widgetTools || !this._widgetTools.installDraft) {
      return { success: false, error: "installing isn't available here" };
    }
    if (target.mode === "update" && !target.aiBuilt) {
      let profile = null;
      try {
        profile =
          await require("./registryAuthController").getRegistryProfile();
      } catch (_e) {
        profile = null;
      }
      if (
        // The package's own scope — never the component id it was opened by.
        !ownsWidget({
          pkg: target.package,
          component: null,
          username: profile && profile.username,
        })
      ) {
        return {
          success: false,
          error: `${target.componentName} isn't under your registry name, so it can't be changed in place — save the change as a new widget instead.`,
        };
      }
    }
    const res = await this._widgetTools.installDraft({
      name: draft,
      edit: target,
    });
    // Showing what a bot sends (TD-009): changed in place, the widget's copy
    // on its dashboard gets its listener now — whether or not Create is
    // still open. (A copy is wired by the editor once it's in its place.)
    if (
      res &&
      res.success !== false &&
      !res.error &&
      target.wire &&
      target.mode === "update"
    ) {
      const wired = this._wireEditedWidget(target);
      if (wired && wired.error) res.wireError = wired.error;
    }
    return res;
  },

  /** Providers were connected: the steps waiting for them run (AC5). */
  resumePlanBuild(buildId) {
    const { entry, error } = this._finishedBuild(buildId);
    if (error) return { error };
    if (!entry.build) return { error: "Continue building first." };
    if (!entry.state.steps.some((x) => x.status === "needs-provider")) {
      return { error: "Nothing is waiting." };
    }
    return this._continueBuild(entry.build.resume());
  },

  /**
   * Remove what was built (CRE-004 AC4): the dashboard, the bots saved for it
   * (and its lead), and the widgets the Builder made new for it. Registry
   * installs stay installed and updated widgets keep their changes.
   * A build on a dashboard the user had (5e-2b) never deletes it, its lead
   * or what its team knows: the widgets it placed come off, its bots go, and
   * the theme it replaced goes back.
   * → { removed: { dashboard, bots, widgets, from?, placed?, theme? },
   *     kept: { installs, updated } }
   */
  removePlanBuild(buildId) {
    const { entry, error } = this._finishedBuild(buildId);
    if (error) return { error };
    const built = (entry.state && entry.state.built) || {};
    const removed = { dashboard: null, bots: [], widgets: [] };
    const problems = [];
    const targeted = !!(built.dashboard && built.dashboard.targeted);

    const dashboardId = built.dashboard ? built.dashboard.id : null;
    const bots = (built.bots || []).slice();
    const lead =
      dashboardId && !targeted ? leadOf(this._store.list(), dashboardId) : null;
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

    // A theme the build changed gets its old colors back; a remix's
    // dashboards get the original back.
    if (built.changedTheme) {
      if (this._planRestoreTheme(built.changedTheme)) {
        removed.theme = built.changedTheme.name;
      } else {
        problems.push(
          built.changedTheme.remix
            ? `${built.changedTheme.name}: couldn't put the original back`
            : `${built.changedTheme.name}: couldn't put its old colors back`,
        );
      }
    }
    if (dashboardId && targeted) {
      this._undoOnDashboard(built, removed, problems);
    } else if (dashboardId) {
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
          // What Create told its team about it goes too (4e-1).
          this._memory.delete("workspace", dashboardId, "about");
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
    this._keepBuild(entry.recentId, buildId, entry.plan, entry.state);
    return { removed, kept, problems };
  },

  /**
   * Remove on a dashboard the user had (5e-2b): take the widgets the build
   * placed off it and put back the theme it replaced — only if the theme is
   * still the one the build applied — in one save.
   */
  _undoOnDashboard(built, removed, problems) {
    const name = built.dashboard.name;
    removed.from = name;
    const ws = this._loadWorkspace(built.dashboard.id);
    if (!ws) {
      problems.push(`${name}: it isn't there any more`);
      return;
    }
    const undo = undoOnDashboard(ws, built);
    if (!undo.changed) return;
    const saved = this._saveWorkspace(undo.workspace);
    if (saved && saved.error) {
      problems.push(`${name}: ${saved.error}`);
      return;
    }
    removed.placed = undo.placed;
    if (undo.theme !== null) removed.theme = undo.theme || "the app's theme";
  },

  /** A dashboard the user has, for a plan that adds to it (5e-2b). */
  _planUseDashboard(id) {
    const ws = this._loadWorkspace(id);
    if (!ws) {
      throw new Error(
        "that dashboard isn't there any more — it may have been deleted",
      );
    }
    return { id: ws.id, name: ws.name || ws.label || String(ws.id) };
  },

  /**
   * One of the user's saved themes (by name or id) on a dashboard, as the
   * Dash MCP's apply_theme does: themeKey (the theme's id) drives it, theme
   * kept for older readers.
   * → { key, name, previous, previousName } — previous: the id it had, or
   *   null for the app's theme.
   */
  _planApplyTheme({ dashboardId, theme }) {
    const themes = this._savedThemes();
    const hit = resolveTheme(themes, theme);
    if (hit.error) throw new Error(hit.error);
    const ws = this._loadWorkspace(dashboardId);
    if (!ws) throw new Error("the dashboard couldn't be read");
    const previous = ws.themeKey || null;
    const was = previous
      ? themeChoices(themes).find((c) => c.key === previous)
      : null;
    const saved = this._saveWorkspace({
      ...ws,
      themeKey: hit.key,
      theme: hit.key,
    });
    if (saved && saved.error) throw new Error(saved.error);
    return {
      key: hit.key,
      name: hit.name,
      previous,
      previousName: was ? was.name : previous,
    };
  },

  /**
   * A new theme from a plan (lead-workspace theme round): Dash's theme
   * generator turns its four colors into the full dark and light theme,
   * saved like the theme wizard saves one. The app reloads its themes.
   * `madeIn`: the conversation — a theme it made before (carrying on, a
   * changed plan, building again) is made again under the same key.
   */
  _planMakeTheme({ name, colors, madeIn = null }) {
    const want = String(name || "").trim();
    if (!want) throw new Error("the theme has no name");
    const c = colors || {};
    const saved = this._savedThemes();
    const same = Object.entries(saved).filter(
      ([, t]) => t && String(t.name || "").toLowerCase() === want.toLowerCase(),
    );
    const own =
      madeIn && same.length === 1 && same[0][1].madeIn === madeIn
        ? same[0][0]
        : null;
    if (same.length && !own) {
      throw new Error(`there's already a theme called "${want}"`);
    }
    const raw = generateCustomTheme(
      c.primary,
      c.secondary,
      c.tertiary,
      c.neutral,
    );
    const key = own || `theme-${Date.now()}`;
    const res = require("./themeController").saveThemeForApplication(
      this._getMainWindow(),
      this._appId,
      key,
      { ...raw, id: key, name: want, ...(madeIn ? { madeIn } : {}) },
    );
    if (!res || res.error || res.success === false) {
      throw new Error((res && res.message) || "the theme couldn't be saved");
    }
    this._broadcast("themes:changed", { key });
    return { key, name: want };
  },

  /**
   * A change to a saved theme from a plan (theme change round). The user's
   * own theme gets the new colors in place — its editor changes (font,
   * corners, single colors) stay, and so does everything that uses it. One
   * downloaded from the registry is never changed: the change is saved as a
   * remix that credits its author. `madeIn`: the conversation — carrying
   * on or building again there changes the same remix.
   * @returns {Promise<{ key, name, remix, previous?, of?, allowRemix?,
   *   published?, usedBy, editorKept }>}
   */
  async _planChangeTheme({ name, colors, madeIn = null }) {
    const saved = this._savedThemes();
    const hit = themeByName(saved, name);
    if (!hit) {
      throw new Error(`there's no saved theme called "${String(name || "")}"`);
    }
    const [key, raw] = hit;
    // Your own registry scope is yours, wherever it was installed.
    const username = this._registryUsername();
    const c = colors || {};
    const next = {
      primary: c.primary,
      secondary: c.secondary,
      tertiary: c.tertiary,
      neutral: c.neutral,
    };
    const save = (k, obj) => {
      const res = require("./themeController").saveThemeForApplication(
        this._getMainWindow(),
        this._appId,
        k,
        obj,
      );
      if (!res || res.error || res.success === false) {
        throw new Error((res && res.message) || "the theme couldn't be saved");
      }
    };
    const editorKept = hasEditorChanges(raw);
    const origin = themeOrigin(raw, { username });
    if (!origin) {
      // The user's own: in place, keeping its id, editor changes and
      // registry record (Publish the update follows).
      // Its colors before this conversation first changed it: building
      // again (carry on, a changed plan) keeps Remove's way back.
      const kept =
        madeIn && raw._planPrevious && raw._planPrevious.madeIn === madeIn
          ? raw._planPrevious.colors
          : null;
      const previous = {};
      for (const ch of Object.keys(next)) {
        previous[ch] = kept ? (kept[ch] ?? null) : (raw[ch] ?? null);
      }
      save(key, {
        ...raw,
        ...next,
        ...(madeIn ? { _planPrevious: { madeIn, colors: previous } } : {}),
      });
      this._broadcast("themes:changed", { key });
      const published = themePublished(raw, { username });
      return {
        key,
        name: raw.name,
        remix: false,
        previous,
        published: published
          ? {
              ...published,
              visibility: await this._packageVisibility(published.package),
            }
          : null,
        usedBy: this._themeUsage(key),
        editorKept,
      };
    }
    // Downloaded: a remix, credited (remixedFrom), never its registry record.
    const mine = Object.entries(saved).find(
      ([, t]) =>
        t &&
        madeIn &&
        t.madeIn === madeIn &&
        t.remixedFrom &&
        t.remixedFrom.package === origin.package,
    );
    const remixKey = mine ? mine[0] : `theme-${Date.now()}`;
    const remixTitle = mine
      ? mine[1].name
      : remixName(
          raw.name,
          Object.values(saved).map((t) => t && t.name),
        );
    const copy = { ...raw, ...next, id: remixKey, name: remixTitle };
    delete copy._registryMeta;
    delete copy.registryRef;
    delete copy.version;
    copy.remixedFrom = { package: origin.package, version: origin.version };
    if (madeIn) copy.madeIn = madeIn;
    save(remixKey, copy);
    this._broadcast("themes:changed", { key: remixKey });
    // The remix goes where the original was, on every dashboard using it
    // (frame 50); the app's theme is the user's to switch.
    const replaced = [];
    for (const ws of this._workspacesUsing(key)) {
      const res = this._saveWorkspace({
        ...ws,
        themeKey: remixKey,
        theme: remixKey,
      });
      if (!res || !res.error) {
        replaced.push({ id: String(ws.id), name: ws.name || String(ws.id) });
      }
    }
    // Remixes allowed? A package that's gone (or private now) isn't one
    // that can be remixed; unknown when the registry can't be asked.
    let allowRemix = null;
    try {
      const info = await require("../registry/registryPackages").getPackageInfo(
        origin.package,
        { authFailuresUnreachable: true },
      );
      if (info === null) allowRemix = false;
      else if (info && typeof info === "object")
        allowRemix = info.allowRemix !== false;
    } catch (_e) {
      // unknown: Publish your remix checks again
    }
    return {
      key: remixKey,
      name: remixTitle,
      remix: true,
      of: {
        key,
        name: raw.name,
        package: origin.package,
        author: origin.author,
      },
      allowRemix,
      replaced,
      appUsesOriginal: this._themeUsage(key).app,
      usedBy: this._themeUsage(remixKey),
      editorKept,
    };
  },

  /** The dashboards whose theme is `key`. */
  _workspacesUsing(key) {
    try {
      const res =
        require("./workspaceController").listWorkspacesForApplication(
          this._getMainWindow(),
          this._appId,
        ) || {};
      return (res.workspaces || []).filter((w) => w && w.themeKey === key);
    } catch (_e) {
      return [];
    }
  },

  /** The signed-in registry username, or null. */
  _registryUsername() {
    try {
      return require("./registryAuthController").getStoredUsername() || null;
    } catch (_e) {
      return null;
    }
  },

  /** Whether a package the user published is public or private (null:
   * the registry couldn't say). */
  async _packageVisibility(pkg) {
    try {
      const info = await require("../registry/registryPackages").getPackageInfo(
        pkg,
      );
      return info && typeof info === "object" ? info.visibility || null : null;
    } catch (_e) {
      return null;
    }
  },

  /** Where a theme shows: the app's theme, and the dashboards using it.
   * `all`: a _themeUsageAll() read once for many themes. */
  _themeUsage(key, all = null) {
    const u = all || this._themeUsageAll();
    return {
      app: !!u.appKey && u.appKey === key,
      dashboards: u.dashboards
        .filter((w) => w && w.themeKey === key)
        .map((w) => w.name || String(w.id)),
    };
  },

  /** The app's theme and every dashboard, read once. */
  _themeUsageAll() {
    let appKey = null;
    try {
      appKey =
        require("./settingsController").getSettingsForApplication(null)
          ?.settings?.theme || null;
    } catch (_e) {
      appKey = null;
    }
    let dashboards = [];
    try {
      const res =
        require("./workspaceController").listWorkspacesForApplication(
          this._getMainWindow(),
          this._appId,
        ) || {};
      dashboards = res.workspaces || [];
    } catch (_e) {
      dashboards = [];
    }
    return { appKey, dashboards };
  },

  /** Remove (theme change round): a theme changed in place gets its old
   * colors back — unless it was deleted since; a remix's dashboards get the
   * original back, where they still have the remix (the remix stays). */
  _planRestoreTheme(changed) {
    if (!changed || !changed.key) return false;
    if (changed.remix) {
      const original = changed.of && changed.of.key;
      if (!original) return false;
      let ok = true;
      for (const r of changed.replaced || []) {
        const ws = this._loadWorkspace(r.id);
        if (!ws || ws.themeKey !== changed.key) continue;
        const res = this._saveWorkspace({
          ...ws,
          themeKey: original,
          theme: original,
        });
        if (res && res.error) ok = false;
      }
      return ok;
    }
    if (!changed.previous) return false;
    const raw = this._savedThemes()[changed.key];
    if (!raw) return false;
    const back = { ...raw };
    delete back._planPrevious;
    for (const [ch, v] of Object.entries(changed.previous)) {
      if (v == null) delete back[ch];
      else back[ch] = v;
    }
    const res = require("./themeController").saveThemeForApplication(
      this._getMainWindow(),
      this._appId,
      changed.key,
      back,
    );
    if (!res || res.error || res.success === false) return false;
    this._broadcast("themes:changed", { key: changed.key });
    return true;
  },

  /**
   * list_themes (theme change round): each saved theme with its colors,
   * whose it is and where it shows — so the Planner can change one.
   */
  _themeDetails() {
    const saved = this._savedThemes();
    const all = this._themeUsageAll();
    const username = this._registryUsername();
    const seen = new Set();
    const out = [];
    for (const [key, raw] of Object.entries(saved)) {
      const name = raw && String(raw.name || "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const origin = themeOrigin(raw, { username });
      out.push({
        name,
        colors: themeColors(raw),
        by: origin ? origin.author || origin.package : null,
        usedBy: this._themeUsage(key, all),
      });
    }
    return out;
  },

  /** themes.json: the user's saved themes by id. */
  _savedThemes() {
    try {
      const listed = require("./themeController").listThemesForApplication(
        this._getMainWindow(),
        this._appId,
      );
      return (listed && !listed.error && listed.themes) || {};
    } catch (_e) {
      return {};
    }
  },

  /**
   * The user's saved theme names, once each (list_themes) — without the
   * ones conversation `madeIn` made (theme round).
   */
  _themeNames(madeIn = null) {
    const saved = this._savedThemes();
    const mine = madeIn
      ? Object.fromEntries(
          Object.entries(saved).filter(([, t]) => !t || t.madeIn !== madeIn),
        )
      : saved;
    return themeChoices(mine)
      .map((c) => c.name)
      .filter((n, i, all) => all.indexOf(n) === i);
  },

  /** A registry widget, installed for a plan build → its component id. */
  async _planInstallWidget(pkgName, piece) {
    const pkg = await require("./registryController").getPackage(pkgName);
    if (!pkg) throw new Error(`${pkgName} isn't in the registry`);
    if (!pkg.downloadUrl) throw new Error(`${pkgName} can't be downloaded`);
    const registry = require("../widgetRegistry").getWidgetRegistry();
    // Kept under its scoped id ("@trops/clock"), like the Widgets page's
    // install — and as it's read back after a restart.
    const installAs = pkg.scope ? `@${pkg.scope}/${pkg.name}` : pkg.name;
    const config = await registry.downloadWidget(installAs, pkg.downloadUrl);
    this._broadcast("widget:installed", { widgetName: installAs, config });
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
  _planCreateDashboard(name, count, pages = []) {
    const ws = blankDashboard({ id: Date.now(), name, count, pages });
    const saved = this._saveWorkspace(ws);
    if (saved && saved.error) throw new Error(saved.error);
    return { id: ws.id, name: ws.name };
  },

  /**
   * A plan's settings change (lead-workspace release 6c): sets them on that
   * one copy of the widget (its page, or the pinned sidebar), on its
   * dashboard as saved — only settings the widget has, and only plain
   * values (text, a number, on/off). Nothing is changed when its settings
   * can't be read. Throws when the widget isn't there or nothing can be set.
   * @returns {{ dashboard: { id, name }, changed: string[], dropped: string[] }}
   */
  async _planSetWidgetSettings({
    workspaceId,
    itemId,
    pageId = null,
    scope = "main",
    component,
    settings = {},
  }) {
    const ws = this._loadWorkspace(workspaceId);
    if (!ws) throw new Error("That dashboard isn't there any more.");
    const wanted =
      settings && typeof settings === "object" && !Array.isArray(settings)
        ? settings
        : {};
    let keys = null;
    const parts = String(component || "").split(".");
    if (parts.length >= 3) {
      try {
        const src = await require("../widgetRegistry").readWidgetSources({
          widgetName: `@${parts[0]}/${parts[1]}`,
          componentName: component,
        });
        keys = src && src.success ? settingKeys(src.configCode) : null;
      } catch (_e) {
        keys = null;
      }
    }
    if (!keys) {
      throw new Error("Its settings couldn't be read, so nothing was changed.");
    }
    const plain = (v) =>
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v)) ||
      (typeof v === "string" && v.length <= 2000);
    const changed = [];
    const dropped = [];
    const prefs = {};
    for (const [key, value] of Object.entries(wanted)) {
      if (!keys.includes(key) || !plain(value)) dropped.push(key);
      else {
        prefs[key] = value;
        changed.push(key);
      }
    }
    if (!changed.length) {
      throw new Error(
        dropped.length
          ? `It has no setting it can take for ${dropped.join(", ")}.`
          : "There were no settings to change.",
      );
    }
    const next = setItemPrefs(ws, { itemId, component, pageId, scope }, prefs);
    if (!next) {
      throw new Error("That widget isn't on the dashboard any more.");
    }
    const saved = this._saveWorkspace(next);
    if (saved && saved.error) throw new Error(saved.error);
    return {
      dashboard: { id: String(ws.id), name: ws.name || ws.label || "" },
      changed,
      dropped,
    };
  },

  /**
   * Place one of a plan's widgets (CRE-004): a full component id (an
   * install's) as it is, otherwise the package with the component or the
   * piece's name to pick one — on its planned page and cell, with the connection and
   * settings the user chose. What it couldn't use (a connection they don't
   * have, a setting the widget doesn't have) comes back as `dropped`.
   */
  async _planPlaceWidget({
    dashboardId,
    component,
    widget,
    name,
    page = null,
    row = null,
    col = null,
    provider = null,
    providers = null,
    settings = null,
  }) {
    const full = !!component && String(component).split(".").length >= 3;
    const resolved = resolveWidgetComponent(
      full ? component : widget,
      full ? null : component || null,
      () => require("../widgetRegistry").getWidgetRegistry().getWidgets(),
      { name },
    );
    if (resolved.error) throw new Error(resolved.error);
    let choices = { selectedProviders: {}, userPrefs: {}, dropped: [] };
    if (provider || settings || (providers && providers.length)) {
      let keys = null;
      if (settings) {
        const parts = resolved.component.split(".");
        const src = await require("../widgetRegistry").readWidgetSources({
          widgetName: `@${parts[0]}/${parts[1]}`,
          componentName: resolved.component,
        });
        keys = src && src.success ? settingKeys(src.configCode) : null;
      }
      let connections = [];
      try {
        ({ providers: connections = [] } =
          this._providers.listProviders(this._getMainWindow(), this._appId) ||
          {});
      } catch (_e) {
        connections = [];
      }
      choices = placeChoices(
        { provider, providers, settings },
        { connections, settingKeys: keys },
      );
    }
    const res = this._teamPlaceWidget({
      dashboard: dashboardId,
      widget: resolved.component,
      page: page || undefined,
      row,
      col,
      settings: choices.userPrefs,
      selectedProviders: choices.selectedProviders,
    });
    if (res && res.error) throw new Error(res.error);
    return { ...res, dropped: choices.dropped };
  },

  /** The bots already on a dashboard (none for an Unassigned bot). */
  _planBotTeam(dashboardId) {
    if (dashboardId == null) return [];
    return this._store
      .list()
      .filter((b) => String(b.workspaceId) === String(dashboardId));
  },

  /**
   * A bot build's Check step (Phase 2c-1): the bot as it will be saved,
   * through the save's own check — nothing is saved. A provider that isn't
   * connected throws waitingFor (the step waits for it).
   */
  _planCheckBot({ dashboardId, piece }) {
    const definition = planBotDefinition(piece, {
      dashboardId,
      sources: this.listToolSources(dashboardId),
      team: this._planBotTeam(dashboardId),
    });
    const { errors } = checkBot(definition, this._botCheckContext(null));
    if (errors.length) throw new Error(errors.join(" "));
    const said = [];
    if ((definition.mcpServers || []).length) {
      said.push(`${definition.mcpServers.join(", ")} connected`);
    }
    if (Object.keys(definition.toolSelections || {}).length) {
      said.push("tools exist");
    }
    if ((definition.schedules || []).length) said.push("schedule is valid");
    return { detail: said.join(" · ") || "Nothing to connect" };
  },

  /**
   * A plan's new bot, saved on the build's dashboard exactly as planned
   * (team-dashboards TD-008): checked like a draft (only the user's
   * providers and tools, a valid schedule, valid result names), with its
   * providers and tools taken as chosen. A provider that isn't connected
   * fails the step instead of saving a bot that can't work.
   */
  _planSaveBot({ dashboardId, piece, botId = null, sample = null }) {
    const definition = this._planBotDefinition({ dashboardId, piece });
    // An edited plan's changed bot is saved over the one built before
    // (4d-3); its triggers stay.
    const existing = botId ? this._store.get(botId) : null;
    const saved = this.save({
      ...(existing
        ? {
            ...definition,
            id: existing.id,
            subscriptions: existing.subscriptions || [],
          }
        : definition),
      // Its test, before it was saved (TST-003): kept as its sample.
      ...(sample ? { sample } : {}),
    });
    return { id: saved.id, name: saved.name };
  },

  /** A plan's bot, exactly as _planSaveBot saves it: what the user tests. */
  _planBotDefinition({ dashboardId, piece }) {
    return planBotDefinition(piece, {
      dashboardId,
      sources: this.listToolSources(dashboardId),
      team: this._planBotTeam(dashboardId),
    });
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
  // live.onEvent: the role's run as it goes — the Build log shows what it's
  // doing (DASH-20).
  async _planAskRole(role, request, planId = null, live = null) {
    const bot = dashTeamBot(this._store.list(), role);
    if (!bot) return { skipped: true, reason: `the ${role} isn't set up` };
    this._takeBuilds(bot.id);
    // The user pressed Build: a paused role still does its part.
    const record = await this._reviewedRun(bot, request, () =>
      this._asUserRun(bot.id, () =>
        this._run(bot.id, {
          prompt: planId ? `${request}\n\n${MEMORY_NOTE}` : request,
          trigger: "ask",
          via: "plan-build",
          approvalPolicy: "allow",
          ...(live && typeof live.onEvent === "function"
            ? { onEvent: live.onEvent }
            : {}),
          // The plan's build memory (4e-1).
          ...(planId ? { planId: String(planId) } : {}),
        }),
      ),
    );
    // What build_widget said during the run — the build step trusts it over
    // the Builder's answer (Create build fixes).
    if (record && typeof record === "object") {
      record.builds = this._takeBuilds(bot.id);
    }
    return record;
  },

  /**
   * A Dash team run; the Checker's verdict on a draft it checked is recorded
   * on that draft — only a PASSED draft can be installed (Phase 1b).
   */
  _reviewedRun(bot, request, run) {
    return bot &&
      bot.role === "checker" &&
      this._widgetTools &&
      this._widgetTools.reviewRun
      ? this._widgetTools.reviewRun(request, run)
      : run();
  },

  /** Note a Dash team build_widget result for the run in progress. */
  _noteBuild(botId, result) {
    if (!this._buildNotes) this._buildNotes = new Map();
    const list = this._buildNotes.get(botId) || [];
    // The draft it wrote (draft:<Name>) and its package — checked, then
    // installed.
    list.push(buildNoteOf(result));
    this._buildNotes.set(botId, list.slice(-10));
  },

  /** The build_widget results noted for a bot, cleared. */
  _takeBuilds(botId) {
    if (!this._buildNotes) return [];
    const list = this._buildNotes.get(botId) || [];
    this._buildNotes.delete(botId);
    return list;
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
      // search_library's bots (Phase 2c-1): the user's own — not the Dash
      // team or leads — with the dashboard each is on.
      listBots: () => {
        const names = new Map(
          this._dashboardsWithBots().map((d) => [d.id, d.name]),
        );
        return this._store
          .list()
          .filter((b) => !isDashTeam(b) && !isLead(b))
          .map((b) => ({
            id: b.id,
            name: b.name,
            instructions: b.instructions || "",
            dashboard:
              b.workspaceId != null
                ? names.get(String(b.workspaceId)) || null
                : null,
            providers: b.mcpServers || [],
          }));
      },
      // …and the bots in public registry dashboard packages.
      registryBots: async () => {
        const { fetchRegistryIndex } = require("./registryController");
        return registryBotsOf(await fetchRegistryIndex());
      },
      readWidget: ({ name, component }) => {
        // A draft (draft:<Name>, not installed yet): the Builder reads its
        // own code before fixing it.
        const tools = this._widgetTools;
        if (String(name || "").startsWith("draft:")) {
          const r = tools && tools.draftCode ? tools.draftCode({ name }) : null;
          return r && r.success
            ? {
                success: true,
                componentName: String(name).slice("draft:".length),
                componentCode: r.componentCode,
                configCode: r.configCode,
                files: [],
              }
            : {
                success: false,
                error: `${name} hasn't been written yet — write it with build_widget.`,
              };
        }
        return require("../widgetRegistry").readWidgetSources({
          widgetName: name,
          componentName: component,
        });
      },
      // One of its package's other files (Phase 3).
      readWidgetFile: ({ name, file }) =>
        require("../widgetRegistry").readWidgetFile({
          widgetName: name,
          file,
        }),
      providerTools: () => this._providerToolsWithFlags(),
      askRole: (req) => this._askRole(req),
      ...(this._widgetTools
        ? {
            // With the user's providers' live tools — what each takes,
            // and a file provider's folders — so calls are written right.
            widgetGuide: async (req) =>
              this._widgetTools.guide({
                ...req,
                live: await this._liveToolsFor((req && req.providers) || [], {
                  folders: true,
                }).catch(() => ({})),
              }),
            // During a change (Phase 3) the build is held to its widget.
            buildWidget: async (req) => {
              const { role, ...rest } = req || {};
              const res = await this._widgetTools.build({
                ...rest,
                provider: this._providerPick(req.provider),
                edit: this._editRun || null,
              });
              // While a plan's Builder builds a widget chosen step by
              // step: what doesn't match the user's choices yet, as advice
              // (held to your choices) — the build's check is what decides.
              const hold = role === "builder" ? this._builderHold : null;
              if (!hold || !res || !res.success) return res;
              let off = [];
              try {
                off = hold.fn({
                  componentCode: rest.componentCode,
                  configCode: rest.configCode,
                });
              } catch (_e) {
                off = [];
              }
              return Array.isArray(off) && off.length
                ? { ...res, choiceProblems: off }
                : res;
            },
            // A change that shows what a bot sends must have its listener.
            checkWidget: async (req) =>
              withWireProblems(
                await this._widgetTools.check(req),
                this._editRun ? this._editRun.wire : null,
              ),
          }
        : {}),
      compareConfigs,
      listDashboards: () => this._dashboardsWithBots(),
      listThemes: () => this._themeDetails(),
      botResults: () => this._botResultsForTeam(),
      botRuns: () => this._botRunsForTeam(),
      botAnswers: (req) => this._botAnswersForTeam(req),
      // Not during a cell build (Phase 2b): the editor places that widget,
      // and a save here would overwrite the user's unsaved edits.
      placeWidget: (req) =>
        this._cellBuildRunning()
          ? {
              error:
                "Don't place it: the user previews this widget first — then it's installed, or the editor puts it in their cell.",
            }
          : this._teamPlaceWidget(req),
      // place_widget with a draft the Checker passed (Phase 1b).
      ...(this._widgetTools && this._widgetTools.installDraft
        ? {
            installDraft: (req) =>
              // Nothing is installed before the user's preview (Phase 2b).
              this._cellBuildRunning()
                ? {
                    success: false,
                    error:
                      "Don't install it: the user previews this widget first — finish with the draft's name.",
                  }
                : this._widgetTools.installDraft(req),
          }
        : {}),
    };
  },

  /** Dashboard id → name, for the results and runs the Planner reads. */
  _dashboardNames() {
    const names = new Map();
    for (const d of this._dashboardsWithBots()) names.set(d.id, d.name);
    return names;
  },

  /**
   * The latest result each of the user's bots sent (bot_results, CRE-011
   * AC6). The Dash team's own bots are left out.
   */
  _botResultsForTeam() {
    const names = this._dashboardNames();
    const out = [];
    for (const bot of this._store.list()) {
      if (isDashTeam(bot)) continue;
      for (const decl of bot.publishes || []) {
        if (!decl || !decl.name) continue;
        let r = null;
        try {
          r = this._store.getResult(bot.id, decl.name);
        } catch (_e) {
          r = null;
        }
        if (!r) continue;
        out.push({
          botName: bot.name || bot.id,
          dashboard: names.get(String(bot.workspaceId)) || null,
          name: decl.name,
          label: r.label || decl.label || decl.name,
          summary: r.summary,
          items: r.items,
          sentAt: r.sentAt || null,
        });
      }
    }
    return out;
  },

  /** Recent runs of the user's bots, newest first (bot_runs). */
  _botRunsForTeam() {
    const names = this._dashboardNames();
    return recentRuns({
      bots: this._store.list().filter((b) => !isDashTeam(b)),
      getRuns: (id) => this._store.getRuns(id),
      limit: 50,
    }).map((r) => ({
      ...r,
      dashboard: r.workspaceId ? names.get(r.workspaceId) || null : null,
    }));
  },

  /**
   * One of the user's bots' last finished answers, whole (bot_answers,
   * TD-009): what a widget listening for its `completed` event receives.
   * Found by id, else by name; the Dash team's own bots are left out.
   */
  _botAnswersForTeam({ bot, count } = {}) {
    const q = String(bot || "").trim();
    if (!q) return { error: "bot_answers needs the bot's name or id." };
    const bots = this._store.list().filter((b) => !isDashTeam(b));
    const lower = q.toLowerCase();
    const found =
      bots.find((b) => b.id === q) ||
      bots.find((b) => String(b.name || "").toLowerCase() === lower) ||
      bots.filter((b) =>
        String(b.name || "")
          .toLowerCase()
          .includes(lower),
      );
    const match = Array.isArray(found) ? null : found;
    if (!match) {
      const some = Array.isArray(found) ? found : [];
      if (some.length > 1) {
        return {
          error: `More than one bot matches "${q}": ${some
            .map((b) => `${b.name} (id ${b.id})`)
            .join(", ")}. Give its id.`,
        };
      }
      if (some.length === 1)
        return this._botAnswersForTeam({ bot: some[0].id, count });
      return {
        error: `No bot named "${q}". list_dashboards shows the bots on each dashboard.`,
      };
    }
    let runs = [];
    try {
      runs = this._store.getRuns(match.id) || [];
    } catch (_e) {
      runs = [];
    }
    return {
      text: describeAnswers(match.name || match.id, lastAnswers(runs, count)),
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
    const themeNames = new Map(
      themeChoices(this._savedThemes()).map((c) => [c.key, c.name]),
    );
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
      theme: ws.themeKey ? themeNames.get(ws.themeKey) || ws.themeKey : null,
    }));
  },

  /**
   * place_widget: put an installed widget on a dashboard — the shown page or
   * a named one, the next free cell or a given one — then save and refresh
   * open windows (CRE-011, scenarios G4).
   */
  _teamPlaceWidget({
    dashboard,
    widget,
    component,
    name = null,
    page,
    row,
    col,
    settings,
    selectedProviders,
  }) {
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
    const resolved = resolveWidgetComponent(
      widget,
      component,
      () => require("../widgetRegistry").getWidgetRegistry().getWidgets(),
      { name },
    );
    if (resolved.error) return resolved;
    const ws = this._loadWorkspace(hit.id);
    if (!ws) return { error: "That dashboard couldn't be read." };
    let placed;
    try {
      placed = placeWidget(ws, {
        component: resolved.component,
        userPrefs: settings || {},
        selectedProviders,
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
      pageId: placed.pageId,
      cell: placed.cell,
      widgetId: placed.widgetId,
    };
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
   * The user's first provider of each of these types, started if it isn't
   * running (at most LIVE_TOOLS_WAIT_MS), with its live tools (name,
   * description, inputSchema) — what a widget calling it must send. With
   * { folders: true } (the Builder's guide) a file provider also says which
   * folders it can use. → { [type]: { provider, tools, notes } }; a type
   * with no running provider is left out.
   */
  async _liveToolsFor(types = [], { folders = false } = {}) {
    const want = new Set((Array.isArray(types) ? types : []).map(String));
    if (!want.size || !this._mcp || !this._providers) return {};
    const win = this._getMainWindow();
    let all = [];
    try {
      ({ providers: all = [] } =
        this._providers.listProviders(win, this._appId) || {});
    } catch (_e) {
      all = [];
    }
    // The first of each type — the one a widget of that type gets.
    const mine = [];
    for (const p of all || []) {
      if (!p || !p.name || p.providerClass !== "mcp" || !want.has(p.type)) {
        continue;
      }
      if (!mine.some((m) => m.type === p.type)) mine.push(p);
    }
    if (!mine.length) return {};
    if (this._mcp.startServer) {
      const started = ensureBotServers({
        bot: { mcpServers: mine.map((p) => p.name) },
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
      }).catch(() => null);
      // A slow start doesn't hold up the Builder or the Checker.
      await Promise.race([
        started,
        new Promise((r) => {
          const t = setTimeout(r, LIVE_TOOLS_WAIT_MS);
          if (t && t.unref) t.unref();
        }),
      ]);
    }
    const connected = this._connectedServers();
    const out = {};
    for (const p of mine) {
      if (out[p.type]) continue; // the first of its type
      const live =
        connected.find((c) => c.serverName === p.name && !c.workspaceId) ||
        connected.find((c) => c.serverName === p.name);
      if (!live || !Array.isArray(live.tools) || !live.tools.length) continue;
      const entry = {
        provider: p.name,
        tools: live.tools.map((t) => ({
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || null,
          // Its read-only flag, when the server gives one (held to choices).
          ...(t.annotations ? { annotations: t.annotations } : {}),
        })),
        notes: [],
      };
      if (
        folders &&
        this._mcp.callTool &&
        live.tools.some((t) => t.name === "list_allowed_directories")
      ) {
        try {
          const res = await this._mcp.callTool(
            win,
            p.name,
            "list_allowed_directories",
            {},
            null,
            null,
            live.workspaceId || null,
          );
          const text = ((res && res.result && res.result.content) || [])
            .map((c) => (c && c.type === "text" ? c.text : ""))
            .join(" ")
            .trim();
          if (text) {
            entry.notes.push(
              `Folders ${p.name} can use (every path must be inside one): ${text}`,
            );
          }
        } catch (_e) {
          // Not known; the Checker still checks the calls.
        }
      }
      out[p.type] = entry;
    }
    return out;
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
      .filter(
        (p) =>
          p &&
          p.name &&
          p.providerClass !== "mcp" &&
          p.providerClass !== CONNECTOR_CLASS,
      )
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
    // While the user is still planning nothing gets built or placed: the
    // asked role answers, with its read tools only. Building happens when
    // the user presses Build (the plan build, which is their consent) — so
    // a hand-off never waits on an approval nobody can see.
    const start = () =>
      this._run(target.id, {
        prompt: `${request}\n\n(Answer only: you can't build, install or place anything here. That happens when the user presses Build on the plan.)`,
        trigger: "ask",
        via: `dash-team:${(caller && caller.role) || "planner"}`,
        adviseOnly: true,
      });
    // For the user's own request, a paused role still answers.
    const record = await this._reviewedRun(target, request, () =>
      this._inUserRun(callerId) ? this._asUserRun(target.id, start) : start(),
    );
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
    // The whole answer (DASH-36): the stored run keeps only its last 8 KB,
    // and a plan cut at the front can't be read or shown.
    const answer = record.wholeAnswer || record.output || "(no answer)";
    // A plan that still can't be read: said plainly, so no one claims a
    // plan or a build that isn't there.
    const lost = planLost(answer)
      ? `\n\n(The ${target.name}'s plan came through incomplete, so the app can't show it or build from it. Tell the user so plainly: don't say a plan is shown or a build is starting. They can ask again from the card in the conversation.)`
      : "";
    return {
      text: `${target.name}: ${answer}${lost}`,
      isError: false,
    };
  },

  /**
   * team_ask_bot (lead-workspace release 1): a lead runs one of its own
   * bots with the user's request and gets the answer back. The bot does its
   * job as usual — its own tools, approvals, pause and budget all apply —
   * and its run is marked as asked by the lead (`via: lead:<id>`). Counted
   * with the lead's other hand-offs for the run. A run that's still going
   * after the wait (usually waiting on an approval) is reported as pending;
   * it finishes on its own and shows in the bot's activity.
   */
  async _leadAskBot(lead, member, request) {
    const asked = Date.now();
    const result = await this._leadAskBotRun(lead, member, request);
    // A bot with checks (bot-checks PRD): its answer reaches the lead only
    // once it passes. Within the ask's wait, the lead gets the checked
    // answer; otherwise where it is (being checked, waiting for the user).
    const job = result && result.checks && result.checks.goalId;
    if (!job) return result;
    const left = Math.max(0, LEAD_ASK_WAIT_MS - (Date.now() - asked));
    const outcome = await this._checkJobs.waitFor(job, left);
    return { ...result, checks: { ...result.checks, ...outcome } };
  },

  async _leadAskBotRun(lead, member, request) {
    const runKey = this._runner.startedAt(lead.id) || "idle";
    if (!this._leadAsked) this._leadAsked = new Map();
    const info = leadRunInfo(this._runVia ? this._runVia.get(lead.id) : null);
    const leadGoal = this._runGoals ? this._runGoals.get(lead.id) : null;
    // The lead's job: the bot it asks joins it (DASH-28).
    const leadEntry = this._runVia ? this._runVia.get(lead.id) : null;
    const jobId = (leadEntry && leadEntry.jobId) || null;
    const result = await askTeamBot({
      lead,
      member,
      request,
      // Who started the lead's run (its `via` — an outside caller can't
      // run its bots) and the conversation it's in.
      ...info,
      // The goal the lead is working on: the bot's run is recorded under it.
      goal: leadGoal && leadGoal.goalId ? leadGoal : null,
      takeHandoff: () => this._handoffs.take(lead.id, runKey),
      // For the user's own request, the bot's run is theirs too.
      run: (opts) => {
        // Already running in this job (a hand-on started it): the lead
        // waits for that run's answer instead of hearing "busy" (DASH-28).
        const going =
          this._runsInProgress && this._runsInProgress.get(member.id);
        if (jobId && going && going.jobId === jobId) return going.promise;
        const withJob = jobId ? { ...opts, jobId } : opts;
        return this._inUserRun(lead.id)
          ? this._asUserRun(member.id, () => this._run(member.id, withJob))
          : this._run(member.id, withJob);
      },
      // Stopping the lead stops the bots it's waiting on (stop()).
      track: (p) => {
        const asked = this._leadAsked.get(lead.id) || new Set();
        asked.add(member.id);
        this._leadAsked.set(lead.id, asked);
        p.catch(() => {}).finally(() => asked.delete(member.id));
      },
    });
    // Doing a task via MCP, a bot that didn't run (paused, over budget…)
    // leaves the task needing the user (TEAM-016). The lead's own limits
    // ("you've asked…") aren't the user's to fix.
    const note =
      /^mcp-task(:|$)/.test(info.leadVia || "") && result && result.skipped
        ? taskNoteFor(member.name, result.reason)
        : null;
    if (note) {
      if (!this._taskNotes) this._taskNotes = new Map();
      const notes = this._taskNotes.get(lead.id) || [];
      notes.push(note);
      this._taskNotes.set(lead.id, notes);
    }
    return result;
  },

  /**
   * team_ask_dash_team (lead-workspace release 3c): a dashboard's lead
   * brings in the Dash team — the Planner or the Scout answers, as it does
   * for the Dash Lead (_askRole: answer only, counted with the lead's other
   * hand-offs). The lead's dashboard goes with the request, so a plan goes
   * on it. Stopping the lead stops the role too.
   */
  async _leadAskDashTeam(lead, role, request) {
    const target = dashTeamBot(this._store.list(), role);
    const id = lead && lead.workspaceId != null ? String(lead.workspaceId) : "";
    const dashboard = id
      ? this._dashboardsWithBots().find((d) => d.id === id) || null
      : null;
    const where = dashboard
      ? `(From the ${JSON.stringify(dashboard.name)} dashboard's team lead. This is for that dashboard — id ${JSON.stringify(dashboard.id)}. A plan for it changes it: set "dashboard": ${JSON.stringify({ id: dashboard.id, name: dashboard.name })} in the plan; new widgets go in its next free cells.)`
      : "";
    // Stopping the lead stops the role — only a run it really started (a
    // busy role isn't asked; _askRole says so).
    if (!this._leadAsked) this._leadAsked = new Map();
    const asked = this._leadAsked.get(lead.id) || new Set();
    const tracked =
      !!target && !this._runner.isRunning(target.id) && !asked.has(target.id);
    if (tracked) {
      asked.add(target.id);
      this._leadAsked.set(lead.id, asked);
    }
    try {
      const res = await this._askRole({
        callerId: lead.id,
        role,
        request: where ? `${request}\n\n${where}` : request,
      });
      // The plan goes on the lead's dashboard even if the Planner left it out.
      return role === "planner" && dashboard && res && !res.isError
        ? { ...res, text: withPlanDashboard(res.text, dashboard) }
        : res;
    } finally {
      if (tracked) asked.delete(target.id);
    }
  },

  /** The token of the bot's GitHub provider, or null (DASH-55). Never logged. */
  async _gitTokenFor(bot) {
    if (!this._providers || !this._providers.getProvider) return null;
    try {
      const win = this._getMainWindow();
      return await gitTokenFor({
        bot,
        getProvider: async (name) =>
          this._providers.getProvider(win, this._appId, name),
      });
    } catch (_e) {
      return null;
    }
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
  async _resolveTools(bot, runOpts = {}) {
    // Asked only to answer from its prompt (a task routed via MCP before any
    // passphrase, TEAM-016): no tools at all.
    if (runOpts && runOpts.noTools) {
      this._allowedByBot.set(bot.id, {});
      return { tools: [], resolveServer: () => null };
    }
    // A team lead gets ONLY its read-only team tools — no providers, no memory
    // writes (bot-teams TEAM-002 AC4) — plus, on a dashboard, the goal tools
    // that start and follow goals (goals-ledger GOAL-002). The runner also
    // strips engine built-ins.
    if (isLead(bot)) {
      const toolServer = {};
      for (const tool of TEAM_TOOLS) toolServer[tool.name] = TEAM_SERVER;
      const goalTools =
        bot.workspaceId != null && bot.workspaceId !== ""
          ? LEAD_GOAL_TOOLS
          : [];
      for (const tool of goalTools) toolServer[tool.name] = GOALS_SERVER;
      this._allowedByBot.set(bot.id, {});
      return {
        tools: [...TEAM_TOOLS, ...goalTools],
        resolveServer: (toolName) => toolServer[toolName] || null,
      };
    }
    // A Dash team role gets only its role's tools (CRE-011) — no providers,
    // no memory; the runner limits engine built-ins by role.
    if (isDashTeam(bot)) {
      // Inside a Create plan, its memory too — that plan's bucket only (4e-1).
      const memory = runOpts && runOpts.planId ? MEMORY_TOOLS : [];
      // Asked by the Planner while the user plans: no tools that change
      // things (build_widget, place_widget).
      const roleTools = roleToolsFor(bot.role).filter(
        (t) =>
          !(runOpts && runOpts.adviseOnly) ||
          serverForTool(t.name) !== ROLE_BUILD_SERVER,
      );
      const tools = [...roleTools, ...memory];
      this._allowedByBot.set(bot.id, {});
      return {
        tools,
        resolveServer: (toolName) =>
          memory.some((t) => t.name === toolName)
            ? MEMORY_SERVER
            : tools.some((t) => t.name === toolName)
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
        this._runWarning(bot, runOpts, {
          type: "warning",
          // Short; the server's own error is the detail (shown under it).
          message: `${f.serverName} couldn't start, so its tools aren't available this run.`,
          provider: f.serverName,
          detail: f.message,
        });
      }
    }
    const gitToken = await this._gitTokenFor(bot);
    // Each provider's declared tools (Settings → Providers) are the ceiling;
    // the bot's toolSelections narrow within them.
    const { tools, toolServer, allowedFor } = resolveBotTools({
      bot,
      connected: this._connectedServers(),
      providerLimits: this._providerToolLimits(),
    });
    // Claude connectors from the user's Claude account: the bot's Claude
    // Code run reaches them itself; Dash says which and gates each call.
    const linked = await this._resolveConnectors(bot, runOpts);
    Object.assign(toolServer, linked.toolServer);
    // Remembered per bot so _callTool can hard-enforce the same whitelist.
    this._allowedByBot.set(bot.id, { ...allowedFor, ...linked.allowedFor });
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
    // The dashboard's goals ledger, for a bot on a dashboard (goals-ledger
    // PRD). A bot on no dashboard has no ledger, and a test (bot-test-run)
    // doesn't work on the dashboard's jobs.
    if (
      bot.workspaceId != null &&
      bot.workspaceId !== "" &&
      !(runOpts && runOpts.test)
    ) {
      for (const tool of GOAL_TOOLS) {
        tools.push(tool);
        toolServer[tool.name] = GOALS_SERVER;
      }
    }
    return {
      tools,
      resolveServer: (toolName) => toolServer[toolName] || null,
      connectors: linked.connectors,
      connectorServers: linked.connectorServers,
      readOnlyTools: linked.readOnly,
      notes: gitToken
        ? [...(linked.notes || []), GIT_SIGNED_IN_NOTE]
        : linked.notes || [],
      // Its GitHub provider's token signs its git and gh in (DASH-55).
      gitToken,
    };
  },

  /**
   * A finished run's issues (issues PRD): a failure and each warning are
   * recorded; a run that finished cleanly resolves the bot's open ones.
   * Skipped, stopped and interrupted runs change nothing.
   */
  _recordRunIssues(bot, record) {
    if (!bot || !record || record.skipped || isDashTeam(bot)) return;
    try {
      let toolErrors = [];
      try {
        toolErrors = record.toolErrors ? JSON.parse(record.toolErrors) : [];
      } catch (_e) {
        toolErrors = [];
      }
      const toolCalls = (record.toolCalls || []).map((c, i) => {
        const e = toolErrors.find((x) => x && x.call === i);
        return e ? { ...c, args: e.args, error: e.error } : c;
      });
      const inputs = botRunIssues({ bot, run: { ...record, toolCalls } });
      const asset = { kind: "bot", botId: bot.id };
      // A completed run clears an earlier failure; a clean one, warnings too.
      if (record.status === "completed") {
        issueController.resolveAsset(
          asset,
          inputs.length ? { severity: "problem" } : {},
        );
      }
      for (const input of inputs) issueController.record(input);
      // A provider a call reached this run (and didn't fail to sign in to)
      // signs in fine: its sign-in issues, from any bot, are resolved.
      const failedSignIn = new Set(
        inputs
          .filter((x) => x.cause === "sign-in" && x.call)
          .map((x) => x.call.provider),
      );
      const worked = new Set(
        toolCalls
          .filter((c) => c && c.ok === true && c.provider)
          .map((c) => c.provider),
      );
      for (const provider of worked) {
        if (!failedSignIn.has(provider) && issueController.resolveSignIn) {
          issueController.resolveSignIn(provider);
        }
      }
    } catch (_e) {
      // Issues are a convenience: never a reason a run fails.
    }
  },

  /**
   * A warning during a run: through the run's own events, so it's kept on
   * the run (issues PRD) as well as shown — or straight to the window when
   * there's no run.
   */
  _runWarning(bot, runOpts, event) {
    if (runOpts && typeof runOpts.emit === "function") {
      runOpts.emit(event);
      return;
    }
    this._broadcast(BOT_STREAM, { botId: bot.id, event });
  },

  /**
   * The bot's granted Claude connectors for one run (resolveBotConnectors),
   * with every connector in the account so the run can hide the rest. Reads
   * the account's list when the bot has any and it's older than 10 minutes.
   */
  async _resolveConnectors(bot, runOpts = {}) {
    const none = {
      connectors: [],
      connectorServers: [],
      toolServer: {},
      readOnly: [],
      allowedFor: {},
    };
    let providers = [];
    try {
      const win = this._getMainWindow();
      ({ providers = [] } =
        this._providers.listProviders(win, this._appId) || {});
    } catch (_e) {
      return none;
    }
    const wanted = new Set(bot.mcpServers || []);
    const givenUp = this._givenUp || new Map();
    const notes = [];
    const granted = providers.filter((p) => {
      if (!p || p.providerClass !== CONNECTOR_CLASS || !wanted.has(p.name)) {
        return false;
      }
      const server = p.mcpConfig && p.mcpConfig.server;
      const g = server ? givenUp.get(server) : null;
      if (!g) return true;
      const at = new Date(g.retryAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      this._runWarning(bot, runOpts, {
        type: "warning",
        message: `${p.name} was left out of this run: it can't connect or sign in right now, and Dash has stopped trying until ${at}. Its answer can't include ${p.name}.`,
        provider: p.name,
      });
      notes.push(
        `${p.name} isn't available this run (it can't connect or sign in right now). Don't try to use it; say in your answer that ${p.name} was left out, and answer from what you can reach.`,
      );
      return false;
    });
    if (!granted.length) return { ...none, notes };
    let listed = null;
    try {
      listed = await this._claudeConnectors().list({
        maxAgeMs: 10 * 60 * 1000,
      });
    } catch (_e) {
      listed = null;
    }
    // Not read (Claude Code missing, not signed in, no answer): the run
    // can't tell which connectors to allow or hide, so it doesn't start.
    if (!listed || listed.state !== "ready") {
      const names = granted.map((p) => p.name).join(", ");
      throw new Error(
        `${names} couldn't be used: ${
          (listed && listed.message) ||
          "Dash couldn't read your Claude connectors."
        } Check Providers › ${granted[0].name}.`,
      );
    }
    const all = listed.connectors || [];
    const resolved = resolveBotConnectors({
      bot,
      providers: granted,
      connectors: all,
    });
    for (const name of resolved.missing) {
      this._runWarning(bot, runOpts, {
        type: "warning",
        message: `${name} isn't connected in your Claude account right now, so its tools may not be available this run. Check it on claude.ai › Settings › Connectors.`,
        provider: name,
      });
    }
    return {
      ...resolved,
      connectorServers: all.map((c) => c.server),
      notes,
    };
  },

  async _callTool(serverName, toolName, args, opts = {}) {
    // In-process memory tools bypass MCP; scoped to the calling bot's workspace.
    if (serverName === MEMORY_SERVER) {
      // A test reads memory but changes none: team memory is shared, and a
      // test hands nothing on (bot-test-run).
      if (
        this._testing(opts.botId) &&
        (toolName === "memory_set" || toolName === "memory_delete")
      ) {
        return {
          text: "This is a test, so memory isn't changed. Carry on without saving it.",
          isError: false,
        };
      }
      return handleMemoryTool(
        this._memory,
        {
          workspaceId: opts.workspaceId,
          botId: opts.botId,
          planId: opts.planId || null,
        },
        toolName,
        args,
      );
    }
    if (serverName === GOALS_SERVER) {
      if (this._testing(opts.botId)) {
        return {
          text: "A test doesn't work on the dashboard's jobs.",
          isError: true,
        };
      }
      if (
        isLead(this._store.get(opts.botId)) &&
        !LEAD_GOAL_TOOLS.some((t) => t.name === toolName)
      ) {
        return {
          text: "A team lead starts goals and hands their tasks to the team; the team's bots claim them.",
          isError: true,
        };
      }
      return handleGoalTool(
        goalController.store(),
        {
          workspaceId: opts.workspaceId,
          botId: opts.botId,
          botName: opts.botName || null,
          conversationId: opts.conversationId || null,
          goal: opts.goal || null,
        },
        toolName,
        args,
      );
    }
    if (serverName === RESULTS_SERVER) {
      // A test's results are kept for the form, never saved or sent.
      const testing = this._testing(opts.botId);
      if (testing) return this._keepTestResult(testing, args);
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
          // Asked for the user's own request, a paused bot still runs.
          isPaused: (id) =>
            this._pause.isPaused(id) &&
            (!this._inUserRun(caller.id) || this._pause.isGloballyPaused()),
          findProviders: (teamCtx, capability) =>
            this._findProviders(teamCtx, capability),
          listProviders: () => this.listToolSources(caller.workspaceId),
          askBot: (_teamCtx, member, request) =>
            this._leadAskBot(caller, member, request),
          askDashTeam: (_teamCtx, role, request) =>
            this._leadAskDashTeam(caller, role, request),
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
      const result = await handleRoleTool(
        this._roleToolDeps(),
        { botId: caller.id, role: caller.role },
        toolName,
        args,
      );
      if (toolName === "build_widget") this._noteBuild(caller.id, result);
      return result;
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
    // A test hands nothing on.
    if (opts.botId && !this._testing(opts.botId)) {
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
        if (
          p &&
          (p.providerClass === "mcp" || p.providerClass === CONNECTOR_CLASS) &&
          p.name
        ) {
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
