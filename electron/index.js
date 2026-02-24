/**
 * @trops/dash-core/electron
 *
 * Electron main process layer — controllers, IPC handlers, and widget pipeline.
 */

// --- Controllers (namespaced) ---
const dialogController = require("./controller/dialogController");
const secureStoreController = require("./controller/secureStoreController");
const workspaceController = require("./controller/workspaceController");
const themeController = require("./controller/themeController");
const dataController = require("./controller/dataController");
const settingsController = require("./controller/settingsController");
const providerController = require("./controller/providerController");
const layoutController = require("./controller/layoutController");
const mcpController = require("./controller/mcpController");
const registryController = require("./controller/registryController");
const algoliaController = require("./controller/algoliaController");
const openaiController = require("./controller/openaiController");
const menuItemsController = require("./controller/menuItemsController");
const pluginController = require("./controller/pluginController");

// --- Controller functions (flat, for convenient destructuring) ---
const controllers = require("./controller");

// --- APIs (IPC handlers) ---
const secureStoreApi = require("./api/secureStoreApi");
const workspaceApi = require("./api/workspaceApi");
const layoutApi = require("./api/layoutApi");
const dataApi = require("./api/dataApi");
const settingsApi = require("./api/settingsApi");
const dialogApi = require("./api/dialogApi");
const widgetApi = require("./api/widgetApi");
const providerApi = require("./api/providerApi");
const mcpApi = require("./api/mcpApi");
const registryApi = require("./api/registryApi");
const themeApi = require("./api/themeApi");
const algoliaApi = require("./api/algoliaApi");
const openaiApi = require("./api/openaiApi");
const menuItemsApi = require("./api/menuItemsApi");
const pluginApi = require("./api/pluginApi");

// --- Events ---
const events = require("./events");

// --- Widget Pipeline ---
const widgetRegistry = require("./widgetRegistry");
const widgetCompiler = require("./widgetCompiler");
const dynamicWidgetLoader = require("./dynamicWidgetLoader");

// --- Factory: createMainApi ---
const { createMainApi, defaultMainApi } = require("./api/mainApi");

module.exports = {
    // Controllers (namespaced)
    dialogController,
    secureStoreController,
    workspaceController,
    themeController,
    dataController,
    settingsController,
    providerController,
    layoutController,
    mcpController,
    registryController,
    algoliaController,
    openaiController,
    menuItemsController,
    pluginController,

    // Controller functions (flat) — spread for convenient destructuring
    ...controllers,

    // APIs
    secureStoreApi,
    workspaceApi,
    layoutApi,
    dataApi,
    settingsApi,
    dialogApi,
    widgetApi,
    providerApi,
    mcpApi,
    registryApi,
    themeApi,
    algoliaApi,
    openaiApi,
    menuItemsApi,
    pluginApi,

    // Events
    events,

    // Widget Pipeline
    widgetRegistry,
    widgetCompiler,
    dynamicWidgetLoader,

    // Factory
    createMainApi,
    defaultMainApi,
};
