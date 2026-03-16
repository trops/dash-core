/**
 * resources.js
 *
 * Registers MCP resources with the MCP Dash server.
 * Call registerResources() during app startup (before or after server start).
 */
const { registerResource } = require("../controller/mcpDashServerController");
const { dashResources } = require("./resourceDefinitions");
const {
  handleActiveDashboard,
  handleAllDashboards,
  handleAllThemes,
  handleAllProviders,
  handleAppInfo,
} = require("./resourceHandlers");

// Map resource URIs to handler functions
const handlerMap = {
  "dash://dashboards/active": handleActiveDashboard,
  "dash://dashboards": handleAllDashboards,
  "dash://themes": handleAllThemes,
  "dash://providers": handleAllProviders,
  "dash://app/info": handleAppInfo,
};

/**
 * Register all MCP resources with the server controller.
 */
function registerResources() {
  for (const resource of dashResources) {
    const handler = handlerMap[resource.uri];
    if (!handler) {
      console.warn(
        `[resources] No handler found for resource: ${resource.uri}`,
      );
      continue;
    }
    registerResource({
      name: resource.name,
      uri: resource.uri,
      metadata: { description: resource.description },
      handler,
    });
  }
  console.log(`[resources] Registered ${dashResources.length} MCP resources`);
}

module.exports = { registerResources };
