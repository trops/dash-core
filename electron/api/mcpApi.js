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
   * @param {string|null} workspaceId active workspace id (Slice 3a) —
   *   server processes are keyed per workspace.
   * @returns {Promise<{ success, serverName, tools, status } | { error, message }>}
   */
  startServer: (serverName, mcpConfig, credentials, workspaceId = null) =>
    ipcRenderer.invoke(MCP_START_SERVER, {
      serverName,
      mcpConfig,
      credentials,
      workspaceId,
    }),

  /**
   * stopServer
   * Stop a running MCP server
   *
   * @param {string} serverName the server to stop
   * @param {string|null} workspaceId active workspace id (Slice 3a)
   * @returns {Promise<{ success, serverName } | { error, message }>}
   */
  stopServer: (serverName, workspaceId = null) =>
    ipcRenderer.invoke(MCP_STOP_SERVER, { serverName, workspaceId }),

  /**
   * listTools
   * List available tools for a running MCP server
   *
   * @param {string} serverName the server name
   * @param {string|null} workspaceId active workspace id (Slice 3a)
   * @returns {Promise<{ tools } | { error, message }>}
   */
  listTools: (serverName, workspaceId = null) =>
    ipcRenderer.invoke(MCP_LIST_TOOLS, { serverName, workspaceId }),

  /**
   * callTool
   * Call a tool on a running MCP server
   *
   * @param {string} serverName the server name
   * @param {string} toolName the tool to call
   * @param {object} args tool arguments
   * @param {Array<string>} allowedTools optional whitelist of allowed tool names (legacy — prefer per-widget manifest)
   * @param {string} widgetId optional widget identity. When the
   *   security.enforceWidgetMcpPermissions setting is enabled, this is
   *   used to look up the widget's MCP permission manifest and gate
   *   the call accordingly. Should be the npm package name of the
   *   calling widget (e.g. "@trops/notes-summarizer").
   * @param {string|null} workspaceId active workspace id (Slice 3a) —
   *   the server process is scoped per (workspace, server). Slice 3b
   *   will tie path scope to this id.
   * @returns {Promise<{ result } | { error, message }>}
   */
  callTool: (
    serverName,
    toolName,
    args,
    allowedTools = null,
    widgetId = null,
    workspaceId = null,
  ) =>
    ipcRenderer.invoke(MCP_CALL_TOOL, {
      serverName,
      toolName,
      args,
      allowedTools,
      widgetId,
      workspaceId,
    }),

  /**
   * listResources
   * List available resources for a running MCP server
   *
   * @param {string} serverName the server name
   * @param {string|null} workspaceId active workspace id (Slice 3a)
   * @returns {Promise<{ resources } | { error, message }>}
   */
  listResources: (serverName, workspaceId = null) =>
    ipcRenderer.invoke(MCP_LIST_RESOURCES, { serverName, workspaceId }),

  /**
   * readResource
   * Read a specific resource from a running MCP server
   *
   * @param {string} serverName the server name
   * @param {string} uri the resource URI
   * @param {string|null} workspaceId active workspace id (Slice 3a)
   * @returns {Promise<{ resource } | { error, message }>}
   */
  readResource: (serverName, uri, workspaceId = null) =>
    ipcRenderer.invoke(MCP_READ_RESOURCE, { serverName, uri, workspaceId }),

  /**
   * getServerStatus
   * Get the connection status of a server
   *
   * @param {string} serverName the server name
   * @param {string|null} workspaceId active workspace id (Slice 3a)
   * @returns {Promise<{ status, tools, error }>}
   */
  getServerStatus: (serverName, workspaceId = null) =>
    ipcRenderer.invoke(MCP_SERVER_STATUS, { serverName, workspaceId }),

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
