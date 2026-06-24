/**
 * Event Constants File - MCP Events
 *
 * This file contains event constants for MCP (Model Context Protocol)
 * server-related IPC communication.
 */
const MCP_START_SERVER = "mcp-start-server";
const MCP_START_SERVER_COMPLETE = "mcp-start-server-complete";
const MCP_START_SERVER_ERROR = "mcp-start-server-error";

const MCP_STOP_SERVER = "mcp-stop-server";
const MCP_STOP_SERVER_COMPLETE = "mcp-stop-server-complete";
const MCP_STOP_SERVER_ERROR = "mcp-stop-server-error";

const MCP_LIST_TOOLS = "mcp-list-tools";
const MCP_LIST_TOOLS_COMPLETE = "mcp-list-tools-complete";
const MCP_LIST_TOOLS_ERROR = "mcp-list-tools-error";

const MCP_CALL_TOOL = "mcp-call-tool";
const MCP_CALL_TOOL_COMPLETE = "mcp-call-tool-complete";
const MCP_CALL_TOOL_ERROR = "mcp-call-tool-error";

const MCP_LIST_RESOURCES = "mcp-list-resources";
const MCP_LIST_RESOURCES_COMPLETE = "mcp-list-resources-complete";
const MCP_LIST_RESOURCES_ERROR = "mcp-list-resources-error";

const MCP_READ_RESOURCE = "mcp-read-resource";
const MCP_READ_RESOURCE_COMPLETE = "mcp-read-resource-complete";
const MCP_READ_RESOURCE_ERROR = "mcp-read-resource-error";

const MCP_SERVER_STATUS = "mcp-server-status";
const MCP_SERVER_STATUS_COMPLETE = "mcp-server-status-complete";
const MCP_SERVER_STATUS_ERROR = "mcp-server-status-error";

const MCP_GET_CATALOG = "mcp-get-catalog";
const MCP_GET_CATALOG_COMPLETE = "mcp-get-catalog-complete";
const MCP_GET_CATALOG_ERROR = "mcp-get-catalog-error";

const MCP_GET_KNOWN_EXTERNAL = "mcp-get-known-external";

const MCP_INSTALL_KNOWN_EXTERNAL_CONFIRM = "mcp-install-known-external-confirm";
const MCP_INSTALL_KNOWN_EXTERNAL_RESULT = "mcp-install-known-external-result";

const MCP_RUN_AUTH = "mcp-run-auth";
const MCP_RUN_AUTH_COMPLETE = "mcp-run-auth-complete";
const MCP_RUN_AUTH_ERROR = "mcp-run-auth-error";

const MCP_AUTHORIZE = "mcp-authorize";
const MCP_AUTHORIZE_COMPLETE = "mcp-authorize-complete";
const MCP_AUTHORIZE_ERROR = "mcp-authorize-error";

module.exports = {
  MCP_START_SERVER,
  MCP_START_SERVER_COMPLETE,
  MCP_START_SERVER_ERROR,
  MCP_STOP_SERVER,
  MCP_STOP_SERVER_COMPLETE,
  MCP_STOP_SERVER_ERROR,
  MCP_LIST_TOOLS,
  MCP_LIST_TOOLS_COMPLETE,
  MCP_LIST_TOOLS_ERROR,
  MCP_CALL_TOOL,
  MCP_CALL_TOOL_COMPLETE,
  MCP_CALL_TOOL_ERROR,
  MCP_LIST_RESOURCES,
  MCP_LIST_RESOURCES_COMPLETE,
  MCP_LIST_RESOURCES_ERROR,
  MCP_READ_RESOURCE,
  MCP_READ_RESOURCE_COMPLETE,
  MCP_READ_RESOURCE_ERROR,
  MCP_SERVER_STATUS,
  MCP_SERVER_STATUS_COMPLETE,
  MCP_SERVER_STATUS_ERROR,
  MCP_GET_CATALOG,
  MCP_GET_CATALOG_COMPLETE,
  MCP_GET_CATALOG_ERROR,
  MCP_GET_KNOWN_EXTERNAL,
  MCP_INSTALL_KNOWN_EXTERNAL_CONFIRM,
  MCP_INSTALL_KNOWN_EXTERNAL_RESULT,
  MCP_RUN_AUTH,
  MCP_RUN_AUTH_COMPLETE,
  MCP_RUN_AUTH_ERROR,
  MCP_AUTHORIZE,
  MCP_AUTHORIZE_COMPLETE,
  MCP_AUTHORIZE_ERROR,
};
