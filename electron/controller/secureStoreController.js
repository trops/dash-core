/**
 * secureStoreController
 *
 * Thin wrapper around Electron's `safeStorage` for renderer-side
 * encryption checks. The `saveData` / `getData` helpers that previously
 * lived here were unwired (no IPC handler in dash-electron) and
 * lacked per-widget scoping; they were removed alongside their
 * widget-facing API entries. See `electron/api/secureStoreApi.js`
 * and the regression-pin in `secureStoreApi.test.js`.
 *
 * Provider credential encryption uses `safeStorage.encryptString` /
 * `decryptString` directly inside `providerController` — that's the
 * only internal caller and stays unchanged.
 */
const { safeStorage } = require("electron");
const events = require("../events");

const isEncryptionAvailable = (win) => {
  const result = safeStorage.isEncryptionAvailable();
  win.webContents.send(events.SECURE_STORE_ENCRYPTION_CHECK_COMPLETE, result);
};

const encryptString = (win, str) => {
  const result = safeStorage.encryptString(str);
  win.webContents.send("secure-storage-encrypt-string-complete", result);
};

const decryptString = (win, str) => {
  const result = safeStorage.decryptString(str);
  win.webContents.send("secure-storage-decrypt-string-complete", result);
};

module.exports = {
  isEncryptionAvailable,
  encryptString,
  decryptString,
};
