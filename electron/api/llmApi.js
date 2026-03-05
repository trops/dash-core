/**
 * llmApi.js
 *
 * Preload bridge for LLM chat operations.
 * Communicates with main process via IPC for streaming chat,
 * tool-use events, and request cancellation.
 */
const { ipcRenderer } = require("electron");
const {
  LLM_SEND_MESSAGE,
  LLM_ABORT_REQUEST,
  LLM_LIST_CONNECTED_TOOLS,
  LLM_CHECK_CLI_AVAILABLE,
  LLM_CLEAR_CLI_SESSION,
  LLM_CLI_SESSION_STATUS,
  LLM_CLI_END_SESSION,
  LLM_STREAM_DELTA,
  LLM_STREAM_TOOL_CALL,
  LLM_STREAM_TOOL_RESULT,
  LLM_STREAM_COMPLETE,
  LLM_STREAM_ERROR,
} = require("../events/llmEvents");

const llmApi = {
  /**
   * sendMessage
   * Start a streaming LLM request with optional tool-use.
   *
   * @param {string} requestId - unique ID for filtering stream events
   * @param {object} params - { apiKey, model, messages, tools, toolServerMap, systemPrompt, maxToolRounds }
   * @returns {Promise<void>}
   */
  sendMessage: (requestId, params) =>
    ipcRenderer.invoke(LLM_SEND_MESSAGE, { requestId, ...params }),

  /**
   * abortRequest
   * Cancel an in-flight LLM request.
   *
   * @param {string} requestId - the request to cancel
   * @returns {Promise<{ success: boolean }>}
   */
  abortRequest: (requestId) =>
    ipcRenderer.invoke(LLM_ABORT_REQUEST, { requestId }),

  /**
   * listConnectedTools
   * Get all tools from all connected MCP servers.
   *
   * @returns {Promise<Array<{ serverName, tools, resources, status }>>}
   */
  listConnectedTools: () => ipcRenderer.invoke(LLM_LIST_CONNECTED_TOOLS),

  /**
   * checkCliAvailable
   * Check if the Claude Code CLI is installed and accessible.
   *
   * @returns {Promise<{ available: boolean, path?: string }>}
   */
  checkCliAvailable: () => ipcRenderer.invoke(LLM_CHECK_CLI_AVAILABLE),

  /**
   * clearCliSession
   * Clear the CLI conversation session for a widget (for "New Chat").
   *
   * @param {string} widgetUuid - the widget whose session to clear
   * @returns {Promise<{ success: boolean }>}
   */
  clearCliSession: (widgetUuid) =>
    ipcRenderer.invoke(LLM_CLEAR_CLI_SESSION, { widgetUuid }),

  /**
   * getCliSessionStatus
   * Check if a CLI session is active for a widget.
   *
   * @param {string} widgetUuid - the widget to check
   * @returns {Promise<{ hasSession: boolean, sessionId?: string, isProcessActive: boolean }>}
   */
  getCliSessionStatus: (widgetUuid) =>
    ipcRenderer.invoke(LLM_CLI_SESSION_STATUS, { widgetUuid }),

  /**
   * endCliSession
   * Kill any active CLI process AND clear the session for a widget.
   *
   * @param {string} widgetUuid - the widget whose session to end
   * @returns {Promise<{ success: boolean }>}
   */
  endCliSession: (widgetUuid) =>
    ipcRenderer.invoke(LLM_CLI_END_SESSION, { widgetUuid }),

  // --- Stream event listeners ---
  // Each on* method returns the wrapped callback so callers can remove
  // their own listener without nuking listeners from other widgets.

  /**
   * onStreamDelta
   * Listen for text chunks as they stream in.
   * @returns {Function} wrapped callback for use with removeStreamListener
   */
  onStreamDelta: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on(LLM_STREAM_DELTA, wrapped);
    return wrapped;
  },

  /**
   * onStreamToolCall
   * Listen for tool call notifications.
   * @returns {Function} wrapped callback for use with removeStreamListener
   */
  onStreamToolCall: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on(LLM_STREAM_TOOL_CALL, wrapped);
    return wrapped;
  },

  /**
   * onStreamToolResult
   * Listen for tool result notifications.
   * @returns {Function} wrapped callback for use with removeStreamListener
   */
  onStreamToolResult: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on(LLM_STREAM_TOOL_RESULT, wrapped);
    return wrapped;
  },

  /**
   * onStreamComplete
   * Listen for stream completion (final response).
   * @returns {Function} wrapped callback for use with removeStreamListener
   */
  onStreamComplete: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on(LLM_STREAM_COMPLETE, wrapped);
    return wrapped;
  },

  /**
   * onStreamError
   * Listen for stream errors.
   * @returns {Function} wrapped callback for use with removeStreamListener
   */
  onStreamError: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on(LLM_STREAM_ERROR, wrapped);
    return wrapped;
  },

  /**
   * removeStreamListener
   * Remove a specific stream listener by channel and callback reference.
   *
   * @param {string} channel - the IPC channel name
   * @param {Function} wrapped - the callback returned by on*
   */
  removeStreamListener: (channel, wrapped) => {
    ipcRenderer.removeListener(channel, wrapped);
  },

  /**
   * Stream channel constants for use with removeStreamListener.
   */
  streamChannels: {
    delta: LLM_STREAM_DELTA,
    toolCall: LLM_STREAM_TOOL_CALL,
    toolResult: LLM_STREAM_TOOL_RESULT,
    complete: LLM_STREAM_COMPLETE,
    error: LLM_STREAM_ERROR,
  },

  /**
   * removeAllStreamListeners
   * Clean up ALL LLM stream listeners (global).
   * Prefer removeStreamListener for scoped cleanup.
   */
  removeAllStreamListeners: () => {
    ipcRenderer.removeAllListeners(LLM_STREAM_DELTA);
    ipcRenderer.removeAllListeners(LLM_STREAM_TOOL_CALL);
    ipcRenderer.removeAllListeners(LLM_STREAM_TOOL_RESULT);
    ipcRenderer.removeAllListeners(LLM_STREAM_COMPLETE);
    ipcRenderer.removeAllListeners(LLM_STREAM_ERROR);
  },
};

module.exports = llmApi;
