/**
 * Event Constants File - Bot Factory Events
 *
 * IPC channels for the Bot Factory: bot CRUD, run control, approvals, and the
 * streamed run/approval events pushed back to the renderer.
 */

// --- Renderer → Main (invoke) ---
const BOTS_LIST = "bots-list";
const BOTS_GET = "bots-get";
const BOTS_SAVE = "bots-save";
const BOTS_DELETE = "bots-delete";
const BOTS_RUN = "bots-run";
const BOTS_STOP = "bots-stop";
const BOTS_APPROVE = "bots-approve";
const BOTS_LIST_APPROVALS = "bots-list-approvals";
const BOTS_GET_BUDGETS = "bots-get-budgets";
const BOTS_SET_BUDGET = "bots-set-budget";
const BOTS_GET_SPEND = "bots-get-spend";
const BOTS_RESUME_BUDGET = "bots-resume-budget";
// Every bot's budget picture (US-019, the Bots dock).
const BOTS_BUDGET_STATUS = "bots-budget-status";
// This month's spending by bot, dashboard, provider and overall (US-019).
const BOTS_SPENDING_SUMMARY = "bots-spending-summary";
// The saved audit log, newest first (US-003 AC5, US-014 AC9, US-019 AC6).
const BOTS_AUDIT_LOG = "bots-audit-log";
// The bot a notification click asked to open, taken once (US-018 AC5).
const BOTS_TAKE_OPEN_REQUEST = "bots-take-open-request";
const BOTS_LIST_RUNNING = "bots-list-running";
const BOTS_PAUSE_ALL = "bots-pause-all";
const BOTS_RESUME_ALL = "bots-resume-all";
const BOTS_PAUSE_BOT = "bots-pause-bot";
const BOTS_RESUME_BOT = "bots-resume-bot";
const BOTS_GET_PAUSE_STATE = "bots-get-pause-state";
const BOTS_LIST_TOOL_SOURCES = "bots-list-tool-sources";
const BOTS_GET_GRANTS = "bots-get-grants";
const BOTS_REVOKE_GRANT = "bots-revoke-grant";
// Team leads (bot-teams TEAM-002 / TEAM-003).
const BOTS_ENSURE_LEAD = "bots-ensure-lead";
const BOTS_SET_LEAD_ENABLED = "bots-set-lead-enabled";
const BOTS_GET_TEAM_SETTINGS = "bots-get-team-settings";
const BOTS_DISMISS_LEAD_INTRO = "bots-dismiss-lead-intro";
const BOTS_GET_SETTINGS = "bots-get-settings";
const BOTS_SET_SETTINGS = "bots-set-settings";
const BOTS_ASK_LEAD = "bots-ask-lead";
// AI Assistant recipient picker (TEAM-013): team leads by dashboard.
const BOTS_LIST_LEADS = "bots-list-leads";
// The Dash team (create-entry CRE-011): its four role bots for the Bots page.
const BOTS_LIST_DASH_TEAM = "bots-list-dash-team";
// Building an approved plan (create-entry CRE-004, phase 4d).
const BOTS_START_PLAN_BUILD = "bots-start-plan-build";
const BOTS_STOP_PLAN_BUILD = "bots-stop-plan-build";
const BOTS_GET_PLAN_BUILD = "bots-get-plan-build";
// After a build (4d-3): fix / retry a failed step, resume what waited for a
// provider, remove what was built.
const BOTS_FIX_PLAN_BUILD = "bots-fix-plan-build";
const BOTS_RETRY_PLAN_BUILD = "bots-retry-plan-build";
const BOTS_RESUME_PLAN_BUILD = "bots-resume-plan-build";
// A cell build's preview (consolidation Phase 2b): Looks good / Change something.
const BOTS_APPROVE_PLAN_STEP = "bots-approve-plan-step";
const BOTS_REVISE_PLAN_STEP = "bots-revise-plan-step";
const BOTS_REMOVE_PLAN_BUILD = "bots-remove-plan-build";
// Create's Recent (4e-1): plan conversations and their builds.
const CREATE_RECENT_LIST = "create-recent-list";
const CREATE_RECENT_GET = "create-recent-get";
const CREATE_RECENT_SAVE = "create-recent-save";
const CREATE_RECENT_REMOVE = "create-recent-remove";
const CREATE_RECENT_CHANGED = "create-recent-changed";
// Bots view (TEAM-011): a bot run history.
const BOTS_GET_RUNS = "bots-get-runs";
// Bot monitor (TEAM-011 B3): the latest runs across every bot.
const BOTS_LIST_RECENT_RUNS = "bots-list-recent-runs";
// Each bot's latest run — the Bots dock's contacts list (TEAM-015).
const BOTS_LAST_RUNS = "bots-last-runs";
// Team dashboards (TD-002): the latest result a bot sent, for late widgets.
const BOTS_GET_LATEST_RESULT = "bots-get-latest-result";
// Lead drafts (TEAM-005): bots a team lead proposed, awaiting review.
const BOTS_LIST_DRAFTS = "bots-list-drafts";
const BOTS_DISMISS_DRAFT = "bots-dismiss-draft";
// Team export/import (TEAM-006/007, slice 1): a dashboard's team as .team.json.
const BOTS_EXPORT_TEAM = "bots-export-team";
const BOTS_PREVIEW_TEAM_IMPORT = "bots-preview-team-import";
const BOTS_INSTALL_TEAM = "bots-install-team";
// Registry publish (TEAM-006 slice 3a): a bot or a team, to the Dash registry.
const BOTS_PREVIEW_PUBLISH = "bots-preview-publish";
const BOTS_PUBLISH = "bots-publish";
// Registry install (TEAM-007 slice 3b): find, preview, install bots and teams.
const BOTS_SEARCH_REGISTRY = "bots-search-registry";
const BOTS_PREVIEW_REGISTRY_INSTALL = "bots-preview-registry-install";
const BOTS_INSTALL_FROM_REGISTRY = "bots-install-from-registry";
// Bot widgets on the dashboard (TEAM-012): add one, or link one to a bot.
const BOTS_ADD_WIDGET = "bots-add-widget";
const BOTS_BIND_WIDGET = "bots-bind-widget";

// --- Main → Renderer (send) ---
const BOT_STREAM = "bot-stream"; // { botId, event: BotEvent }
const BOT_APPROVAL_PENDING = "bot-approval-pending"; // { id, request }
// The whole pending list, after any change (created, answered, denied, timed
// out) — windows replace their copy, so answered approvals disappear
// everywhere. { approvals: [{ id, request, createdAt }] }
const BOT_APPROVALS_CHANGED = "bot-approvals-changed";
const BOT_BUDGET_ALERT = "bot-budget-alert"; // { botId, cost, estimated, status }
const BOT_RUN_ACTIVE = "bot-run-active"; // { count, running: string[] }
// A bot was created, edited or deleted (anywhere) — refresh team lists.
const BOT_LIST_CHANGED = "bot-list-changed"; // {}
// A notification was clicked: open its bot — take it with takeOpenRequest.
const BOT_OPEN_REQUEST = "bot-open-request"; // {}
// A lead drafted a bot, or a draft was saved/discarded.
const BOT_DRAFTS_CHANGED = "bot-drafts-changed"; // {}
const BOT_PLAN_BUILD_PROGRESS = "bot-plan-build-progress"; // { buildId, state }

module.exports = {
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
  BOTS_SET_SETTINGS,
  BOTS_ASK_LEAD,
  BOTS_LIST_LEADS,
  BOTS_LIST_DASH_TEAM,
  BOTS_START_PLAN_BUILD,
  BOTS_STOP_PLAN_BUILD,
  BOTS_GET_PLAN_BUILD,
  BOTS_FIX_PLAN_BUILD,
  BOTS_RETRY_PLAN_BUILD,
  BOTS_RESUME_PLAN_BUILD,
  BOTS_APPROVE_PLAN_STEP,
  BOTS_REVISE_PLAN_STEP,
  BOTS_REMOVE_PLAN_BUILD,
  CREATE_RECENT_LIST,
  CREATE_RECENT_GET,
  CREATE_RECENT_SAVE,
  CREATE_RECENT_REMOVE,
  CREATE_RECENT_CHANGED,
  BOTS_GET_RUNS,
  BOTS_LIST_RECENT_RUNS,
  BOTS_LAST_RUNS,
  BOTS_GET_LATEST_RESULT,
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
};
