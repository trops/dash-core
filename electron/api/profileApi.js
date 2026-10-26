/**
 * profileApi.js
 *
 * IPC bridge for profiles (renderer side).
 * Exposed via contextBridge as `window.mainApi.profiles`.
 *
 * Every call resolves with `{ success, ... }` or `{ success: false, error }`.
 */
const { ipcRenderer } = require("electron");
const {
  PROFILE_LIST,
  PROFILE_GET_ACTIVE,
  PROFILE_CREATE,
  PROFILE_RENAME,
  PROFILE_DELETE,
  PROFILE_SWITCH,
} = require("../events");

const profileApi = {
  /** { profiles: [{ id, name, items }], activeProfileId } */
  list: (appId) => ipcRenderer.invoke(PROFILE_LIST, { appId }),
  getActive: (appId) => ipcRenderer.invoke(PROFILE_GET_ACTIVE, { appId }),
  create: (appId, name) => ipcRenderer.invoke(PROFILE_CREATE, { appId, name }),
  rename: (appId, profileId, name) =>
    ipcRenderer.invoke(PROFILE_RENAME, { appId, profileId, name }),
  delete: (appId, profileId) =>
    ipcRenderer.invoke(PROFILE_DELETE, { appId, profileId }),
  /** Switches, then the main process reloads the window. */
  switch: (appId, profileId) =>
    ipcRenderer.invoke(PROFILE_SWITCH, { appId, profileId }),
};

module.exports = profileApi;
