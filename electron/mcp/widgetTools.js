/**
 * widgetTools.js
 *
 * Registers widget MCP tools with the MCP Dash server.
 * Call registerWidgetTools() during app startup (before or after server start).
 */
const { registerTool } = require("../controller/mcpDashServerController");
const { widgetTools } = require("./toolDefinitions");
const {
  handleAddWidget,
  handleRemoveWidget,
  handleConfigureWidget,
  handleListWidgets,
  handleSearchWidgets,
} = require("./toolHandlers");

// Map tool names to handler functions
const handlerMap = {
  add_widget: handleAddWidget,
  remove_widget: handleRemoveWidget,
  configure_widget: handleConfigureWidget,
  list_widgets: handleListWidgets,
  search_widgets: handleSearchWidgets,
};

/**
 * Register all widget tools with the MCP server controller.
 */
function registerWidgetTools() {
  for (const tool of widgetTools) {
    const handler = handlerMap[tool.name];
    if (!handler) {
      console.warn(`[widgetTools] No handler found for tool: ${tool.name}`);
      continue;
    }
    registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler,
    });
  }
  console.log(`[widgetTools] Registered ${widgetTools.length} widget tools`);
}

module.exports = { registerWidgetTools };
