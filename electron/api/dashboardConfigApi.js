/**
 * dashboardConfigApi.js
 *
 * IPC bridge for dashboard config export/import (renderer side).
 * Exposed via contextBridge through mainApi.
 */
const { ipcRenderer } = require("electron");
const {
    DASHBOARD_CONFIG_EXPORT,
    DASHBOARD_CONFIG_IMPORT,
} = require("../events");

const dashboardConfigApi = {
    /**
     * Export a workspace as a dashboard config ZIP file.
     *
     * @param {string} appId - Application identifier
     * @param {number|string} workspaceId - ID of the workspace to export
     * @param {Object} options - Export options (authorName, authorId, description, tags, icon)
     * @returns {Promise<Object>} Result with success, filePath, and config
     */
    exportDashboardConfig: (appId, workspaceId, options = {}) =>
        ipcRenderer.invoke(DASHBOARD_CONFIG_EXPORT, {
            appId,
            workspaceId,
            options,
        }),

    /**
     * Import a dashboard config from a ZIP file.
     * Shows a file picker, validates the config, installs missing widgets,
     * creates the workspace, and applies event wiring.
     *
     * @param {string} appId - Application identifier
     * @returns {Promise<Object>} Result with success, workspace, and summary
     */
    importDashboardConfig: (appId) =>
        ipcRenderer.invoke(DASHBOARD_CONFIG_IMPORT, { appId }),
};

module.exports = dashboardConfigApi;
