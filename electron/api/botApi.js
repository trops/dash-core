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
  BOTS_SET_SETTINGS,
  BOTS_ASK_LEAD,
  BOTS_GET_RUNS,
  BOT_STREAM,
  BOT_APPROVAL_PENDING,
  BOT_BUDGET_ALERT,
  BOT_RUN_ACTIVE,
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
  run: (botId, prompt, continueConversation = false) =>
    ipcRenderer.invoke(BOTS_RUN, { botId, prompt, continueConversation }),
  /** The bot's latest runs (oldest first), answers decrypted. */
  getRuns: (botId, limit) =>
    ipcRenderer.invoke(BOTS_GET_RUNS, { botId, limit }),
  stop: (botId) => ipcRenderer.invoke(BOTS_STOP, { botId }),

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
  /** Global bot settings: { autoLeads }. */
  getSettings: () => ipcRenderer.invoke(BOTS_GET_SETTINGS),
  setSettings: (patch) => ipcRenderer.invoke(BOTS_SET_SETTINGS, { patch }),
  /**
   * Ask a lead; `continueConversation` resumes its session for follow-ups.
   * Streams on onStream; resolves to the run record (answer in `output`).
   */
  askLead: (botId, question, continueConversation = false) =>
    ipcRenderer.invoke(BOTS_ASK_LEAD, {
      botId,
      question,
      continueConversation,
    }),

  /** Subscribe to streamed run events: { botId, event }. */
  onStream: (callback) => _addListener(BOT_STREAM, callback),
  /** Subscribe to new pending approvals: { id, request }. */
  onApprovalPending: (callback) => _addListener(BOT_APPROVAL_PENDING, callback),
  /** Subscribe to budget warn/exceeded alerts. */
  onBudgetAlert: (callback) => _addListener(BOT_BUDGET_ALERT, callback),
  /** Subscribe to active-run count changes: { count, running }. */
  onRunActive: (callback) => _addListener(BOT_RUN_ACTIVE, callback),

  removeListener: (id) => {
    const entry = _listenerMap.get(id);
    if (!entry) return false;
    ipcRenderer.removeListener(entry.channel, entry.wrapped);
    _listenerMap.delete(id);
    return true;
  },
};

module.exports = botApi;
