/**
 * API exports.
 * Provides both the factory and individual API modules.
 */
const { createMainApi, defaultMainApi } = require("./mainApi");

module.exports = {
  createMainApi,
  defaultMainApi,
  secureStoreApi: require("./secureStoreApi"),
  workspaceApi: require("./workspaceApi"),
  layoutApi: require("./layoutApi"),
  dataApi: require("./dataApi"),
  settingsApi: require("./settingsApi"),
  dialogApi: require("./dialogApi"),
  widgetApi: require("./widgetApi"),
  providerApi: require("./providerApi"),
  mcpApi: require("./mcpApi"),
  registryApi: require("./registryApi"),
  themeApi: require("./themeApi"),
  algoliaApi: require("./algoliaApi"),
  openaiApi: require("./openaiApi"),
  menuItemsApi: require("./menuItemsApi"),
  pluginApi: require("./pluginApi"),
};
