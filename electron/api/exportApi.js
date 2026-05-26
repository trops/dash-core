/**
 * exportApi.js
 *
 * IPC bridge for the Export Everything bundle (renderer side).
 * Exposed via contextBridge as `window.mainApi.export`.
 */
const { ipcRenderer } = require("electron");
const { EXPORT_EVERYTHING } = require("../events");

const exportApi = {
  /**
   * Export workspaces + themes + menu items + providers (sans
   * credentials) as a single ZIP. Opens a native save dialog so the
   * user picks the destination.
   *
   * Resolves with:
   *   { success: true, filePath, counts: {...} }    on success
   *   { success: false, canceled: true }            user dismissed the dialog
   *   { success: false, error: "..." }              anything else
   *
   * @param {string} appId
   * @returns {Promise<Object>}
   */
  exportEverything: (appId) => ipcRenderer.invoke(EXPORT_EVERYTHING, { appId }),
};

module.exports = exportApi;
