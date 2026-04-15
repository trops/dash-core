/**
 * Controller exports.
 */
const { showDialog, fileChosenError } = require("./dialogController");
const {
  isEncryptionAvailable,
  saveData,
  getData,
} = require("./secureStoreController");
const {
  listWorkspacesForApplication,
  saveWorkspaceForApplication,
  deleteWorkspaceForApplication,
} = require("./workspaceController");
const {
  saveThemeForApplication,
  listThemesForApplication,
  deleteThemeForApplication,
} = require("./themeController");
const {
  convertJsonToCsvFile,
  convertJsonToCsvString,
  saveToFile,
  readFromFile,
  parseXMLStream,
  parseCSVStream,
  readLinesFromFile,
  transformFile,
  readJSONFromFile,
  readDataFromURL,
  extractColorsFromImageURL,
} = require("./dataController");
const {
  saveSettingsForApplication,
  getSettingsForApplication,
  getDataDirectory,
  setDataDirectory,
  migrateDataDirectory,
} = require("./settingsController");
const {
  saveProvider,
  listProviders,
  getProvider,
  deleteProvider,
} = require("./providerController");
const {
  listIndices,
  partialUpdateObjectsFromDirectory,
  createBatchesFromFile,
  browseObjectsToFile,
  search: searchIndex,
} = require("./algoliaController");
const { describeImage } = require("./openaiController");
const {
  saveMenuItemForApplication,
  listMenuItemsForApplication,
} = require("./menuItemsController");
const { install: pluginInstall } = require("./pluginController");
const {
  exportDashboardConfig,
  selectDashboardFile,
  importDashboardConfig,
  installDashboardFromRegistry,
  checkCompatibility,
  prepareDashboardForPublish,
  collectDashboardDependencies,
  getDashboardPublishPlan,
  getDashboardPreview,
  checkDashboardUpdatesForApp,
  getProviderSetupManifest,
  getDashboardPublishPreview,
} = require("./dashboardConfigController");
const {
  initiateDeviceFlow,
  pollForToken,
  getStoredToken: getRegistryToken,
  getAuthStatus: getRegistryAuthStatus,
  getRegistryProfile,
  updateRegistryProfile,
  getRegistryPackages,
  updateRegistryPackage,
  clearToken: clearRegistryToken,
} = require("./registryAuthController");
const {
  publishToRegistry,
  getRegistryUrl,
} = require("./registryApiController");
const {
  getRecentDashboards,
  addRecentDashboard,
  clearRecentDashboards,
  getSessionState,
  saveSessionState,
  clearSessionState,
} = require("./sessionController");
const {
  saveDashboardRating,
  getDashboardRating,
  listDashboardRatings,
  deleteDashboardRating,
  enrichPackagesWithRatings,
} = require("./dashboardRatingsController");
const notificationController = require("./notificationController");
const schedulerController = require("./schedulerController");
const {
  prepareThemeForPublish,
  installThemeFromRegistry,
  getThemePublishPreview,
} = require("./themeRegistryController");
const { prepareWidgetForPublish } = require("./widgetRegistryController");
const {
  assignRoles,
  matchTailwindFamily,
  generateThemeFromPalette,
} = require("./paletteToThemeMapper");
const mcpDashServerController = require("./mcpDashServerController");

module.exports = {
  showDialog,
  fileChosenError,
  isEncryptionAvailable,
  saveData,
  getData,
  listWorkspacesForApplication,
  saveWorkspaceForApplication,
  deleteWorkspaceForApplication,
  saveThemeForApplication,
  listThemesForApplication,
  deleteThemeForApplication,
  convertJsonToCsvFile,
  convertJsonToCsvString,
  parseXMLStream,
  parseCSVStream,
  readLinesFromFile,
  saveToFile,
  readFromFile,
  saveSettingsForApplication,
  getSettingsForApplication,
  transformFile,
  readJSONFromFile,
  readDataFromURL,
  extractColorsFromImageURL,
  saveProvider,
  listProviders,
  getProvider,
  deleteProvider,
  getDataDirectory,
  setDataDirectory,
  migrateDataDirectory,
  listIndices,
  partialUpdateObjectsFromDirectory,
  createBatchesFromFile,
  browseObjectsToFile,
  describeImage,
  saveMenuItemForApplication,
  listMenuItemsForApplication,
  pluginInstall,
  searchIndex,
  exportDashboardConfig,
  selectDashboardFile,
  importDashboardConfig,
  installDashboardFromRegistry,
  checkCompatibility,
  prepareDashboardForPublish,
  collectDashboardDependencies,
  getDashboardPublishPlan,
  getDashboardPreview,
  checkDashboardUpdatesForApp,
  getProviderSetupManifest,
  getDashboardPublishPreview,
  saveDashboardRating,
  getDashboardRating,
  listDashboardRatings,
  deleteDashboardRating,
  enrichPackagesWithRatings,
  initiateDeviceFlow,
  pollForToken,
  getRegistryToken,
  getRegistryAuthStatus,
  getRegistryProfile,
  updateRegistryProfile,
  getRegistryPackages,
  updateRegistryPackage,
  clearRegistryToken,
  publishToRegistry,
  getRegistryUrl,
  getRecentDashboards,
  addRecentDashboard,
  clearRecentDashboards,
  getSessionState,
  saveSessionState,
  clearSessionState,
  notificationController,
  schedulerController,
  prepareThemeForPublish,
  installThemeFromRegistry,
  getThemePublishPreview,
  prepareWidgetForPublish,
  assignRoles,
  matchTailwindFamily,
  generateThemeFromPalette,
  mcpDashServerController,
};
