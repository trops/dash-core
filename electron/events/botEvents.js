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

// --- Main → Renderer (send) ---
const BOT_STREAM = "bot-stream"; // { botId, event: BotEvent }
const BOT_APPROVAL_PENDING = "bot-approval-pending"; // { id, request }
const BOT_BUDGET_ALERT = "bot-budget-alert"; // { botId, cost, estimated, status }
const BOT_RUN_ACTIVE = "bot-run-active"; // { count, running: string[] }

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
  BOT_STREAM,
  BOT_APPROVAL_PENDING,
  BOT_BUDGET_ALERT,
  BOT_RUN_ACTIVE,
};
