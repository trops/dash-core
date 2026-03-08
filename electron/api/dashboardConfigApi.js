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
  DASHBOARD_CONFIG_INSTALL,
  DASHBOARD_CONFIG_COMPATIBILITY,
  DASHBOARD_CONFIG_PUBLISH,
  DASHBOARD_CONFIG_PREVIEW,
  DASHBOARD_CONFIG_CHECK_UPDATES,
  DASHBOARD_CONFIG_PROVIDER_SETUP,
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

  /**
   * Install a dashboard from the registry by package name.
   * Fetches the dashboard ZIP, validates config, installs widgets,
   * creates workspace, and applies event wiring.
   *
   * @param {string} appId - Application identifier
   * @param {string} packageName - Registry package name
   * @returns {Promise<Object>} Result with success, workspace, and summary
   */
  installDashboardFromRegistry: (appId, packageName) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_INSTALL, {
      appId,
      packageName,
    }),

  /**
   * Check compatibility of a dashboard config against installed widgets.
   *
   * @param {string} appId - Application identifier
   * @param {Array} dashboardWidgets - Widget dependencies from dashboard config
   * @returns {Promise<Object>} Compatibility report with per-widget status
   */
  checkDashboardCompatibility: (appId, dashboardWidgets) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_COMPATIBILITY, {
      appId,
      dashboardWidgets,
    }),

  /**
   * Prepare a dashboard for publishing to the registry.
   * Validates shareable status, checks widgets exist in registry,
   * generates manifest, and saves a publish-ready ZIP.
   *
   * @param {string} appId - Application identifier
   * @param {number|string} workspaceId - Workspace to publish
   * @param {Object} options - Publishing options (authorName, authorId, description, tags, icon, githubUser, category)
   * @returns {Promise<Object>} Result with success, manifest, filePath
   */
  prepareDashboardForPublish: (appId, workspaceId, options = {}) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_PUBLISH, {
      appId,
      workspaceId,
      options,
    }),

  /**
   * Get a preview of a dashboard package from the registry.
   * Returns structured preview data and compatibility report.
   *
   * @param {string} packageName - Registry package name
   * @returns {Promise<Object>} Preview with metadata, widgets, wiring, compatibility
   */
  getDashboardPreview: (packageName) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_PREVIEW, { packageName }),

  /**
   * Check installed dashboards for available updates.
   *
   * @param {string} appId - Application identifier
   * @returns {Promise<Object>} Result with updates array
   */
  checkDashboardUpdates: (appId) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_CHECK_UPDATES, { appId }),

  /**
   * Get provider setup manifest for a dashboard's requirements.
   *
   * @param {string} appId - Application identifier
   * @param {Array} requiredProviders - Provider requirements from dashboard config
   * @returns {Promise<Object>} Setup manifest with per-provider status
   */
  getProviderSetupManifest: (appId, requiredProviders) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_PROVIDER_SETUP, {
      appId,
      requiredProviders,
    }),
};

module.exports = dashboardConfigApi;
