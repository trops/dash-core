/**
 * Events
 *
 * Core event constants used by the framework.
 * Template-specific events (algolia, openai, menuItem) live in the template repo.
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
};
