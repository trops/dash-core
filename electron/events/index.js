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

const publicEvents = {
  ...dataEvents,
};

module.exports = {
  public: publicEvents,
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
};
