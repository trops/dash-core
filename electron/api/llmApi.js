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

let _nextListenerId = 0;
const _listenerMap = new Map();

function _addListener(channel, callback) {
  const id = String(++_nextListenerId);
  const wrapped = (_event, data) => callback(data);
  ipcRenderer.on(channel, wrapped);
  _listenerMap.set(id, { channel, wrapped });
  return id;
}

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
  // Each on* method returns an opaque string ID. Strings cross the
  // contextBridge safely (unlike function refs which get proxied).
  // Use removeStreamListener(id) to clean up.

  /** @returns {string} listener ID */
  onStreamDelta: (callback) => _addListener(LLM_STREAM_DELTA, callback),

  /** @returns {string} listener ID */
  onStreamToolCall: (callback) => _addListener(LLM_STREAM_TOOL_CALL, callback),

  /** @returns {string} listener ID */
  onStreamToolResult: (callback) =>
    _addListener(LLM_STREAM_TOOL_RESULT, callback),

  /** @returns {string} listener ID */
  onStreamComplete: (callback) => _addListener(LLM_STREAM_COMPLETE, callback),

  /** @returns {string} listener ID */
  onStreamError: (callback) => _addListener(LLM_STREAM_ERROR, callback),

  /**
   * removeStreamListener
   * Remove a specific stream listener by its opaque ID.
   *
   * @param {string} idOrChannel - listener ID (or legacy channel name when second arg is provided)
   * @param {string} [id] - listener ID when called with legacy (channel, id) signature
   */
  removeStreamListener: (idOrChannel, id) => {
    const listenerId = id !== undefined ? String(id) : String(idOrChannel);
    const entry = _listenerMap.get(listenerId);
    if (entry) {
      ipcRenderer.removeListener(entry.channel, entry.wrapped);
      _listenerMap.delete(listenerId);
    }
  },

  /**
   * removeAllStreamListeners
   * Clean up ALL LLM stream listeners (global).
   * Prefer removeStreamListener for scoped cleanup.
   */
  removeAllStreamListeners: () => {
    for (const [, entry] of _listenerMap) {
      ipcRenderer.removeListener(entry.channel, entry.wrapped);
    }
    _listenerMap.clear();
    ipcRenderer.removeAllListeners(LLM_STREAM_DELTA);
    ipcRenderer.removeAllListeners(LLM_STREAM_TOOL_CALL);
    ipcRenderer.removeAllListeners(LLM_STREAM_TOOL_RESULT);
    ipcRenderer.removeAllListeners(LLM_STREAM_COMPLETE);
    ipcRenderer.removeAllListeners(LLM_STREAM_ERROR);
  },
};

module.exports = llmApi;
