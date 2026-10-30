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
  PROFILE_PUBLISH_PROGRESS,
  PROFILE_PREVIEW_LOAD,
  PROFILE_APPLY_LOAD,
  PROFILE_SAVE_ACCOUNT,
  PROFILE_LIST_ACCOUNT,
  PROFILE_PREVIEW_LOAD_ACCOUNT,
  PROFILE_DELETE_ACCOUNT,
  PROFILE_SYNC_STATUS,
  PROFILE_PLAN_BUILT_PUBLISH,
  PROFILE_PUBLISH_BUILT,
  PROFILE_SET_AUTO_SAVE,
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
   * options: { confirmPersonalPaths, visibility: "public" | "private" }
   *
   * Several at once (bulk publish): pass an array of packages; options
   * { visibility: { [pkg]: "public" | "private" }, confirmPersonalPaths:
   * [pkg] }. Resolves { success, results: [{ package, ...one result }],
   * stopped }, with onPublishProgress events as each one goes.
   */
  publishWidget: (appId, profileId, packageName, options) =>
    ipcRenderer.invoke(PROFILE_PUBLISH_WIDGET, {
      appId,
      profileId,
      packageName,
      options,
    }),
  /** Stop a bulk publish after the widget being published now. */
  stopPublishing: (appId, profileId) =>
    ipcRenderer.invoke(PROFILE_PUBLISH_WIDGET, {
      appId,
      profileId,
      packageName: null,
      options: { stop: true },
    }),
  /**
   * Bulk publish progress: ({ package, index, total, status, result? }) —
   * status "publishing", then the widget's own status when it's done.
   * Returns the unsubscribe function.
   */
  onPublishProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(PROFILE_PUBLISH_PROGRESS, handler);
    return () => ipcRenderer.removeListener(PROFILE_PUBLISH_PROGRESS, handler);
  },
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
  /**
   * Save to the user's account (same options as saveFile, plus asNew).
   * Resolves { success, account: { accountId, revision, savedAt } } — or
   * { conflict: { revision, updatedOn, updatedAt, missing } } when another
   * computer saved it since.
   */
  saveToAccount: (appId, profileId, options) =>
    ipcRenderer.invoke(PROFILE_SAVE_ACCOUNT, { appId, profileId, options }),
  /** { profiles: [{ id, name, revision, updatedAt, updatedOn, linkedTo }] } */
  listAccount: (appId) => ipcRenderer.invoke(PROFILE_LIST_ACCOUNT, { appId }),
  /** Like previewLoad, for a profile in the account; then applyLoad. */
  previewLoadFromAccount: (appId, accountId) =>
    ipcRenderer.invoke(PROFILE_PREVIEW_LOAD_ACCOUNT, { appId, accountId }),
  /** Remove a profile from the account (profiles here stay). */
  deleteFromAccount: (appId, accountId) =>
    ipcRenderer.invoke(PROFILE_DELETE_ACCOUNT, { appId, accountId }),
  /**
   * Each profile here kept in the account, compared with it: { signedIn,
   * profiles: [{ profileId, name, active, accountId, state, changes,
   * account: { revision, updatedOn, updatedAt } }] }. state: "in-sync" |
   * "account-newer" | "local-changed" | "both".
   */
  syncStatus: (appId) => ipcRenderer.invoke(PROFILE_SYNC_STATUS, { appId }),
  /**
   * A widget just built: can it be published, as what, and is it public
   * already — { publishable, publishAs, version, exists, visibility,
   * reason } or { signInRequired }.
   */
  planBuiltPublish: (appId, packageName) =>
    ipcRenderer.invoke(PROFILE_PLAN_BUILT_PUBLISH, { appId, packageName }),
  /**
   * Publish it (private unless options.visibility is "public"); an
   * @ai-built widget becomes the user's and dashboards switch to it.
   * Resolves { success, status: "published" | "needs-confirmation" |
   * "failed", publishedAs, version, dashboardsSwitched, findings, error }.
   * options: { visibility, confirmPersonalPaths }
   */
  publishBuilt: (appId, packageName, options) =>
    ipcRenderer.invoke(PROFILE_PUBLISH_BUILT, { appId, packageName, options }),
  /**
   * How a profile kept in the account saves itself: setting { mode:
   * "manual" | "changes" | "daily", time: "HH:MM" }. Resolves { success,
   * autoSave }. (list() returns each profile's autoSave too.)
   */
  setAutoSave: (appId, profileId, setting) =>
    ipcRenderer.invoke(PROFILE_SET_AUTO_SAVE, { appId, profileId, setting }),
};

module.exports = profileApi;
