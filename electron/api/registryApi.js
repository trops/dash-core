/**
 * registryApi.js
 *
 * Frontend API for the widget registry/marketplace.
 * Wraps IPC calls to the registryController in the main process.
 *
 * Usage:
 * mainApi.registry.search("weather")
 * mainApi.registry.getPackage("weather-widgets")
 * mainApi.registry.fetchIndex(true)
 * mainApi.registry.checkUpdates([{ name: "weather-widgets", version: "1.0.0" }])
 */

const { ipcRenderer } = require("electron");

const registryApi = {
  /**
   * Fetch the registry index (uses cache with 5-min TTL)
   * @param {boolean} forceRefresh - Force a fresh fetch bypassing cache
   * @returns {Promise<Object>} The registry index
   */
  fetchIndex: async (forceRefresh = false) => {
    try {
      return await ipcRenderer.invoke("registry:fetch-index", forceRefresh);
    } catch (error) {
      console.error("[RegistryApi] Error fetching index:", error);
      throw error;
    }
  },

  /**
   * Search the registry for packages and widgets
   * @param {string} query - Search query
   * @param {Object} filters - Optional filters { category, author, tag }
   * @returns {Promise<Object>} { packages: [...], totalWidgets: number }
   */
  search: async (query = "", filters = {}) => {
    try {
      return await ipcRenderer.invoke("registry:search", query, filters);
    } catch (error) {
      console.error("[RegistryApi] Error searching registry:", error);
      throw error;
    }
  },

  /**
   * Get a specific package by name
   * @param {string} packageName - Name of the package
   * @returns {Promise<Object|null>} Package data or null
   */
  getPackage: async (packageName) => {
    try {
      return await ipcRenderer.invoke("registry:get-package", packageName);
    } catch (error) {
      console.error(
        `[RegistryApi] Error getting package ${packageName}:`,
        error,
      );
      throw error;
    }
  },

  /**
   * Check for updates to installed widgets
   * @param {Array<Object>} installedWidgets - Array of { name, version }
   * @returns {Promise<Array<Object>>} Widgets with available updates
   */
  checkUpdates: async (installedWidgets = []) => {
    try {
      return await ipcRenderer.invoke(
        "registry:check-updates",
        installedWidgets,
      );
    } catch (error) {
      console.error("[RegistryApi] Error checking updates:", error);
      throw error;
    }
  },

  /**
   * Search the registry for dashboard packages only
   * @param {string} query - Search query
   * @param {Object} filters - Optional filters { category, author, tag, compatibleWidgets }
   * @returns {Promise<Object>} { packages: [...], totalWidgets: number }
   */
  searchDashboards: async (query = "", filters = {}) => {
    try {
      return await ipcRenderer.invoke(
        "registry:search-dashboards",
        query,
        filters,
      );
    } catch (error) {
      console.error("[RegistryApi] Error searching dashboards:", error);
      throw error;
    }
  },

  /**
   * Search the registry for theme packages only
   * @param {string} query - Search query
   * @param {Object} filters - Optional filters { category, author, tag }
   * @returns {Promise<Object>} { packages: [...], totalWidgets: number }
   */
  searchThemes: async (query = "", filters = {}) => {
    try {
      return await ipcRenderer.invoke("registry:search-themes", query, filters);
    } catch (error) {
      console.error("[RegistryApi] Error searching themes:", error);
      throw error;
    }
  },

  /**
   * Publish a widget package to the registry.
   *
   * Zips the widget directory (source files, not dist/), generates a
   * registry manifest from package.json + .dash.js configs, optionally
   * bumps the version, and POSTs to /api/publish.
   *
   * @param {string} appId - Application identifier
   * @param {string} packageId - Widget packageId (e.g. "@scope/name")
   * @param {Object} options - { bump?, version?, visibility?, description?,
   *                             tags?, icon?, category?, authorName? }
   * @returns {Promise<Object>} { success, manifest, registryResult, previousVersion, newVersion, error? }
   */
  publishWidget: async (appId, packageId, options = {}) => {
    try {
      return await ipcRenderer.invoke("registry:publish-widget", {
        appId,
        packageId,
        options,
      });
    } catch (error) {
      console.error("[RegistryApi] Error publishing widget:", error);
      throw error;
    }
  },

  /**
   * Inspect a locally-installed widget package and return its metadata
   * + list of component widgets. Used by the publish modal to show
   * "what's getting published" before the user hits Publish.
   *
   * @param {string} packageId - Widget packageId (e.g. "@scope/name")
   * @returns {Promise<Object>} { success, packageId, localScope, name, version, displayName, description, components: [{name, displayName, description, icon}] }
   */
  inspectWidgetPackage: async (packageId) => {
    try {
      return await ipcRenderer.invoke("registry:inspect-widget-package", {
        packageId,
      });
    } catch (error) {
      console.error("[RegistryApi] Error inspecting package:", error);
      throw error;
    }
  },

  /**
   * Fetch a registry package's source (component + config + bundle) into a
   * temp directory and return the source strings without installing the
   * package. Used by read-only preview flows (e.g. the Widget Builder's
   * Discover tab).
   *
   * @param {string} packageName - Name of the package (any form)
   * @returns {Promise<Object>} { componentCode, configCode, bundleSource, widgetName, displayName, description, packageName, scope, downloadUrl }
   */
  previewFetch: async (packageName) => {
    try {
      return await ipcRenderer.invoke("registry:preview-fetch", packageName);
    } catch (error) {
      console.error(
        `[RegistryApi] Error fetching preview source for ${packageName}:`,
        error,
      );
      throw error;
    }
  },
};

module.exports = registryApi;
