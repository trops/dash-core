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

// --- Main → Renderer (send) ---
const BOT_STREAM = "bot-stream"; // { botId, event: BotEvent }
const BOT_APPROVAL_PENDING = "bot-approval-pending"; // { id, request }

module.exports = {
  BOTS_LIST,
  BOTS_GET,
  BOTS_SAVE,
  BOTS_DELETE,
  BOTS_RUN,
  BOTS_STOP,
  BOTS_APPROVE,
  BOTS_LIST_APPROVALS,
  BOT_STREAM,
  BOT_APPROVAL_PENDING,
};
