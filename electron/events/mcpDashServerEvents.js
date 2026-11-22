/**
 * Event Constants File - MCP Dash Server Events
 *
 * Events for the hosted MCP server that exposes Dash capabilities
 * to external LLM clients via Streamable HTTP transport.
 *
 * NOTE: These are distinct from mcpEvents.js which handles the MCP *client*
 * (spawning stdio servers for widgets). These events manage the MCP *server*
 * that external tools (Claude Desktop, etc.) connect to.
 */
const MCP_DASH_SERVER_START = "mcp-dash-server:start";
const MCP_DASH_SERVER_STOP = "mcp-dash-server:stop";
const MCP_DASH_SERVER_STATUS = "mcp-dash-server:status";
const MCP_DASH_SERVER_GET_TOKEN = "mcp-dash-server:get-token";
// Settings › MCP Server › Tools (DASH-37): each tool's on/off switch.
const MCP_DASH_SERVER_LIST_TOOLS = "mcp-dash-server:list-tools";
const MCP_DASH_SERVER_SET_TOOL_ON = "mcp-dash-server:set-tool-on";

module.exports = {
  MCP_DASH_SERVER_START,
  MCP_DASH_SERVER_STOP,
  MCP_DASH_SERVER_STATUS,
  MCP_DASH_SERVER_GET_TOKEN,
  MCP_DASH_SERVER_LIST_TOOLS,
  MCP_DASH_SERVER_SET_TOOL_ON,
};
