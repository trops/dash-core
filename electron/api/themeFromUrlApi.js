/**
 * themeFromUrlApi.js
 *
 * Renderer-side IPC API for theme-from-URL extraction and palette mapping.
 */

const { ipcRenderer } = require("electron");

const {
  THEME_EXTRACT_FROM_URL,
  THEME_MAP_PALETTE_TO_THEME,
} = require("../events");

const themeFromUrlApi = {
  extractFromUrl: (url) => ipcRenderer.invoke(THEME_EXTRACT_FROM_URL, { url }),
  mapPaletteToTheme: (palette, overrides) =>
    ipcRenderer.invoke(THEME_MAP_PALETTE_TO_THEME, { palette, overrides }),
};

module.exports = themeFromUrlApi;
