/**
 * dashboardTools.js
 *
 * Registers dashboard/workspace MCP tools with the MCP Dash server.
 * Call registerDashboardTools() during app startup (before or after server start).
 */
const { registerTool } = require("../controller/mcpDashServerController");
const { dashboardTools } = require("./toolDefinitions");
const {
  handleListDashboards,
  handleGetDashboard,
  handleCreateDashboard,
  handleDeleteDashboard,
  handleGetAppStats,
} = require("./toolHandlers");

// Map tool names to handler functions
const handlerMap = {
  list_dashboards: handleListDashboards,
  get_dashboard: handleGetDashboard,
  create_dashboard: handleCreateDashboard,
  delete_dashboard: handleDeleteDashboard,
  get_app_stats: handleGetAppStats,
};

/**
 * Register all dashboard tools with the MCP server controller.
 */
function registerDashboardTools() {
  for (const tool of dashboardTools) {
    const handler = handlerMap[tool.name];
    if (!handler) {
      console.warn(`[dashboardTools] No handler found for tool: ${tool.name}`);
      continue;
    }
    registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler,
    });
  }
  console.log(
    `[dashboardTools] Registered ${dashboardTools.length} dashboard tools`,
  );
}

module.exports = { registerDashboardTools };
