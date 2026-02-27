/**
 * clientCacheApi.js
 *
 * Renderer-side API for cache management.
 * Communicates with main process via IPC to invalidate cached clients
 * and manage the response cache.
 */
const { ipcRenderer } = require("electron");
const {
  CLIENT_CACHE_INVALIDATE,
  CLIENT_CACHE_INVALIDATE_ALL,
  RESPONSE_CACHE_CLEAR,
  RESPONSE_CACHE_STATS,
} = require("../events");

const clientCacheApi = {
  /**
   * Invalidate a specific cached client by provider identity.
   *
   * @param {string} appId - the application id
   * @param {string} providerName - the provider name to invalidate
   * @returns {Promise<{success: boolean}>}
   */
  invalidate: (appId, providerName) =>
    ipcRenderer.invoke(CLIENT_CACHE_INVALIDATE, { appId, providerName }),

  /**
   * Invalidate all cached clients.
   *
   * @returns {Promise<{success: boolean}>}
   */
  invalidateAll: () => ipcRenderer.invoke(CLIENT_CACHE_INVALIDATE_ALL),

  /**
   * Clear the response cache.
   *
   * @returns {Promise<{success: boolean}>}
   */
  clearResponseCache: () => ipcRenderer.invoke(RESPONSE_CACHE_CLEAR),

  /**
   * Get response cache statistics.
   *
   * @returns {Promise<{entries: number, inflight: number, keys: string[]}>}
   */
  responseCacheStats: () => ipcRenderer.invoke(RESPONSE_CACHE_STATS),
};

module.exports = clientCacheApi;
