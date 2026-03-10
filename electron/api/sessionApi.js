/**
 * sessionApi.js
 *
 * IPC bridge for session management (renderer side).
 * Exposed via contextBridge through mainApi.
 */
const { ipcRenderer } = require("electron");
const {
  SESSION_GET_RECENTS,
  SESSION_ADD_RECENT,
  SESSION_CLEAR_RECENTS,
  SESSION_GET_STATE,
  SESSION_SAVE_STATE,
  SESSION_CLEAR_STATE,
} = require("../events");

const sessionApi = {
  /**
   * Get recently opened dashboards.
   *
   * @returns {Promise<Array<{ workspaceId: string, name: string, openedAt: string }>>}
   */
  getRecents: () => ipcRenderer.invoke(SESSION_GET_RECENTS),

  /**
   * Add a recent dashboard entry.
   *
   * @param {string} workspaceId
   * @param {string} name
   * @returns {Promise<Array>} Updated recents list
   */
  addRecent: (workspaceId, name) =>
    ipcRenderer.invoke(SESSION_ADD_RECENT, { workspaceId, name }),

  /**
   * Clear all recent dashboards.
   */
  clearRecents: () => ipcRenderer.invoke(SESSION_CLEAR_RECENTS),

  /**
   * Get saved session state.
   *
   * @returns {Promise<{ openTabIds: string[], activeTabId: string | null } | null>}
   */
  getState: () => ipcRenderer.invoke(SESSION_GET_STATE),

  /**
   * Save session state.
   *
   * @param {string[]} openTabIds
   * @param {string|null} activeTabId
   */
  saveState: (openTabIds, activeTabId) =>
    ipcRenderer.invoke(SESSION_SAVE_STATE, { openTabIds, activeTabId }),

  /**
   * Clear saved session state.
   */
  clearState: () => ipcRenderer.invoke(SESSION_CLEAR_STATE),
};

module.exports = sessionApi;
