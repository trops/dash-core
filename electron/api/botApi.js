/**
 * botApi.js
 *
 * Preload bridge for Bot Factory operations: bot CRUD, run control, approvals,
 * and subscription to streamed run/approval events. Mirrors the invoke +
 * event-listener pattern used by llmApi.
 */
const { ipcRenderer } = require("electron");
const {
  BOTS_LIST,
  BOTS_GET,
  BOTS_SAVE,
  BOTS_DELETE,
  BOTS_RUN,
  BOTS_STOP,
  BOTS_APPROVE,
  BOTS_LIST_APPROVALS,
  BOTS_GET_BUDGETS,
  BOTS_SET_BUDGET,
  BOTS_GET_SPEND,
  BOTS_RESUME_BUDGET,
  BOTS_BUDGET_STATUS,
  BOTS_SPENDING_SUMMARY,
  BOTS_AUDIT_LOG,
  BOTS_TAKE_OPEN_REQUEST,
  BOTS_LIST_RUNNING,
  BOTS_PAUSE_ALL,
  BOTS_RESUME_ALL,
  BOTS_PAUSE_BOT,
  BOTS_RESUME_BOT,
  BOTS_GET_PAUSE_STATE,
  BOTS_LIST_TOOL_SOURCES,
  BOTS_GET_GRANTS,
  BOTS_REVOKE_GRANT,
  BOTS_ENSURE_LEAD,
  BOTS_SET_LEAD_ENABLED,
  BOTS_GET_TEAM_SETTINGS,
  BOTS_DISMISS_LEAD_INTRO,
  BOTS_GET_SETTINGS,
  BOTS_LIST_DASH_TEAM,
  BOTS_START_PLAN_BUILD,
  BOTS_STOP_PLAN_BUILD,
  BOTS_GET_PLAN_BUILD,
  BOTS_FIX_PLAN_BUILD,
  BOTS_RETRY_PLAN_BUILD,
  BOTS_RESUME_PLAN_BUILD,
  BOTS_REMOVE_PLAN_BUILD,
  CREATE_RECENT_LIST,
  CREATE_RECENT_GET,
  CREATE_RECENT_SAVE,
  CREATE_RECENT_REMOVE,
  CREATE_RECENT_CHANGED,
  BOTS_SET_SETTINGS,
  BOTS_ASK_LEAD,
  BOTS_LIST_LEADS,
  BOTS_GET_RUNS,
  BOTS_GET_LATEST_RESULT,
  BOTS_LIST_RECENT_RUNS,
  BOTS_LAST_RUNS,
  BOTS_LIST_DRAFTS,
  BOTS_DISMISS_DRAFT,
  BOTS_EXPORT_TEAM,
  BOTS_PREVIEW_TEAM_IMPORT,
  BOTS_INSTALL_TEAM,
  BOTS_PREVIEW_PUBLISH,
  BOTS_PUBLISH,
  BOTS_SEARCH_REGISTRY,
  BOTS_PREVIEW_REGISTRY_INSTALL,
  BOTS_INSTALL_FROM_REGISTRY,
  BOTS_ADD_WIDGET,
  BOTS_BIND_WIDGET,
  BOT_STREAM,
  BOT_APPROVAL_PENDING,
  BOT_APPROVALS_CHANGED,
  BOT_BUDGET_ALERT,
  BOT_RUN_ACTIVE,
  BOT_LIST_CHANGED,
  BOT_OPEN_REQUEST,
  BOT_DRAFTS_CHANGED,
  BOT_PLAN_BUILD_PROGRESS,
} = require("../events/botEvents");

let _nextListenerId = 0;
const _listenerMap = new Map();

function _addListener(channel, callback) {
  const id = String(++_nextListenerId);
  const wrapped = (_event, data) => callback(data);
  ipcRenderer.on(channel, wrapped);
  _listenerMap.set(id, { channel, wrapped });
  return id;
}

const botApi = {
  list: () => ipcRenderer.invoke(BOTS_LIST),
  get: (botId) => ipcRenderer.invoke(BOTS_GET, { botId }),
  save: (definition) => ipcRenderer.invoke(BOTS_SAVE, { definition }),
  delete: (botId) => ipcRenderer.invoke(BOTS_DELETE, { botId }),

  /** Start a run. Stream events arrive via onStream(). */
  /** Start a run; `continueConversation` replies within its last session. */
  run: (botId, prompt, continueConversation = false, opts = {}) =>
    ipcRenderer.invoke(BOTS_RUN, {
      botId,
      prompt,
      continueConversation,
      // A Dash team run inside a Create plan: that plan's memory (4e-1).
      planId: (opts && opts.planId) || null,
    }),
  /** The bot's latest runs (oldest first), answers decrypted. */
  getRuns: (botId, limit) =>
    ipcRenderer.invoke(BOTS_GET_RUNS, { botId, limit }),
  /** The latest result a bot sent, by its result event type (TD-002). */
  getLatestResult: (eventType) =>
    ipcRenderer.invoke(BOTS_GET_LATEST_RESULT, { eventType }),
  stop: (botId) => ipcRenderer.invoke(BOTS_STOP, { botId }),
  /** Bots a team lead drafted for this dashboard, awaiting review (TEAM-005). */
  listDrafts: (workspaceId) =>
    ipcRenderer.invoke(BOTS_LIST_DRAFTS, { workspaceId }),
  /** Remove a draft (discarded, or saved as a real bot). */
  dismissDraft: (draftId) =>
    ipcRenderer.invoke(BOTS_DISMISS_DRAFT, { draftId }),
  /** Save this dashboard's team as a .team.json (TEAM-006). meta: { name, description } */
  exportTeam: (workspaceId, meta) =>
    ipcRenderer.invoke(BOTS_EXPORT_TEAM, { workspaceId, meta }),
  /** Pick and check a .team.json; returns { manifest, plan } for review (TEAM-007). */
  previewTeamImport: (workspaceId) =>
    ipcRenderer.invoke(BOTS_PREVIEW_TEAM_IMPORT, { workspaceId }),
  /** Install a reviewed team into this dashboard (new, paused bots); roles = the bots picked (all when omitted). */
  installTeam: (workspaceId, manifest, choices, roles) =>
    ipcRenderer.invoke(BOTS_INSTALL_TEAM, {
      workspaceId,
      manifest,
      choices,
      roles,
    }),
  /** Bot and team packages in the registry: opts { query, type: "bot"|"bot-team"|null }. */
  searchRegistry: (opts) => ipcRenderer.invoke(BOTS_SEARCH_REGISTRY, opts),
  /** Download + verify + check a registry package; returns { previewId, manifest, plan, source }. */
  previewRegistryInstall: (workspaceId, packageRef) =>
    ipcRenderer.invoke(BOTS_PREVIEW_REGISTRY_INSTALL, {
      workspaceId,
      packageRef,
    }),
  /** Install a previewed registry package (from the main process's checked copy). */
  installFromRegistry: (workspaceId, previewId, choices, roles) =>
    ipcRenderer.invoke(BOTS_INSTALL_FROM_REGISTRY, {
      workspaceId,
      previewId,
      choices,
      roles,
    }),
  /**
   * What publishing would send (TEAM-006): opts { kind: "team"|"bot",
   * workspaceId?, botId?, name? } → { pkg, notIncluded, suggested, signedIn }.
   */
  previewPublish: (opts) => ipcRenderer.invoke(BOTS_PREVIEW_PUBLISH, opts),
  /** Publish a bot or team to the registry: opts + meta { displayName, name, version, description, visibility }. */
  publish: (opts) => ipcRenderer.invoke(BOTS_PUBLISH, opts),
  /** Show a bot (or the team's activity) on the dashboard: opts { kind: "results"|"activity", botId? }. */
  addBotWidget: (workspaceId, opts) =>
    ipcRenderer.invoke(BOTS_ADD_WIDGET, { workspaceId, ...(opts || {}) }),
  /** Link a Bot results widget to a bot on its dashboard's team. */
  bindBotWidget: (workspaceId, widgetId, botId) =>
    ipcRenderer.invoke(BOTS_BIND_WIDGET, { workspaceId, widgetId, botId }),
  /** The latest runs across every bot, newest first (the Bot monitor). */
  listRecentRuns: (limit) =>
    ipcRenderer.invoke(BOTS_LIST_RECENT_RUNS, { limit }),
  /** Each bot's latest run, by bot id (the Bots dock's contacts). */
  lastRuns: () => ipcRenderer.invoke(BOTS_LAST_RUNS),

  /** Resolve a pending approval. decision: { allow, reason? } */
  approve: (approvalId, decision) =>
    ipcRenderer.invoke(BOTS_APPROVE, { approvalId, decision }),
  listApprovals: () => ipcRenderer.invoke(BOTS_LIST_APPROVALS),

  // --- Budgets (US-019) ---
  getBudgets: () => ipcRenderer.invoke(BOTS_GET_BUDGETS),
  /** scope: "bot"|"workspace"|"global" */
  setBudget: (scope, id, monthlyUsd) =>
    ipcRenderer.invoke(BOTS_SET_BUDGET, { scope, id, monthlyUsd }),
  getSpend: (month) => ipcRenderer.invoke(BOTS_GET_SPEND, { month }),
  resumeBudget: (botId) => ipcRenderer.invoke(BOTS_RESUME_BUDGET, { botId }),
  /** Every bot's budget picture: { [botId]: { overall, over, limit, spent } }. */
  budgetStatus: () => ipcRenderer.invoke(BOTS_BUDGET_STATUS),
  /** This month's spending: { month, overall, bots, dashboards, providers }. */
  spendingSummary: () => ipcRenderer.invoke(BOTS_SPENDING_SUMMARY),
  /** The audit log, newest first: { botIds?, kinds?, before?, limit? } →
   *  { entries, more }. */
  auditLog: (filters) => ipcRenderer.invoke(BOTS_AUDIT_LOG, filters || {}),
  /** The bot a notification click asked to open ({ botId } or null), once. */
  takeOpenRequest: () => ipcRenderer.invoke(BOTS_TAKE_OPEN_REQUEST),

  // --- Background / pause (US-014, US-018) ---
  listRunning: () => ipcRenderer.invoke(BOTS_LIST_RUNNING),
  pauseAll: () => ipcRenderer.invoke(BOTS_PAUSE_ALL),
  resumeAll: () => ipcRenderer.invoke(BOTS_RESUME_ALL),
  pauseBot: (botId) => ipcRenderer.invoke(BOTS_PAUSE_BOT, { botId }),
  resumeBot: (botId) => ipcRenderer.invoke(BOTS_RESUME_BOT, { botId }),
  getPauseState: () => ipcRenderer.invoke(BOTS_GET_PAUSE_STATE),

  /** The user's Dash MCP providers a bot can use: [{ name, type, running, toolCount }]. */
  listToolSources: (workspaceId = null) =>
    ipcRenderer.invoke(BOTS_LIST_TOOL_SOURCES, { workspaceId }),

  /** Remembered approvals ("Always allow"): { [provider]: { tools, folders } }. */
  getGrants: (botId) => ipcRenderer.invoke(BOTS_GET_GRANTS, { botId }),
  /** Revoke one remembered tool approval; resolves to the updated summary. */
  revokeGrant: (botId, serverName, toolName) =>
    ipcRenderer.invoke(BOTS_REVOKE_GRANT, { botId, serverName, toolName }),

  // ---- Team leads (bot-teams TEAM-002 / TEAM-003) ----
  /** Make sure a dashboard has its idle lead. → { lead, created, reason? } */
  ensureLead: (workspaceId, dashboardName) =>
    ipcRenderer.invoke(BOTS_ENSURE_LEAD, { workspaceId, dashboardName }),
  /** Turn a dashboard's lead off (removes it) or back on. */
  setLeadEnabled: (workspaceId, enabled, dashboardName) =>
    ipcRenderer.invoke(BOTS_SET_LEAD_ENABLED, {
      workspaceId,
      enabled,
      dashboardName,
    }),
  /** { leadEnabled, introDismissed? } for a dashboard. */
  getTeamSettings: (workspaceId) =>
    ipcRenderer.invoke(BOTS_GET_TEAM_SETTINGS, { workspaceId }),
  dismissLeadIntro: (workspaceId) =>
    ipcRenderer.invoke(BOTS_DISMISS_LEAD_INTRO, { workspaceId }),
  /**
   * The Dash team's role bots (CRE-011), in role order, each with its
   * summary, tier, recommended model and pause state. Not in list().
   */
  listDashTeam: () => ipcRenderer.invoke(BOTS_LIST_DASH_TEAM),
  /** Build an approved plan (CRE-004): resolves to { buildId, state }. */
  startPlanBuild: (plan, opts = {}) =>
    ipcRenderer.invoke(BOTS_START_PLAN_BUILD, { plan, opts }),
  stopPlanBuild: (buildId) =>
    ipcRenderer.invoke(BOTS_STOP_PLAN_BUILD, { buildId }),
  getPlanBuild: (buildId) =>
    ipcRenderer.invoke(BOTS_GET_PLAN_BUILD, { buildId }),
  /** Let Builder fix it (4d-3): resolves at once; progress on onPlanBuild. */
  fixPlanBuild: (buildId, stepId) =>
    ipcRenderer.invoke(BOTS_FIX_PLAN_BUILD, { buildId, stepId }),
  /** Try a failed Dash step again. */
  retryPlanBuild: (buildId, stepId) =>
    ipcRenderer.invoke(BOTS_RETRY_PLAN_BUILD, { buildId, stepId }),
  /** Run the steps that waited for a provider (now connected). */
  resumePlanBuild: (buildId) =>
    ipcRenderer.invoke(BOTS_RESUME_PLAN_BUILD, { buildId }),
  /** Remove what the build made: { removed, kept } or { error }. */
  /** Create's Recent (4e-1): summaries, newest first. */
  listCreateRecent: () => ipcRenderer.invoke(CREATE_RECENT_LIST),
  /** One conversation, whole — to reopen it. */
  getCreateRecent: (id) => ipcRenderer.invoke(CREATE_RECENT_GET, { id }),
  /** Save a conversation as it goes: { id?, prompt?, conversation? } → { id }. */
  saveCreateRecent: (entry) =>
    ipcRenderer.invoke(CREATE_RECENT_SAVE, { entry }),
  removeCreateRecent: (id) => ipcRenderer.invoke(CREATE_RECENT_REMOVE, { id }),
  removePlanBuild: (buildId) =>
    ipcRenderer.invoke(BOTS_REMOVE_PLAN_BUILD, { buildId }),
  /** Global bot settings: { autoLeads, dashTeam: { models } }. */
  getSettings: () => ipcRenderer.invoke(BOTS_GET_SETTINGS),
  setSettings: (patch) => ipcRenderer.invoke(BOTS_SET_SETTINGS, { patch }),
  /**
   * Ask a lead; `continueConversation` resumes its session for follow-ups.
   * Streams on onStream; resolves to the run record (answer in `output`).
   */
  askLead: (botId, question, continueConversation = false, via = null) =>
    ipcRenderer.invoke(BOTS_ASK_LEAD, {
      botId,
      question,
      continueConversation,
      via,
    }),
  /**
   * Team leads by dashboard for the AI Assistant's "To:" picker (TEAM-013):
   * [{ botId, leadName, dashboardId, dashboardName, dashboardLabel,
   *    running, paused, overBudget }].
   */
  listLeads: () => ipcRenderer.invoke(BOTS_LIST_LEADS),

  /** Subscribe to streamed run events: { botId, event }. */
  onStream: (callback) => _addListener(BOT_STREAM, callback),
  /** Subscribe to new pending approvals: { id, request }. */
  onApprovalPending: (callback) => _addListener(BOT_APPROVAL_PENDING, callback),
  /** callback({ approvals }) — the full pending list after any change. */
  onApprovalsChanged: (callback) =>
    _addListener(BOT_APPROVALS_CHANGED, callback),
  /** Subscribe to budget warn/exceeded alerts. */
  onBudgetAlert: (callback) => _addListener(BOT_BUDGET_ALERT, callback),
  /** Subscribe to active-run count changes: { count, running }. */
  onRunActive: (callback) => _addListener(BOT_RUN_ACTIVE, callback),
  /** A bot was created, edited or deleted anywhere — refresh lists. */
  onListChanged: (callback) => _addListener(BOT_LIST_CHANGED, callback),
  /** A notification asked to open a bot — call takeOpenRequest(). */
  onOpenRequest: (callback) => _addListener(BOT_OPEN_REQUEST, callback),
  /** A lead drafted a bot, or a draft was saved/discarded. */
  onDraftsChanged: (callback) => _addListener(BOT_DRAFTS_CHANGED, callback),
  /** A plan build's progress: ({ buildId, state }) after every change. */
  onPlanBuild: (callback) => _addListener(BOT_PLAN_BUILD_PROGRESS, callback),
  /** Recent changed (a save, a build's progress, a removal). */
  onCreateRecent: (callback) => _addListener(CREATE_RECENT_CHANGED, callback),

  removeListener: (id) => {
    const entry = _listenerMap.get(id);
    if (!entry) return false;
    ipcRenderer.removeListener(entry.channel, entry.wrapped);
    _listenerMap.delete(id);
    return true;
  },
};

module.exports = botApi;
