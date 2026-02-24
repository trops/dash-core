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
} = require("./algoliaController");
const { describeImage } = require("./openaiController");
const {
    saveMenuItemForApplication,
    listMenuItemsForApplication,
} = require("./menuItemsController");
const { install: pluginInstall } = require("./pluginController");

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
};
