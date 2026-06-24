/**
 * Event Constants File - LLM Events
 *
 * This file contains event constants for LLM (Large Language Model)
 * chat IPC communication — streaming, tool-use, and lifecycle.
 */

// --- Renderer → Main (invoke) ---
const LLM_SEND_MESSAGE = "llm-send-message";
const LLM_ABORT_REQUEST = "llm-abort-request";
const LLM_LIST_CONNECTED_TOOLS = "llm-list-connected-tools";
const LLM_CHECK_CLI_AVAILABLE = "llm-check-cli-available";
const LLM_CLEAR_CLI_SESSION = "llm-clear-cli-session";
const LLM_CLI_SESSION_STATUS = "llm-cli-session-status";
const LLM_CLI_END_SESSION = "llm-cli-end-session";
const LLM_LIST_MODELS = "llm-list-models";

// --- Main → Renderer (send) ---
const LLM_STREAM_DELTA = "llm-stream-delta";
const LLM_STREAM_TOOL_CALL = "llm-stream-tool-call";
const LLM_STREAM_TOOL_RESULT = "llm-stream-tool-result";
const LLM_STREAM_COMPLETE = "llm-stream-complete";
const LLM_STREAM_ERROR = "llm-stream-error";

module.exports = {
  LLM_SEND_MESSAGE,
  LLM_ABORT_REQUEST,
  LLM_LIST_CONNECTED_TOOLS,
  LLM_CHECK_CLI_AVAILABLE,
  LLM_CLEAR_CLI_SESSION,
  LLM_STREAM_DELTA,
  LLM_STREAM_TOOL_CALL,
  LLM_STREAM_TOOL_RESULT,
  LLM_STREAM_COMPLETE,
  LLM_STREAM_ERROR,
  LLM_CLI_SESSION_STATUS,
  LLM_CLI_END_SESSION,
  LLM_LIST_MODELS,
};
