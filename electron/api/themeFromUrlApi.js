/**
 * themeFromUrlApi.js
 *
 * Renderer-side IPC API for theme-from-URL extraction.
 */

const { ipcRenderer } = require("electron");

const { THEME_EXTRACT_FROM_URL } = require("../events");

const themeFromUrlApi = {
  extractFromUrl: (url) => ipcRenderer.invoke(THEME_EXTRACT_FROM_URL, { url }),
};

module.exports = themeFromUrlApi;
