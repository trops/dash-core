/**
 * webSocketApi.js
 *
 * Preload bridge for WebSocket provider operations.
 * Communicates with main process via IPC to manage WebSocket connections.
 * Mirrors mcpApi.js patterns.
 */
const { ipcRenderer } = require("electron");
const {
  WS_CONNECT,
  WS_DISCONNECT,
  WS_SEND,
  WS_STATUS,
  WS_GET_ALL,
  WS_MESSAGE,
  WS_STATUS_CHANGE,
} = require("../events");

const webSocketApi = {
  /**
   * connect
   * Open a WebSocket connection for the given provider
   *
   * @param {string} providerName unique provider name
   * @param {object} config { url, headers, subprotocols, credentials }
   * @returns {Promise<{ success, providerName, status } | { error, message }>}
   */
  connect: (providerName, config, widgetId = null) =>
    ipcRenderer.invoke(WS_CONNECT, { providerName, config, widgetId }),

  /**
   * disconnect
   * Close a WebSocket connection
   *
   * @param {string} providerName the provider to disconnect
   * @returns {Promise<{ success, providerName } | { error, message }>}
   */
  disconnect: (providerName) =>
    ipcRenderer.invoke(WS_DISCONNECT, { providerName }),

  /**
   * send
   * Send a message through an active WebSocket connection
   *
   * @param {string} providerName the provider to send through
   * @param {*} data the data to send
   * @returns {Promise<{ success } | { error, message }>}
   */
  send: (providerName, data) =>
    ipcRenderer.invoke(WS_SEND, { providerName, data }),

  /**
   * getStatus
   * Get the connection status of a provider
   *
   * @param {string} providerName the provider name
   * @returns {Promise<{ providerName, status, messageCount, connectedAt, lastMessageAt }>}
   */
  getStatus: (providerName) => ipcRenderer.invoke(WS_STATUS, { providerName }),

  /**
   * getAll
   * Get all active WebSocket connections with their status
   *
   * @returns {Promise<{ connections }>}
   */
  getAll: () => ipcRenderer.invoke(WS_GET_ALL),

  /**
   * onMessage
   * Subscribe to incoming WebSocket messages from main process
   *
   * @param {Function} callback (event, { provider, data, timestamp })
   */
  onMessage: (callback) => ipcRenderer.on(WS_MESSAGE, callback),

  /**
   * offMessage
   * Unsubscribe from incoming WebSocket messages
   *
   * @param {Function} callback the same callback passed to onMessage
   */
  offMessage: (callback) => ipcRenderer.removeListener(WS_MESSAGE, callback),

  /**
   * onStatusChange
   * Subscribe to WebSocket connection status changes
   *
   * @param {Function} callback (event, { provider, status, error?, code?, reason? })
   */
  onStatusChange: (callback) => ipcRenderer.on(WS_STATUS_CHANGE, callback),

  /**
   * offStatusChange
   * Unsubscribe from WebSocket status changes
   *
   * @param {Function} callback the same callback passed to onStatusChange
   */
  offStatusChange: (callback) =>
    ipcRenderer.removeListener(WS_STATUS_CHANGE, callback),
};

module.exports = webSocketApi;
