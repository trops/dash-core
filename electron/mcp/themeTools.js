/**
 * themeTools.js
 *
 * Registers theme MCP tools with the MCP Dash server.
 * Call registerThemeTools() during app startup (before or after server start).
 */
const { registerTool } = require("../controller/mcpDashServerController");
const { themeTools } = require("./toolDefinitions");
const {
  handleListThemes,
  handleGetTheme,
  handleCreateTheme,
  handleCreateThemeFromUrl,
  handleApplyTheme,
  handleSearchRegistryThemes,
} = require("./toolHandlers");

// Map tool names to handler functions
const handlerMap = {
  list_themes: handleListThemes,
  get_theme: handleGetTheme,
  create_theme: handleCreateTheme,
  create_theme_from_url: handleCreateThemeFromUrl,
  apply_theme: handleApplyTheme,
  search_registry_themes: handleSearchRegistryThemes,
};

/**
 * Register all theme tools with the MCP server controller.
 */
function registerThemeTools() {
  for (const tool of themeTools) {
    const handler = handlerMap[tool.name];
    if (!handler) {
      console.warn(`[themeTools] No handler found for tool: ${tool.name}`);
      continue;
    }
    registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler,
    });
  }
  console.log(`[themeTools] Registered ${themeTools.length} theme tools`);
}

module.exports = { registerThemeTools };
