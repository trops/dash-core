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

// The registry username of the signed-in user, or null.
async function signedInUsername() {
  try {
    const auth = require("./registryAuthController");
    const cached = auth.getStoredUsername && auth.getStoredUsername();
    if (cached) return cached;
    const profile = await auth.getRegistryProfile();
    return (profile && profile.username) || null;
  } catch (_e) {
    return null;
  }
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

// Profile files opened for loading, kept in the main process until the user
// confirms (the renderer only ever holds the token). Opened files expire.
const openedFiles = new Map();
const OPENED_FILE_TTL_MS = 10 * 60 * 1000;

function rememberOpened(appId, read) {
  const now = Date.now();
  for (const [token, entry] of openedFiles) {
    if (now - entry.at > OPENED_FILE_TTL_MS) openedFiles.delete(token);
  }
  while (openedFiles.size >= 2) {
    openedFiles.delete(openedFiles.keys().next().value);
  }
  const token = `pl_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  openedFiles.set(token, { appId, read, at: now });
  return token;
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
   * What "Save" would do (dash-profiles v2): each item referenced,
   * published, published as a remix, or left out (with why), and what
   * blocks the save. Nothing is published yet.
   */
  async previewSave(appId, profileId, options = {}) {
    try {
      const { planSave } = require("../profile/profileSaveV2");
      return await planSave(appId, profileId, options);
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * Publish one of a profile's widgets to the user's account (PR 4b). The
   * plan is worked out again here — never taken from the renderer — so
   * only a widget the plan allows is published, as the plan says.
   */
  async publishWidget(win, appId, profileId, packageName, options = {}) {
    try {
      const { gatherProfile, summarize } = require("../profile/profileFile");
      const {
        planPublish,
        publishWidget,
      } = require("../profile/profilePublish");
      const { lookupRegistryPackage } = require("../profile/profileFile");
      const username = await signedInUsername();
      if (!username) {
        return { success: false, error: "Sign in to publish to your account." };
      }
      const gathered = await gatherProfile(appId, profileId, {});
      const plan = await planPublish(
        summarize(gathered).widgets,
        username,
        lookupRegistryPackage,
      );
      const row = plan.find((r) => r.package === packageName);
      if (!row || !row.publishable) {
        return { success: false, error: `${packageName} can't be published.` };
      }
      const result = await publishWidget(win, appId, row, {
        confirmPersonalPaths: !!(options && options.confirmPersonalPaths),
      });
      return { success: result.status === "published", ...result };
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * Save a profile (dash-profiles v2): publish what changed, then write the
   * file (a save dialog picks where). `options`: what goes in (bots,
   * providers, settings) and the user's choices in the review —
   * `skipPublic` (their public items not to release now) and
   * `confirmPersonalPaths` (widgets whose files mention this computer's
   * folders, checked).
   */
  async saveProfileFile(win, appId, profileId, options = {}) {
    try {
      const { executeSave } = require("../profile/profileSaveV2");
      // Where to write is always the user's choice in the save dialog —
      // never a path from the renderer.
      const {
        filePath: _ignored,
        skipPublic,
        confirmPersonalPaths,
        ...what
      } = options || {};
      return await executeSave(win, appId, profileId, what, {
        skipPublic: Array.isArray(skipPublic) ? skipPublic.map(String) : [],
        confirmPersonalPaths: Array.isArray(confirmPersonalPaths)
          ? confirmPersonalPaths.map(String)
          : [],
      });
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * Pick a .dashprofile (an open dialog — never a path from the renderer)
   * and say what loading it would do. Nothing changes yet.
   */
  async previewLoad(win, appId) {
    try {
      const { dialog } = require("electron");
      const { PROFILE_FILE_EXTENSION } = require("../profile/profileFile");
      const res = await dialog.showOpenDialog(win, {
        title: "Load a profile",
        properties: ["openFile"],
        filters: [
          { name: "Dash profile", extensions: [PROFILE_FILE_EXTENSION] },
        ],
      });
      if (res.canceled || !res.filePaths || !res.filePaths[0]) {
        return { success: false, canceled: true };
      }
      const fs = require("fs");
      const {
        MAX_FILE_BYTES,
        readProfileZip,
        planLoad,
      } = require("../profile/profileLoad");
      const file = res.filePaths[0];
      if (fs.statSync(file).size > MAX_FILE_BYTES) {
        return { success: false, error: "The file is too big." };
      }
      const read = readProfileZip(fs.readFileSync(file));
      if (read.error) return { success: false, error: read.error };
      const plan = planLoad(appId, read);
      return { success: true, token: rememberOpened(appId, read), ...plan };
    } catch (e) {
      return fail(e);
    }
  },

  /** Load the file opened by previewLoad, with the user's choices. */
  async applyLoad(appId, token, choices = {}) {
    try {
      const entry = openedFiles.get(token);
      if (!entry || entry.appId !== appId) {
        return {
          success: false,
          error: "Open the file again — it was closed.",
        };
      }
      const { applyLoad } = require("../profile/profileLoad");
      const bots = botControllerOrNull();
      // What Default holds if this load starts profiles — before anything
      // from the file is written.
      const defaultItems = profileStore.hasProfiles(appId)
        ? undefined
        : currentItems(appId, bots);
      const { defaultItems: _ignored, ...picked } = choices || {};
      const result = await applyLoad(appId, entry.read, {
        ...picked,
        defaultItems,
      });
      if (result.success) openedFiles.delete(token);
      return result;
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
