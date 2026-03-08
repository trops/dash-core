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
  importDashboardConfig,
  installDashboardFromRegistry,
  checkCompatibility,
  prepareDashboardForPublish,
  getDashboardPreview,
  checkDashboardUpdatesForApp,
  getProviderSetupManifest,
} = require("./dashboardConfigController");
const {
  initiateDeviceFlow,
  pollForToken,
  getStoredToken: getRegistryToken,
  getAuthStatus: getRegistryAuthStatus,
  getRegistryProfile,
  clearToken: clearRegistryToken,
} = require("./registryAuthController");
const {
  publishToRegistry,
  getRegistryUrl,
} = require("./registryApiController");
const {
  saveDashboardRating,
  getDashboardRating,
  listDashboardRatings,
  deleteDashboardRating,
  enrichPackagesWithRatings,
} = require("./dashboardRatingsController");

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
  importDashboardConfig,
  installDashboardFromRegistry,
  checkCompatibility,
  prepareDashboardForPublish,
  getDashboardPreview,
  checkDashboardUpdatesForApp,
  getProviderSetupManifest,
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
  clearRegistryToken,
  publishToRegistry,
  getRegistryUrl,
};
