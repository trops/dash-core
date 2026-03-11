/**
 * registryAuthApi.js
 *
 * IPC bridge for registry authentication (renderer side).
 * Exposed via contextBridge through mainApi.
 */
const { ipcRenderer } = require("electron");
const {
  REGISTRY_AUTH_INITIATE_LOGIN,
  REGISTRY_AUTH_POLL_TOKEN,
  REGISTRY_AUTH_GET_STATUS,
  REGISTRY_AUTH_GET_PROFILE,
  REGISTRY_AUTH_LOGOUT,
  REGISTRY_AUTH_PUBLISH,
  REGISTRY_AUTH_UPDATE_PROFILE,
  REGISTRY_AUTH_GET_PACKAGES,
  REGISTRY_AUTH_UPDATE_PACKAGE,
  REGISTRY_AUTH_DELETE_PACKAGE,
} = require("../events");

const registryAuthApi = {
  /**
   * Initiate the device code flow for registry login.
   * Returns device code, user code, and verification URL.
   *
   * @returns {Promise<Object>} { deviceCode, userCode, verificationUrl, verificationUrlComplete, expiresIn, interval }
   */
  initiateLogin: () => ipcRenderer.invoke(REGISTRY_AUTH_INITIATE_LOGIN),

  /**
   * Poll for token after user completes browser auth.
   *
   * @param {string} deviceCode - Device code from initiateLogin
   * @returns {Promise<Object>} { status: 'pending' | 'authorized' | 'expired', token?, userId? }
   */
  pollToken: (deviceCode) =>
    ipcRenderer.invoke(REGISTRY_AUTH_POLL_TOKEN, { deviceCode }),

  /**
   * Get current auth status.
   *
   * @returns {Promise<Object>} { authenticated: boolean, userId?: string }
   */
  getStatus: () => ipcRenderer.invoke(REGISTRY_AUTH_GET_STATUS),

  /**
   * Get the authenticated user's registry profile.
   *
   * @returns {Promise<Object|null>} User profile or null
   */
  getProfile: () => ipcRenderer.invoke(REGISTRY_AUTH_GET_PROFILE),

  /**
   * Logout from registry.
   */
  logout: () => ipcRenderer.invoke(REGISTRY_AUTH_LOGOUT),

  /**
   * Publish a ZIP to the registry.
   *
   * @param {string} zipPath - Path to the ZIP file
   * @param {Object} manifest - Package manifest
   * @returns {Promise<Object>} { success, registryUrl, packageId, version, error? }
   */
  publish: (zipPath, manifest) =>
    ipcRenderer.invoke(REGISTRY_AUTH_PUBLISH, { zipPath, manifest }),

  /**
   * Update the authenticated user's profile.
   *
   * @param {Object} updates - Fields to update (e.g. { displayName })
   * @returns {Promise<Object|null>} Updated user or null
   */
  updateProfile: (updates) =>
    ipcRenderer.invoke(REGISTRY_AUTH_UPDATE_PROFILE, updates),

  /**
   * Get the authenticated user's published packages.
   *
   * @returns {Promise<Object|null>} { packages: [...] } or null
   */
  getPackages: () => ipcRenderer.invoke(REGISTRY_AUTH_GET_PACKAGES),

  /**
   * Update a published package's metadata.
   *
   * @param {string} scope - Package scope
   * @param {string} name - Package name
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object|null>} Updated package or null
   */
  updatePackage: (scope, name, updates) =>
    ipcRenderer.invoke(REGISTRY_AUTH_UPDATE_PACKAGE, {
      scope,
      name,
      updates,
    }),

  /**
   * Delete a published package.
   *
   * @param {string} scope - Package scope
   * @param {string} name - Package name
   * @returns {Promise<Object|null>} Response or null
   */
  deletePackage: (scope, name) =>
    ipcRenderer.invoke(REGISTRY_AUTH_DELETE_PACKAGE, { scope, name }),
};

module.exports = registryAuthApi;
