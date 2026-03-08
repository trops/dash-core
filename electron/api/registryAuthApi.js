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
};

module.exports = registryAuthApi;
