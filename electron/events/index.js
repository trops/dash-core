/**
 * Events
 *
 * All event constants used by the framework.
 */
const secureStorageEvents = require("./secureStorageEvents");
const workspaceEvents = require("./workspaceEvents");
const layoutEvents = require("./layoutEvents");
const themeEvents = require("./themeEvents");
const dataEvents = require("./dataEvents");
const settingsEvents = require("./settingsEvents");
const dialogEvents = require("./dialogEvents");
const providerEvents = require("./providerEvents");
const mcpEvents = require("./mcpEvents");
const registryEvents = require("./registryEvents");
const algoliaEvents = require("./algoliaEvents");
const menuItemEvents = require("./menuItemEvents");
const openaiEvents = require("./openaiEvents");
const llmEvents = require("./llmEvents");
const dashboardConfigEvents = require("./dashboardConfigEvents");
const dashboardRatingsEvents = require("./dashboardRatingsEvents");
const registryAuthEvents = require("./registryAuthEvents");
const sessionEvents = require("./sessionEvents");
const notificationEvents = require("./notificationEvents");
const schedulerEvents = require("./schedulerEvents");
const themeFromUrlEvents = require("./themeFromUrlEvents");
const webSocketEvents = require("./webSocketEvents");
const mcpDashServerEvents = require("./mcpDashServerEvents");
const publisherKeyEvents = require("./publisherKeyEvents");
const onboardingEvents = require("./onboardingEvents");
const exportEvents = require("./exportEvents");

const publicEvents = {
  ...dataEvents,
};

/**
 * API_GROUPS — structured map of API group name → channel values.
 * Used by the debug console's deriveApi() to auto-categorize IPC channels.
 * Adding a new event constant here automatically categorizes it.
 */
const API_GROUPS = {
  algolia: Object.values(algoliaEvents),
  "dashboard-config": Object.values(dashboardConfigEvents),
  "dashboard-ratings": Object.values(dashboardRatingsEvents),
  data: Object.values(dataEvents),
  dialog: Object.values(dialogEvents),
  layout: Object.values(layoutEvents),
  llm: Object.values(llmEvents),
  mcp: [...Object.values(mcpEvents), ...Object.values(mcpDashServerEvents)],
  menu: Object.values(menuItemEvents),
  notifications: Object.values(notificationEvents),
  openai: Object.values(openaiEvents),
  providers: Object.values(providerEvents),
  "publisher-key": Object.values(publisherKeyEvents),
  onboarding: Object.values(onboardingEvents),
  export: Object.values(exportEvents),
  registry: Object.values(registryEvents),
  "registry-auth": Object.values(registryAuthEvents),
  scheduler: Object.values(schedulerEvents),
  "secure-store": Object.values(secureStorageEvents),
  session: Object.values(sessionEvents),
  settings: Object.values(settingsEvents),
  themes: [...Object.values(themeEvents), ...Object.values(themeFromUrlEvents)],
  websocket: Object.values(webSocketEvents),
  widgets: [],
  workspace: Object.values(workspaceEvents),
};

module.exports = {
  public: publicEvents,
  API_GROUPS,
  ...secureStorageEvents,
  ...workspaceEvents,
  ...layoutEvents,
  ...themeEvents,
  ...dataEvents,
  ...settingsEvents,
  ...dialogEvents,
  ...providerEvents,
  ...mcpEvents,
  ...registryEvents,
  ...algoliaEvents,
  ...menuItemEvents,
  ...openaiEvents,
  ...llmEvents,
  ...dashboardConfigEvents,
  ...dashboardRatingsEvents,
  ...registryAuthEvents,
  ...sessionEvents,
  ...notificationEvents,
  ...schedulerEvents,
  ...themeFromUrlEvents,
  ...webSocketEvents,
  ...mcpDashServerEvents,
  ...publisherKeyEvents,
  ...onboardingEvents,
  ...exportEvents,
};
