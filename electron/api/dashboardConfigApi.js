/**
 * dashboardConfigApi.js
 *
 * IPC bridge for dashboard config export/import (renderer side).
 * Exposed via contextBridge through mainApi.
 */
const { ipcRenderer } = require("electron");
const {
  DASHBOARD_CONFIG_EXPORT,
  DASHBOARD_CONFIG_SELECT_FILE,
  DASHBOARD_CONFIG_IMPORT,
  DASHBOARD_CONFIG_INSTALL,
  DASHBOARD_CONFIG_COMPATIBILITY,
  DASHBOARD_CONFIG_PUBLISH,
  DASHBOARD_CONFIG_PREVIEW,
  DASHBOARD_CONFIG_CHECK_UPDATES,
  DASHBOARD_CONFIG_PROVIDER_SETUP,
  DASHBOARD_CONFIG_PUBLISH_PREVIEW,
  DASHBOARD_CONFIG_INSTALL_PROGRESS,
  DASHBOARD_CONFIG_COLLECT_DEPENDENCIES,
  DASHBOARD_CONFIG_PUBLISH_PLAN,
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
   * Select and preview a dashboard ZIP file without importing it.
   * Opens the file picker, validates the config, and returns a preview
   * with the file path for later import.
   *
   * @returns {Promise<Object>} Result with success, filePath, and dashboardConfig preview
   */
  selectDashboardFile: () => ipcRenderer.invoke(DASHBOARD_CONFIG_SELECT_FILE),

  /**
   * Import a dashboard config from a ZIP file.
   * Shows a file picker (or uses options.filePath), validates the config,
   * installs missing widgets, creates the workspace, and applies event wiring.
   *
   * @param {string} appId - Application identifier
   * @param {Object} options - Import options (filePath, name, menuId, themeKey)
   * @returns {Promise<Object>} Result with success, workspace, and summary
   */
  importDashboardConfig: (appId, options = {}) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_IMPORT, { appId, ...options }),

  /**
   * Install a dashboard from the registry by package name.
   * Fetches the dashboard ZIP, validates config, installs widgets,
   * creates workspace, and applies event wiring.
   *
   * @param {string} appId - Application identifier
   * @param {string} packageName - Registry package name
   * @param {Object} [options]
   * @param {string} [options.name] - Override the workspace name
   *   (defaults to the publisher's name). Does NOT change the
   *   published scope.
   * @param {string|number} [options.menuId] - Override the destination
   *   folder. Defaults to the publisher's menuId.
   * @returns {Promise<Object>} Result with success, workspace, and summary
   */
  installDashboardFromRegistry: (appId, packageName, options = {}) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_INSTALL, {
      appId,
      packageName,
      options,
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
   * Collect enriched widget + theme dependency info for a workspace.
   * Used by the batch-publish dialog to build its dependency table.
   *
   * Returns local state only — the caller is responsible for enriching
   * with registry state (ownership, latest published version, visibility).
   *
   * @param {string} appId - Application identifier
   * @param {number|string} workspaceId - Workspace ID
   * @param {Object} options - { componentConfigs?: Object }
   * @returns {Promise<Object>} { success, widgets, theme }
   */
  collectDashboardDependencies: (appId, workspaceId, options = {}) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_COLLECT_DEPENDENCIES, {
      appId,
      workspaceId,
      options,
    }),

  /**
   * Build an enriched dependency plan for batch-publishing a dashboard.
   * Merges local dep info with registry state (existence, version,
   * visibility, ownership) so the UI can decorate each row.
   *
   * @param {string} appId - Application identifier
   * @param {number|string} workspaceId - Workspace ID
   * @param {Object} options - { componentConfigs?: Object }
   * @returns {Promise<Object>} { success, widgets, theme, registryError? }
   */
  getDashboardPublishPlan: (appId, workspaceId, options = {}) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_PUBLISH_PLAN, {
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

  /**
   * Get a publish preview for a dashboard workspace.
   * Returns widget names and package info without creating a ZIP or uploading.
   *
   * @param {string} appId - Application identifier
   * @param {number|string} workspaceId - Workspace to preview
   * @returns {Promise<Object>} Preview with dashboardName, widgetCount, widgets, componentNames
   */
  getPublishPreview: (appId, workspaceId) =>
    ipcRenderer.invoke(DASHBOARD_CONFIG_PUBLISH_PREVIEW, {
      appId,
      workspaceId,
    }),

  /**
   * Listen for dashboard install progress events.
   * Emitted per-widget during dashboard installation.
   *
   * @param {Function} callback - (data: {packageName, displayName, status, index, total, error?})
   * @returns {Function} removeListener cleanup function
   */
  onInstallProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(DASHBOARD_CONFIG_INSTALL_PROGRESS, handler);
    return () =>
      ipcRenderer.removeListener(DASHBOARD_CONFIG_INSTALL_PROGRESS, handler);
  },
};

module.exports = dashboardConfigApi;
