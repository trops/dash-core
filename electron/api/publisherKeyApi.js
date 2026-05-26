/**
 * publisherKeyApi.js
 *
 * IPC bridge for publisher signing keys (renderer side).
 * Exposed via contextBridge through `window.mainApi.publisherKey`.
 */
const { ipcRenderer } = require("electron");
const {
  PUBLISHER_KEY_GET_OR_CREATE,
  PUBLISHER_KEY_DESCRIBE,
  PUBLISHER_KEY_REVOKE,
} = require("../events");

const publisherKeyApi = {
  /**
   * Get the local publisher signing key, generating + registering one
   * with the registry on first call. Returns:
   *   { keyId, fingerprint, publicKey, machineLabel, createdAt,
   *     hasCert, certExpiresAt, generated }
   *
   * `generated: true` on the very first call (use this to gate a
   * one-time disclosure modal). Subsequent calls return `generated: false`.
   *
   * Rejects with `{ authRequired: true }` if not signed in to the
   * registry; with a generic error otherwise.
   */
  getOrCreate: () => ipcRenderer.invoke(PUBLISHER_KEY_GET_OR_CREATE),

  /**
   * Summary of the current local key (or null). Does not trigger
   * registration — purely read-only.
   */
  describe: () => ipcRenderer.invoke(PUBLISHER_KEY_DESCRIBE),

  /**
   * Revoke the local key on the registry and clear it from disk.
   * Next publish will auto-generate a fresh keypair.
   */
  revoke: () => ipcRenderer.invoke(PUBLISHER_KEY_REVOKE),
};

module.exports = publisherKeyApi;
