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
// Bots view (TEAM-011): a bot run history.
const BOTS_GET_RUNS = "bots-get-runs";
// Bot monitor (TEAM-011 B3): the latest runs across every bot.
const BOTS_LIST_RECENT_RUNS = "bots-list-recent-runs";
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

// --- Main → Renderer (send) ---
const BOT_STREAM = "bot-stream"; // { botId, event: BotEvent }
const BOT_APPROVAL_PENDING = "bot-approval-pending"; // { id, request }
const BOT_BUDGET_ALERT = "bot-budget-alert"; // { botId, cost, estimated, status }
const BOT_RUN_ACTIVE = "bot-run-active"; // { count, running: string[] }
// A bot was created, edited or deleted (anywhere) — refresh team lists.
const BOT_LIST_CHANGED = "bot-list-changed"; // {}
// A lead drafted a bot, or a draft was saved/discarded.
const BOT_DRAFTS_CHANGED = "bot-drafts-changed"; // {}

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
  BOTS_LIST_RECENT_RUNS,
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
  BOT_STREAM,
  BOT_APPROVAL_PENDING,
  BOT_BUDGET_ALERT,
  BOT_RUN_ACTIVE,
  BOT_LIST_CHANGED,
  BOT_DRAFTS_CHANGED,
};
