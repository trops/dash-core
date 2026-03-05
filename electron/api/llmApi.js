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

  // --- Stream event listeners ---

  /**
   * onStreamDelta
   * Listen for text chunks as they stream in.
   */
  onStreamDelta: (callback) => {
    ipcRenderer.on(LLM_STREAM_DELTA, (_event, data) => callback(data));
  },

  /**
   * onStreamToolCall
   * Listen for tool call notifications.
   */
  onStreamToolCall: (callback) => {
    ipcRenderer.on(LLM_STREAM_TOOL_CALL, (_event, data) => callback(data));
  },

  /**
   * onStreamToolResult
   * Listen for tool result notifications.
   */
  onStreamToolResult: (callback) => {
    ipcRenderer.on(LLM_STREAM_TOOL_RESULT, (_event, data) => callback(data));
  },

  /**
   * onStreamComplete
   * Listen for stream completion (final response).
   */
  onStreamComplete: (callback) => {
    ipcRenderer.on(LLM_STREAM_COMPLETE, (_event, data) => callback(data));
  },

  /**
   * onStreamError
   * Listen for stream errors.
   */
  onStreamError: (callback) => {
    ipcRenderer.on(LLM_STREAM_ERROR, (_event, data) => callback(data));
  },

  /**
   * removeAllStreamListeners
   * Clean up all LLM stream listeners.
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
