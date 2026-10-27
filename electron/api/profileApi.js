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
  PROFILE_DUPLICATE,
  PROFILE_LIST_CONTENTS,
  PROFILE_SET_MEMBERSHIP,
  PROFILE_PREVIEW_SAVE,
  PROFILE_SAVE_FILE,
  PROFILE_PUBLISH_WIDGET,
  PROFILE_PREVIEW_LOAD,
  PROFILE_APPLY_LOAD,
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
  /** A new profile holding the same dashboards, bots, folders and themes. */
  duplicate: (appId, profileId, name) =>
    ipcRenderer.invoke(PROFILE_DUPLICATE, { appId, profileId, name }),
  /**
   * { contents: { dashboards, bots, folders, themes }, hasProfiles } —
   * every item on this computer with inProfile + alsoIn (other profiles).
   */
  listContents: (appId, profileId) =>
    ipcRenderer.invoke(PROFILE_LIST_CONTENTS, { appId, profileId }),
  /** Put an item in a profile (include) or take it out of just that one. */
  setMembership: (appId, profileId, kind, id, include) =>
    ipcRenderer.invoke(PROFILE_SET_MEMBERSHIP, {
      appId,
      profileId,
      kind,
      id,
      include,
    }),
  /**
   * What "Save to file" would write: { counts, widgets: [{ package,
   * version, source, status, registryVersion }], bundledBytes, signedIn }.
   * options: { bots, providers, settings } (all on by default).
   */
  previewSave: (appId, profileId, options) =>
    ipcRenderer.invoke(PROFILE_PREVIEW_SAVE, { appId, profileId, options }),
  /** Save to a .dashprofile file; the main process shows the save dialog. */
  saveFile: (appId, profileId, options) =>
    ipcRenderer.invoke(PROFILE_SAVE_FILE, { appId, profileId, options }),
  /**
   * Publish one of the profile's widgets to the signed-in user's account
   * (from the Save dialog). Resolves { success, status: "published" |
   * "needs-confirmation" | "failed", publishedAs, version,
   * dashboardsSwitched, error, findings }.
   * options: { confirmPersonalPaths }
   */
  publishWidget: (appId, profileId, packageName, options) =>
    ipcRenderer.invoke(PROFILE_PUBLISH_WIDGET, {
      appId,
      profileId,
      packageName,
      options,
    }),
  /**
   * Pick a .dashprofile (the main process shows the open dialog) and get
   * what loading it would do: { token, target, items, widgets, providers,
   * settings } — or { canceled }.
   */
  previewLoad: (appId) => ipcRenderer.invoke(PROFILE_PREVIEW_LOAD, { appId }),
  /**
   * Load the file previewLoad opened. choices: { asNew, name, useFile,
   * widgets, applySettings }.
   */
  applyLoad: (appId, token, choices) =>
    ipcRenderer.invoke(PROFILE_APPLY_LOAD, { appId, token, choices }),
};

module.exports = profileApi;
