const { ipcRenderer } = require("electron");
const { SECURE_STORE_ENCRYPTION_CHECK } = require("../events");
/**
 * secureStoreApi
 *
 * Renderer-facing wrapper for the secure-store IPC channels. Currently
 * exposes only `isEncryptionAvailable` because that's the only channel
 * with a wired handler in dash-electron's main process.
 *
 * `saveData` / `getData` were removed in this slice — the IPC handlers
 * for `SECURE_STORE_SET_DATA` / `SECURE_STORE_GET_DATA` were never
 * registered, so the methods silently no-op'd. Worse, they appeared
 * usable on `mainApi.secureStore` but had no widgetId scoping, so
 * adding handlers later would have given every widget unscoped access
 * to every other widget's keys. If you need a widget-facing storage
 * API in the future, add a `widgetId` parameter and plumb it through a
 * per-widget gate (see `electron/security/fsGate.js` for the pattern).
 * The pin in `secureStoreApi.test.js` will fail loudly if the
 * unscoped methods reappear without a gate.
 */
const secureStoreApi = {
  isEncryptionAvailable: () =>
    ipcRenderer.invoke(SECURE_STORE_ENCRYPTION_CHECK, {}),
};

module.exports = secureStoreApi;
