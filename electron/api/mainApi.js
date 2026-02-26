/**
 * mainApi.js
 *
 * Factory for creating the main API object exposed to the renderer via contextBridge.
 * All APIs are included by default. Additional template-specific APIs
 * can be added via the extensions parameter.
 *
 * Usage in template's preload.js:
 *
 *   const { defaultMainApi } = require("@trops/dash-core/electron");
 *   contextBridge.exposeInMainWorld("mainApi", defaultMainApi);
 */
const { ipcRenderer, shell } = require("electron");
const secureStoreApi = require("./secureStoreApi");
const workspaceApi = require("./workspaceApi");
const layoutApi = require("./layoutApi");
const dataApi = require("./dataApi");
const settingsApi = require("./settingsApi");
const dialogApi = require("./dialogApi");
const widgetApi = require("./widgetApi");
const providerApi = require("./providerApi");
const mcpApi = require("./mcpApi");
const registryApi = require("./registryApi");
const themeApi = require("./themeApi");
const algoliaApi = require("./algoliaApi");
const openaiApi = require("./openaiApi");
const menuItemsApi = require("./menuItemsApi");
const pluginApi = require("./pluginApi");

// Events constants
const events = require("../events");

/**
 * Create the main API object with core APIs and optional extensions.
 *
 * @param {Object} extensions - Additional API namespaces to merge (e.g., { algolia: algoliaApi })
 * @returns {Object} The complete mainApi object
 */
function createMainApi(extensions = {}) {
  const mainApi = {
    // the main application identifier to STORE the data in the application folder.
    appId: null,

    setAppId: (appId) => {
      console.log("setting appId in the api ", appId);
      mainApi.appId = appId;
    },

    // keep these for general use
    on: (event, fn) => {
      ipcRenderer.addListener(event, fn);
    },
    removeAllListeners: (name = null) => {
      // can remove all listeners for event
      if (name) ipcRenderer.removeAllListeners(name);
    },
    removeListener: (name, fn) => ipcRenderer.removeListener(name, fn),

    // Core APIs
    secureStoreApi: secureStoreApi,
    workspace: workspaceApi,
    layout: layoutApi,
    themes: themeApi,
    data: { appId: null, ...dataApi },
    settings: settingsApi,
    dialog: dialogApi,
    widgets: widgetApi,
    providers: providerApi,
    mcp: mcpApi,
    registry: registryApi,

    shell: {
      openPath: (path) => shell.openPath(path),
      openExternal: (url) => {
        if (
          typeof url === "string" &&
          (url.startsWith("http://") || url.startsWith("https://"))
        ) {
          return shell.openExternal(url);
        }
      },
    },

    // included these in the bridge
    events: { ...events },

    publicEvents: events.public,

    pathPlugins: "",

    // APIs previously in template
    algolia: algoliaApi,
    openai: openaiApi,
    menuItems: menuItemsApi,
    plugins: pluginApi,

    // Merge template-specific extensions
    ...extensions,
  };

  return mainApi;
}

/**
 * Default mainApi for simple migration — includes only core APIs.
 * Templates that don't need extensions can use this directly.
 */
const defaultMainApi = createMainApi();

module.exports = { createMainApi, defaultMainApi };
