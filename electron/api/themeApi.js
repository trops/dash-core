/**
 * themeApi.js
 *
 * Handle the theme configuration file
 */

const { ipcRenderer } = require("electron");

const {
  THEME_LIST,
  THEME_SAVE,
  THEME_DELETE,
  THEME_PUBLISH,
  THEME_INSTALL_FROM_REGISTRY,
  THEME_PUBLISH_PREVIEW,
} = require("../events");

const themeApi = {
  listThemesForApplication: (appId) =>
    ipcRenderer.invoke(THEME_LIST, { appId }),
  saveThemeForApplication: (appId, themeName, themeObject) =>
    ipcRenderer.invoke(THEME_SAVE, { appId, themeName, themeObject }),
  deleteThemeForApplication: (appId, themeKey) =>
    ipcRenderer.invoke(THEME_DELETE, { appId, themeKey }),
  publishTheme: (appId, themeKey, options) =>
    ipcRenderer.invoke(THEME_PUBLISH, { appId, themeKey, options }),
  installThemeFromRegistry: (appId, packageName) =>
    ipcRenderer.invoke(THEME_INSTALL_FROM_REGISTRY, { appId, packageName }),
  getThemePublishPreview: (appId, themeKey) =>
    ipcRenderer.invoke(THEME_PUBLISH_PREVIEW, { appId, themeKey }),
};

module.exports = themeApi;
