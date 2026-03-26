/**
 * promptRegistration.js
 *
 * Registers MCP prompts with the MCP Dash server.
 * Call registerPrompts() during app startup (alongside tool/resource registration).
 */
const { registerPrompt } = require("../controller/mcpDashServerController");
const { dashPrompts } = require("./promptDefinitions");
const {
  handleBuildDashboard,
  handleDesignTheme,
  handleSetupProvider,
} = require("./promptHandlers");

const handlerMap = {
  "build-dashboard": handleBuildDashboard,
  "design-theme": handleDesignTheme,
  "setup-provider": handleSetupProvider,
};

function registerPrompts() {
  for (const prompt of dashPrompts) {
    const handler = handlerMap[prompt.name];
    if (!handler) {
      console.warn(
        `[promptRegistration] No handler found for prompt: ${prompt.name}`,
      );
      continue;
    }
    registerPrompt({
      name: prompt.name,
      description: prompt.description,
      args: prompt.args,
      handler,
    });
  }
  console.log(`[promptRegistration] Registered ${dashPrompts.length} prompts`);
}

module.exports = { registerPrompts };
