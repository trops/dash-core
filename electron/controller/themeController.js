const { writeFileSync } = require("fs");
const events = require("../events");
const { getFileContents } = require("../utils/file");
const { getAppFilePath } = require("../utils/appPaths");
const {
  hasProfiles,
  filterKeysToActive,
  filterToActive,
  addToActive,
  removeEverywhere,
} = require("../profile/profileMembership");

const configFilename = "themes.json";

// A profile shows its own themes, any theme its dashboards use, and the
// app theme (settings are shared), so nothing on screen loses its theme.
function themesForActiveProfile(appId, themes) {
  if (!hasProfiles(appId)) return themes;
  const workspaces = getFileContents(getAppFilePath(appId, "workspaces.json"));
  const used = filterToActive(
    appId,
    "dashboards",
    Array.isArray(workspaces) ? workspaces : [],
    (w) => w.id,
  )
    .map((w) => w.themeKey)
    .filter(Boolean);
  const appTheme = require("./settingsController").getSettingsForApplication(
    null,
  )?.settings?.theme;
  if (appTheme) used.push(appTheme);
  return filterKeysToActive(appId, "themes", themes, used);
}

const themeController = {
  /**
   * saveTheme
   * Create a new Theme that can be used in the application
   * (can have several themes per application)
   *
   * @param {BrowserWindow} win the main window
   * @param {string} appId the application id
   * @param {object} themeObject the theme object
   */
  saveThemeForApplication: (win, appId, name, obj) => {
    try {
      // filename to the pages file (live pages)
      const filename = getAppFilePath(appId, configFilename);
      const data = getFileContents(filename, {});

      // Add/update the theme based on the name
      if (name in data === false) {
        data[name] = {};
      }

      data[name] = obj;

      // write the new pages configuration back to the file
      writeFileSync(filename, JSON.stringify(data, null, 2));
      addToActive(appId, "themes", name);

      console.log("[themeController] Theme saved successfully");

      // Return the data for ipcMain.handle() - modern promise-based approach
      return {
        themes: themesForActiveProfile(appId, data),
        key: name,
        theme: obj,
        success: true,
      };
    } catch (e) {
      console.error("[themeController] Error saving theme:", e);
      // Return error object
      return {
        error: true,
        message: e.message,
        themes: {},
      };
    }
  },

  /**
   * listThemesForApplication
   *
   * @param {BrowserWindow} win the main window
   * @param {string} appId the application id from Algolia
   */
  listThemesForApplication: (win, appId) => {
    try {
      const filename = getAppFilePath(appId, configFilename);

      const data = themesForActiveProfile(appId, getFileContents(filename, {}));

      console.log(
        "[themeController] Loading themes from:",
        filename,
        "Found:",
        Object.keys(data).length,
        "themes",
      );

      // Return the data for ipcMain.handle() - modern promise-based approach
      return {
        themes: data,
      };
    } catch (e) {
      console.error("[themeController] Error loading themes:", e);
      // Return error object with empty themes
      return {
        error: true,
        message: e.message,
        themes: {},
      };
    }
  },

  /**
   * deleteThemeForApplication
   * Delete a theme from the application's theme configuration
   *
   * @param {BrowserWindow} win the main window
   * @param {string} appId the application id
   * @param {string} themeKey the key of the theme to delete
   */
  deleteThemeForApplication: (win, appId, themeKey) => {
    try {
      const filename = getAppFilePath(appId, configFilename);
      const data = getFileContents(filename, {});

      if (themeKey in data) {
        delete data[themeKey];
        writeFileSync(filename, JSON.stringify(data, null, 2));
      }
      removeEverywhere(appId, "themes", themeKey);

      console.log("[themeController] Theme deleted successfully:", themeKey);

      return {
        themes: themesForActiveProfile(appId, data),
        success: true,
      };
    } catch (e) {
      console.error("[themeController] Error deleting theme:", e);
      return {
        error: true,
        message: e.message,
        themes: {},
      };
    }
  },
};

module.exports = themeController;
