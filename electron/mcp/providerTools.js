/**
 * providerTools.js
 *
 * Registers provider MCP tools with the MCP Dash server.
 * Call registerProviderTools() during app startup (before or after server start).
 */
const { registerTool } = require("../controller/mcpDashServerController");
const { providerTools } = require("./toolDefinitions");
const {
  handleListProviders,
  handleAddProvider,
  handleRemoveProvider,
} = require("./toolHandlers");

// Map tool names to handler functions
const handlerMap = {
  list_providers: handleListProviders,
  add_provider: handleAddProvider,
  remove_provider: handleRemoveProvider,
};

/**
 * Register all provider tools with the MCP server controller.
 */
function registerProviderTools() {
  for (const tool of providerTools) {
    const handler = handlerMap[tool.name];
    if (!handler) {
      console.warn(`[providerTools] No handler found for tool: ${tool.name}`);
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
    `[providerTools] Registered ${providerTools.length} provider tools`,
  );
}

module.exports = { registerProviderTools };
