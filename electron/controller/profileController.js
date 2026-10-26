/**
 * profileController.js
 *
 * Profiles (see profile/profileStore.js): list, create, rename, delete and
 * switch. A profile is a list of the dashboards, folders, themes and bots
 * it holds; switching changes what every list shows and which bots run.
 * dash-electron reloads the window after a switch.
 */
const { getFileContents } = require("../utils/file");
const { getAppFilePath } = require("../utils/appPaths");
const profileStore = require("../profile/profileStore");

// Everything that exists now — written into Default when the first extra
// profile is created, so Default keeps holding all of it.
function currentItems(appId, botController) {
  const workspaces = getFileContents(getAppFilePath(appId, "workspaces.json"));
  const folders = getFileContents(getAppFilePath(appId, "menuItems.json"));
  const themes = getFileContents(getAppFilePath(appId, "themes.json"), {});
  let bots = [];
  try {
    bots = botController && botController._ready ? botController.list() : [];
  } catch (_e) {
    bots = [];
  }
  const ids = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((x) => x && x.id != null)
      .map((x) => x.id);
  return {
    dashboards: ids(workspaces),
    folders: ids(folders),
    themes: Object.keys(themes || {}),
    bots: ids(bots),
  };
}

function botControllerOrNull() {
  try {
    return require("./botController");
  } catch (_e) {
    return null;
  }
}

function fail(e) {
  return { success: false, error: e.message };
}

const profileController = {
  listProfiles(appId) {
    try {
      return {
        success: true,
        profiles: profileStore.list(appId),
        activeProfileId: profileStore.getActiveProfileId(appId),
      };
    } catch (e) {
      return fail(e);
    }
  },

  getActiveProfile(appId) {
    try {
      return { success: true, profile: profileStore.getActive(appId) };
    } catch (e) {
      return fail(e);
    }
  },

  createProfile(appId, name) {
    try {
      const defaultItems = profileStore.hasProfiles(appId)
        ? undefined
        : currentItems(appId, botControllerOrNull());
      const profile = profileStore.create(appId, name, { defaultItems });
      return { success: true, profile };
    } catch (e) {
      return fail(e);
    }
  },

  renameProfile(appId, profileId, name) {
    try {
      return {
        success: true,
        profile: profileStore.rename(appId, profileId, name),
      };
    } catch (e) {
      return fail(e);
    }
  },

  deleteProfile(appId, profileId) {
    try {
      return profileStore.remove(appId, profileId);
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * Make a profile active and bring the bots in line: the new profile's
   * bots are scheduled, the old profile's stop. The caller reloads the
   * window so every list re-reads.
   */
  switchProfile(appId, profileId, { botController } = {}) {
    try {
      const profile = profileStore.setActive(appId, profileId);
      const bots = botController || botControllerOrNull();
      if (bots && typeof bots.applyActiveProfile === "function") {
        bots.applyActiveProfile();
      }
      return { success: true, profile };
    } catch (e) {
      return fail(e);
    }
  },
};

module.exports = profileController;
