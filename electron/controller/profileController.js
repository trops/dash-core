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

// Every dashboard, bot, folder and theme on this computer, with a name to
// show — unfiltered, so a profile can be given things it doesn't hold yet.
// The Dash team is shared by every profile and isn't listed.
function allItems(appId, botController) {
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const workspaces = list(
    getFileContents(getAppFilePath(appId, "workspaces.json")),
  );
  const folders = list(
    getFileContents(getAppFilePath(appId, "menuItems.json")),
  );
  const themes = getFileContents(getAppFilePath(appId, "themes.json"), {});
  let bots = [];
  try {
    bots =
      botController && botController._ready
        ? botController._store
            .list()
            .filter((b) => b && b.system !== "dash-team")
        : [];
  } catch (_e) {
    bots = [];
  }
  return {
    dashboards: workspaces
      .filter((w) => w.id != null)
      .map((w) => ({
        id: w.id,
        name: w.name || w.label || "Untitled",
        menuId: w.menuId ?? null,
      })),
    bots: bots.map((b) => ({
      id: b.id,
      name: b.name || "Untitled bot",
      workspaceId: b.workspaceId ?? null,
    })),
    folders: folders
      .filter((f) => f.id != null)
      .map((f) => ({ id: f.id, name: f.name || "Untitled folder" })),
    themes: Object.keys(themes || {}).map((key) => ({
      id: key,
      name: (themes[key] && themes[key].name) || key,
    })),
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

  /** A new profile holding the same items as `profileId`. */
  duplicateProfile(appId, profileId, name) {
    try {
      const firstProfile = !profileStore.hasProfiles(appId);
      const everything = firstProfile
        ? currentItems(appId, botControllerOrNull())
        : undefined;
      const source = firstProfile
        ? { items: everything }
        : profileStore.list(appId).find((p) => p.id === profileId);
      if (!source) throw new Error(`No profile with id ${profileId}`);
      const profile = profileStore.create(appId, name, {
        defaultItems: everything,
        items: source.items,
      });
      return { success: true, profile };
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * Everything on this computer, grouped by kind, each marked with whether
   * `profileId` holds it and which other profiles do. With only Default,
   * Default holds everything.
   */
  listContents(appId, profileId) {
    try {
      const all = allItems(appId, botControllerOrNull());
      const profiles = profileStore.list(appId);
      const explicit = profileStore.hasProfiles(appId);
      const contents = {};
      for (const kind of profileStore.KINDS) {
        contents[kind] = all[kind].map((item) => {
          const key = String(item.id);
          const holders = explicit
            ? profiles.filter((p) => p.items[kind].includes(key))
            : profiles;
          return {
            ...item,
            inProfile: holders.some((p) => p.id === profileId),
            alsoIn: holders
              .filter((p) => p.id !== profileId)
              .map((p) => p.name),
          };
        });
      }
      return { success: true, contents, hasProfiles: explicit };
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * Put an item in a profile or take it out of just that profile. The
   * item itself is never deleted. Bots are rescheduled when the active
   * profile changes.
   */
  setMembership(appId, profileId, kind, id, include) {
    try {
      if (!profileStore.hasProfiles(appId)) {
        throw new Error("Create a profile first — Default holds everything");
      }
      if (include) profileStore.add(appId, kind, id, profileId);
      else profileStore.removeFromProfile(appId, kind, id, profileId);
      if (
        kind === "bots" &&
        profileId === profileStore.getActiveProfileId(appId)
      ) {
        const bots = botControllerOrNull();
        if (bots && typeof bots.applyActiveProfile === "function") {
          bots.applyActiveProfile();
        }
      }
      return {
        success: true,
        alsoIn: profileStore
          .profilesHolding(appId, kind, id, profileId)
          .map((p) => p.name),
      };
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * What "Save to file" would write: counts, each widget's registry
   * check, and the size of the widgets copied into the file.
   */
  async previewSave(appId, profileId, options = {}) {
    try {
      const { gatherProfile, summarize } = require("../profile/profileFile");
      const gathered = await gatherProfile(appId, profileId, options);
      let signedIn = false;
      try {
        signedIn = !!require("./registryAuthController").getStoredToken();
      } catch (_e) {
        signedIn = false;
      }
      return { success: true, ...summarize(gathered), signedIn };
    } catch (e) {
      return fail(e);
    }
  },

  /** Save a profile to a .dashprofile file (a save dialog picks where). */
  async saveProfileFile(win, appId, profileId, options = {}) {
    try {
      const { saveProfileToFile } = require("../profile/profileFile");
      // Where to write is always the user's choice in the save dialog —
      // never a path from the renderer.
      const { filePath, ...choices } = options || {};
      return await saveProfileToFile(win, appId, profileId, choices);
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
