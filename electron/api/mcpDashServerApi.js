/**
 * mcpDashServerApi.js
 *
 * IPC preload bridge for the hosted MCP Dash server.
 * Allows the renderer process to start/stop/query the MCP server.
 */
const { ipcRenderer } = require("electron");
const {
  MCP_DASH_SERVER_START,
  MCP_DASH_SERVER_STOP,
  MCP_DASH_SERVER_STATUS,
  MCP_DASH_SERVER_GET_TOKEN,
} = require("../events");

const mcpDashServerApi = {
  /**
   * Start the MCP Dash server.
   * @param {number} [port] - Optional port override
   * @returns {Promise<{ success, port?, url?, error? }>}
   */
  startServer: (port) => ipcRenderer.invoke(MCP_DASH_SERVER_START, { port }),

  /**
   * Stop the MCP Dash server.
   * @returns {Promise<{ success, error? }>}
   */
  stopServer: () => ipcRenderer.invoke(MCP_DASH_SERVER_STOP, {}),

  /**
   * Get current server status.
   * @returns {Promise<{ running, enabled, port, connectionCount, uptime, toolCount, resourceCount }>}
   */
  getStatus: () => ipcRenderer.invoke(MCP_DASH_SERVER_STATUS, {}),

  /**
   * Get or create the bearer token for authentication.
   * @returns {Promise<string>}
   */
  getToken: () => ipcRenderer.invoke(MCP_DASH_SERVER_GET_TOKEN, {}),
};

module.exports = mcpDashServerApi;
