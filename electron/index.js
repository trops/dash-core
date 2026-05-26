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
const llmController = require("./controller/llmController");
const cliController = require("./controller/cliController");
const dashboardConfigController = require("./controller/dashboardConfigController");
const registryAuthController = require("./controller/registryAuthController");
const registryApiController = require("./controller/registryApiController");
const publisherKeyController = require("./controller/publisherKeyController");
const onboardingController = require("./controller/onboardingController");
const exportController = require("./controller/exportController");
const notificationController = require("./controller/notificationController");
const schedulerController = require("./controller/schedulerController");
const themeRegistryController = require("./controller/themeRegistryController");
const themeFromUrlController = require("./controller/themeFromUrlController");
const paletteToThemeMapper = require("./controller/paletteToThemeMapper");
const webSocketController = require("./controller/webSocketController");
const extractionCacheController = require("./controller/extractionCacheController");
const mcpDashServerController = require("./controller/mcpDashServerController");
const widgetMcpGrantsController = require("./controller/widgetMcpGrantsController");
const widgetMountTokenController = require("./controller/widgetMountTokenController");
const jitConsent = require("./mcp/jitConsent");

// --- Errors ---
const themeFromUrlErrors = require("./errors/themeFromUrlErrors");

// --- Utils ---
const clientCache = require("./utils/clientCache");
require("./utils/clientFactories"); // auto-register built-in factories
const responseCache = require("./utils/responseCache");

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
const llmApi = require("./api/llmApi");
const dashboardConfigApi = require("./api/dashboardConfigApi");
const registryAuthApi = require("./api/registryAuthApi");
const publisherKeyApi = require("./api/publisherKeyApi");
const onboardingApi = require("./api/onboardingApi");
const exportApi = require("./api/exportApi");
const notificationApi = require("./api/notificationApi");
const schedulerApi = require("./api/schedulerApi");
const themeFromUrlApi = require("./api/themeFromUrlApi");
const webSocketApi = require("./api/webSocketApi");
const mcpDashServerApi = require("./api/mcpDashServerApi");

// --- Events ---
const events = require("./events");

// --- Widget Pipeline ---
const widgetRegistry = require("./widgetRegistry");
const widgetCompiler = require("./widgetCompiler");
const dynamicWidgetLoader = require("./dynamicWidgetLoader");

// --- MCP Dash Server Tools, Resources & Prompts ---
const { registerDashboardTools } = require("./mcp/dashboardTools");
const { registerWidgetTools } = require("./mcp/widgetTools");
const { registerThemeTools } = require("./mcp/themeTools");
const { registerProviderTools } = require("./mcp/providerTools");
const { registerGuideTools } = require("./mcp/guideTools");
const { registerLayoutTools } = require("./mcp/layoutTools");
const {
  registerInstallKnownMcpServerTool,
} = require("./mcp/installExternalMcpTool");
const { registerResources } = require("./mcp/resources");
const { registerPrompts } = require("./mcp/promptRegistration");
registerDashboardTools();
registerWidgetTools();
registerThemeTools();
registerProviderTools();
registerGuideTools();
registerLayoutTools();
registerInstallKnownMcpServerTool();
registerResources();
registerPrompts();

// --- Schema ---
const dashboardConfigValidator = require("./schema/dashboardConfigValidator");
const dashboardConfigUtils = require("./schema/dashboardConfigUtils");

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
  llmController,
  cliController,
  dashboardConfigController,
  registryAuthController,
  registryApiController,
  publisherKeyController,
  onboardingController,
  exportController,
  notificationController,
  schedulerController,
  themeRegistryController,
  themeFromUrlController,
  paletteToThemeMapper,
  webSocketController,
  extractionCacheController,
  mcpDashServerController,
  widgetMcpGrantsController,
  widgetMountTokenController,
  jitConsent,

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
  llmApi,
  dashboardConfigApi,
  registryAuthApi,
  publisherKeyApi,
  onboardingApi,
  exportApi,
  notificationApi,
  schedulerApi,
  themeFromUrlApi,
  webSocketApi,
  mcpDashServerApi,

  // Events
  events,
  API_GROUPS: events.API_GROUPS,

  // Widget Pipeline
  widgetRegistry,
  widgetCompiler,
  dynamicWidgetLoader,

  // Factory
  createMainApi,
  defaultMainApi,

  // Utils
  clientCache,
  responseCache,

  // Errors
  themeFromUrlErrors,

  // Schema
  dashboardConfigValidator,
  dashboardConfigUtils,

  // Setup helpers
  setupCacheHandlers: clientCache.setupCacheHandlers.bind(clientCache),

  // MCP Dash Server Tools
  registerDashboardTools,
  registerWidgetTools,
  registerThemeTools,
  registerProviderTools,
  registerLayoutTools,
  registerResources,
};
