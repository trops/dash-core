/**
 * guideTools.js
 *
 * Registers the get_setup_guide MCP tool with the MCP Dash server.
 * Call registerGuideTools() during app startup.
 */
const { registerTool } = require("../controller/mcpDashServerController");
const { guideTools } = require("./toolDefinitions");
const { handleGetSetupGuide } = require("./toolHandlers");

const handlerMap = {
  get_setup_guide: handleGetSetupGuide,
};

function registerGuideTools() {
  for (const tool of guideTools) {
    const handler = handlerMap[tool.name];
    if (!handler) {
      console.warn(`[guideTools] No handler found for tool: ${tool.name}`);
      continue;
    }
    registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler,
    });
  }
  console.log(`[guideTools] Registered ${guideTools.length} guide tools`);
}

module.exports = { registerGuideTools };
