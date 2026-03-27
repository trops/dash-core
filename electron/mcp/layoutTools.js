/**
 * layoutTools.js
 *
 * Registers layout/grid MCP tools with the MCP Dash server.
 * Call registerLayoutTools() during app startup (before or after server start).
 */
const { registerTool } = require("../controller/mcpDashServerController");
const { layoutTools } = require("./toolDefinitions");
const {
  handleSetLayout,
  handleUpdateLayout,
  handleMoveWidget,
} = require("./toolHandlers");

const handlerMap = {
  set_layout: handleSetLayout,
  update_layout: handleUpdateLayout,
  move_widget: handleMoveWidget,
};

/**
 * Register all layout tools with the MCP server controller.
 */
function registerLayoutTools() {
  for (const tool of layoutTools) {
    const handler = handlerMap[tool.name];
    if (!handler) {
      console.warn(`[layoutTools] No handler found for tool: ${tool.name}`);
      continue;
    }
    registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler,
    });
  }
  console.log(`[layoutTools] Registered ${layoutTools.length} layout tools`);
}

module.exports = { registerLayoutTools };
