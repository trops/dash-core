/**
 * mcpApi.js
 *
 * Preload bridge for MCP (Model Context Protocol) server operations.
 * Communicates with main process via IPC to manage MCP server lifecycle.
 */
const { ipcRenderer } = require("electron");
const {
  MCP_START_SERVER,
  MCP_STOP_SERVER,
  MCP_LIST_TOOLS,
  MCP_CALL_TOOL,
  MCP_LIST_RESOURCES,
  MCP_READ_RESOURCE,
  MCP_SERVER_STATUS,
  MCP_GET_CATALOG,
  MCP_GET_KNOWN_EXTERNAL,
  MCP_INSTALL_KNOWN_EXTERNAL_CONFIRM,
  MCP_INSTALL_KNOWN_EXTERNAL_RESULT,
  MCP_RUN_AUTH,
} = require("../events");

const mcpApi = {
  /**
   * startServer
   * Start an MCP server with the given config and credentials
   *
   * @param {string} serverName unique name for this server instance
   * @param {object} mcpConfig { transport, command, args, envMapping }
   * @param {object} credentials decrypted credentials object
   * @returns {Promise<{ success, serverName, tools, status } | { error, message }>}
   */
  startServer: (serverName, mcpConfig, credentials) =>
    ipcRenderer.invoke(MCP_START_SERVER, {
      serverName,
      mcpConfig,
      credentials,
    }),

  /**
   * stopServer
   * Stop a running MCP server
   *
   * @param {string} serverName the server to stop
   * @returns {Promise<{ success, serverName } | { error, message }>}
   */
  stopServer: (serverName) =>
    ipcRenderer.invoke(MCP_STOP_SERVER, { serverName }),

  /**
   * listTools
   * List available tools for a running MCP server
   *
   * @param {string} serverName the server name
   * @returns {Promise<{ tools } | { error, message }>}
   */
  listTools: (serverName) => ipcRenderer.invoke(MCP_LIST_TOOLS, { serverName }),

  /**
   * callTool
   * Call a tool on a running MCP server
   *
   * @param {string} serverName the server name
   * @param {string} toolName the tool to call
   * @param {object} args tool arguments
   * @param {Array<string>} allowedTools optional whitelist of allowed tool names
   * @returns {Promise<{ result } | { error, message }>}
   */
  callTool: (serverName, toolName, args, allowedTools = null) =>
    ipcRenderer.invoke(MCP_CALL_TOOL, {
      serverName,
      toolName,
      args,
      allowedTools,
    }),

  /**
   * listResources
   * List available resources for a running MCP server
   *
   * @param {string} serverName the server name
   * @returns {Promise<{ resources } | { error, message }>}
   */
  listResources: (serverName) =>
    ipcRenderer.invoke(MCP_LIST_RESOURCES, { serverName }),

  /**
   * readResource
   * Read a specific resource from a running MCP server
   *
   * @param {string} serverName the server name
   * @param {string} uri the resource URI
   * @returns {Promise<{ resource } | { error, message }>}
   */
  readResource: (serverName, uri) =>
    ipcRenderer.invoke(MCP_READ_RESOURCE, { serverName, uri }),

  /**
   * getServerStatus
   * Get the connection status of a server
   *
   * @param {string} serverName the server name
   * @returns {Promise<{ status, tools, error }>}
   */
  getServerStatus: (serverName) =>
    ipcRenderer.invoke(MCP_SERVER_STATUS, { serverName }),

  /**
   * getCatalog
   * Load the MCP server seed catalog
   *
   * @returns {Promise<{ catalog } | { error, message }>}
   */
  getCatalog: () => ipcRenderer.invoke(MCP_GET_CATALOG),

  /**
   * getKnownExternalCatalog
   * Load the curated allow-list of MCP servers known to exist outside the
   * built-in catalog. The AI Widget Builder reads this to advertise
   * "you can install <X> via Add Custom MCP" and as the trust boundary
   * for the `install_known_mcp_server` dash MCP tool — only ids in this
   * list are installable via that path.
   *
   * @returns {Promise<{ success, servers } | { error, message, servers }>}
   */
  getKnownExternalCatalog: () => ipcRenderer.invoke(MCP_GET_KNOWN_EXTERNAL),

  /**
   * onInstallKnownExternalConfirm
   * Subscribe to install-confirm requests emitted by the dash MCP server
   * tool `install_known_mcp_server`. The renderer renders a confirmation
   * modal and replies with { confirmed, credentials } via
   * sendInstallKnownExternalResult().
   *
   * @param {(payload: { id, requestId, server }) => void} callback
   * @returns {() => void} cleanup
   */
  onInstallKnownExternalConfirm: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on(MCP_INSTALL_KNOWN_EXTERNAL_CONFIRM, handler);
    return () =>
      ipcRenderer.removeListener(MCP_INSTALL_KNOWN_EXTERNAL_CONFIRM, handler);
  },

  /**
   * sendInstallKnownExternalResult
   * Reply to a confirm request with the user's decision + credentials.
   *
   * @param {string} requestId
   * @param {{ confirmed: boolean, credentials?: object, error?: string }} result
   */
  sendInstallKnownExternalResult: (requestId, result) =>
    ipcRenderer.send(MCP_INSTALL_KNOWN_EXTERNAL_RESULT, { requestId, result }),

  /**
   * runAuth
   * Run a one-shot auth command for an MCP server (e.g., OAuth browser flow)
   *
   * @param {object} mcpConfig { transport, command, args, envMapping }
   * @param {object} credentials decrypted credentials object
   * @param {object} authCommand { command, args }
   * @returns {Promise<{ success } | { error, message }>}
   */
  runAuth: (mcpConfig, credentials, authCommand) =>
    ipcRenderer.invoke(MCP_RUN_AUTH, { mcpConfig, credentials, authCommand }),
};

module.exports = mcpApi;
