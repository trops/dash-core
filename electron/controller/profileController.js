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
const profileAccount = require("../profile/profileAccount");

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

// The signed-in username if it's known without asking the registry.
function storedUsername() {
  try {
    const auth = require("./registryAuthController");
    return (auth.getStoredUsername && auth.getStoredUsername()) || null;
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

function rememberOpened(appId, read, win = null) {
  const now = Date.now();
  for (const [token, entry] of openedFiles) {
    if (now - entry.at > OPENED_FILE_TTL_MS) openedFiles.delete(token);
  }
  while (openedFiles.size >= 2) {
    openedFiles.delete(openedFiles.keys().next().value);
  }
  const token = `pl_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  // The window that opened it: installs report their progress there.
  openedFiles.set(token, { appId, read, win, at: now });
  return token;
}

// What a save takes from the renderer: whether bots and app settings go
// in. Providers always do (names and types, never keys) — the setup's
// widgets and bots need them on the other computer.
function saveOptions(options) {
  const o = options || {};
  return {
    bots: o.bots !== false,
    settings: o.settings !== false,
    providers: true,
  };
}

/** A v3 or v2 profile's JSON, checked: `{ read }` or `{ error }`. */
function openProfileJson(bytes) {
  const {
    jsonSchemaVersion,
    parseProfileV3,
  } = require("../profile/profileSetup");
  if (jsonSchemaVersion(bytes) === 3) {
    const parsed = parseProfileV3(bytes);
    return parsed.error ? parsed : { read: { v3: parsed.manifest } };
  }
  const parsed = require("../profile/profileLoadV2").parseProfileV2(bytes);
  return parsed.error ? parsed : { read: { v2: parsed.manifest } };
}

/** The load preview of an opened v3 or v2 profile. */
function planOpened(
  appId,
  opened,
  { linkedProfileId = null, sync = false } = {},
) {
  if (opened.read.v3) {
    return require("../profile/profileLoadV3").planLoadV3(
      appId,
      opened.read.v3,
      {},
      { linkedProfileId, sync },
    );
  }
  return require("../profile/profileLoadV2").planLoadV2(
    appId,
    opened.read.v2,
    {},
    { linkedProfileId },
  );
}

const profileController = {
  listProfiles(appId) {
    try {
      // Each profile kept in the signed-in user's account says so:
      // { accountId, revision, savedAt, updatedOn }.
      const owner = storedUsername();
      const links = profileAccount.allLinks(appId, owner);
      // How each one kept in the account saves itself (v3, Slice 3).
      const autoSave = owner
        ? require("../profile/profileAutoSave").getSettings(appId, owner)
        : {};
      return {
        success: true,
        profiles: profileStore.list(appId).map((p) => ({
          ...p,
          account: links[p.id] || null,
          autoSave: links[p.id] ? autoSave[p.id] || null : null,
        })),
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
      const res = profileStore.remove(appId, profileId);
      // The account copy stays in the account; this computer forgets it.
      if (res && res.success !== false) {
        profileAccount.forgetProfile(appId, profileId);
        require("../profile/profileAutoSave").forgetProfile(appId, profileId);
      }
      return res;
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
   * What "Save" would write (dash-profiles v3): the setup as it is, and
   * each widget listed at the version the registry has, listed at the
   * version last published (changes here not published), or not in the
   * registry. Nothing is published.
   */
  async previewSave(appId, profileId, options = {}) {
    try {
      const { planSave } = require("../profile/profileSaveV3");
      return await planSave(appId, profileId, saveOptions(options));
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
   * Save a profile to a file (dash-profiles v3; a save dialog picks where —
   * never a path from the renderer). `options`: what goes in (bots, app
   * settings). Nothing is published.
   */
  async saveProfileFile(win, appId, profileId, options = {}) {
    try {
      const { executeSave } = require("../profile/profileSaveV3");
      return await executeSave(win, appId, profileId, saveOptions(options));
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * Save a profile to the user's account (step 2, v3): the same as a file,
   * kept in the account instead. Refused, with `conflict`, when another
   * computer saved it since. `options.asNew` adds it as a new account
   * profile (its account copy was removed); `replaceRevision` replaces the
   * newer copy the user was shown ("keep this computer's").
   */
  async saveProfileToAccount(win, appId, profileId, options = {}) {
    try {
      const { executeSave } = require("../profile/profileSaveV3");
      const { asNew, replaceRevision } = options || {};
      const autoSave = require("../profile/profileAutoSave");
      // Never at the same time as an auto-save (one revision, one save).
      const result = await autoSave.exclusive(() =>
        executeSave(win, appId, profileId, saveOptions(options), {
          target: "account",
          asNew: asNew === true,
          replaceRevision: profileAccount.revisionOf(replaceRevision),
        }),
      );
      // What this save chose is what auto-save uses from now on.
      if (result && result.success) {
        try {
          autoSave.recordManualSave(
            appId,
            await signedInUsername(),
            profileId,
            saveOptions(options),
            result,
          );
        } catch (_e) {
          // auto-save settings are a convenience; the save happened
        }
      }
      return result;
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * The profiles in the user's account, each with the profile here it's
   * linked to (if any).
   */
  async listAccountProfiles(appId) {
    try {
      const res = await profileAccount.listRemote();
      if (!res.success) return res;
      const owner = await signedInUsername();
      const local = profileStore.list(appId);
      return {
        success: true,
        profiles: res.profiles.map((p) => {
          const localId = profileAccount.profileFor(appId, owner, p.id);
          const here = localId ? local.find((l) => l.id === localId) : null;
          return {
            ...p,
            linkedTo: here ? { id: here.id, name: here.name } : null,
          };
        }),
      };
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * Fetch a profile from the account and say what loading it would do —
   * the same preview as a file. Nothing changes yet.
   */
  async previewLoadFromAccount(win, appId, accountId) {
    try {
      const res = await profileAccount.getRemote(accountId);
      if (!res.success) return res;
      // Untrusted, like a file: parsed and checked the same way.
      const opened = openProfileJson(
        Buffer.from(JSON.stringify(res.profile.manifest || null)),
      );
      if (opened.error) return { success: false, error: opened.error };
      const owner = await signedInUsername();
      const linkedProfileId = profileAccount.profileFor(
        appId,
        owner,
        accountId,
      );
      const plan = await planOpened(appId, opened, {
        linkedProfileId,
        // Into the profile it's linked to: keeping it in step.
        sync: !!linkedProfileId,
      });
      return {
        ...plan,
        fromAccount: true,
        token: rememberOpened(
          appId,
          {
            ...opened.read,
            account: {
              accountId,
              revision: res.profile.revision,
              savedAt: res.profile.updatedAt,
              updatedOn: res.profile.updatedOn,
            },
            owner,
            linkedProfileId,
          },
          win,
        ),
      };
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * The out-of-sync check (step 2, S3): each profile here kept in the
   * signed-in user's account, compared with the account. `state`:
   * "in-sync", "account-newer" (another computer saved it since),
   * "local-changed" (changed here since it was last saved or loaded —
   * `changes` counts what) or "both". Copies no longer in the account
   * aren't listed.
   */
  async syncStatus(appId) {
    try {
      const owner = await signedInUsername();
      if (!owner) return { success: true, signedIn: false, profiles: [] };
      const links = profileAccount.allLinks(appId, owner);
      const local = profileStore.list(appId);
      const linked = local.filter((p) => links[p.id]);
      if (!linked.length)
        return { success: true, signedIn: true, profiles: [] };
      const remote = await profileAccount.listRemote();
      if (!remote.success) return remote;
      const {
        profileDigest,
        compareWithAccount,
      } = require("../profile/profileDigest");
      const active = profileStore.getActiveProfileId(appId);
      const profiles = [];
      for (const p of linked) {
        const link = links[p.id];
        const there = remote.profiles.find((r) => r.id === link.accountId);
        if (!there) continue;
        const { state, changes } = compareWithAccount(
          { ...link, revision: profileAccount.revisionOf(link.revision) },
          there.revision,
          profileDigest(appId, p.id),
        );
        profiles.push({
          profileId: p.id,
          name: p.name,
          active: p.id === active,
          accountId: link.accountId,
          state,
          changes,
          account: {
            revision: there.revision,
            updatedOn: there.updatedOn,
            updatedAt: there.updatedAt,
          },
        });
      }
      return { success: true, signedIn: true, profiles };
    } catch (e) {
      return fail(e);
    }
  },

  /** Remove a profile from the account. Profiles here aren't touched. */
  async deleteAccountProfile(appId, accountId) {
    try {
      const res = await profileAccount.deleteRemote(accountId);
      if (!res.success) return res;
      const owner = await signedInUsername();
      const linked = profileAccount.profileFor(appId, owner, accountId);
      if (linked) profileAccount.clearLink(appId, owner, linked);
      return { success: true };
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
      const bytes = fs.readFileSync(file);
      // A v3 or v2 profile (JSON) or a v1 zip.
      const { jsonSchemaVersion } = require("../profile/profileSetup");
      if (jsonSchemaVersion(bytes) !== null) {
        const opened = openProfileJson(bytes);
        if (opened.error) return { success: false, error: opened.error };
        const plan = await planOpened(appId, opened);
        return { ...plan, token: rememberOpened(appId, opened.read, win) };
      }
      const read = readProfileZip(bytes);
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
      if (entry.read && (entry.read.v2 || entry.read.v3)) {
        const { BrowserWindow } = require("electron");
        const win =
          entry.win && !entry.win.isDestroyed()
            ? entry.win
            : BrowserWindow.getFocusedWindow() ||
              BrowserWindow.getAllWindows()[0] ||
              null;
        const {
          linkedProfileId: _notFromRenderer,
          syncLinked: _notFromRendererEither,
          ...chosen
        } = picked;
        const fromAccount = entry.read.account || null;
        const apply = entry.read.v3
          ? (...a) => require("../profile/profileLoadV3").applyLoadV3(...a)
          : (...a) => require("../profile/profileLoadV2").applyLoadV2(...a);
        const result = await apply(win, appId, entry.read.v3 || entry.read.v2, {
          ...chosen,
          defaultItems,
          linkedProfileId: fromAccount ? entry.read.linkedProfileId : null,
          // The account's copy into the profile it's linked to: keep in step.
          syncLinked: !!(fromAccount && entry.read.linkedProfileId),
        });
        if (result.success) {
          openedFiles.delete(token);
          // Loaded from the account: the profile here is linked to it —
          // unless another profile here holds that copy or this one is
          // linked to a different copy (a load never moves a link; e.g.
          // Default's copy loads as its own profile, Default stays linked).
          const owner = entry.read.owner;
          if (
            fromAccount &&
            result.profile &&
            profileAccount.shouldLinkAfterLoad(
              appId,
              owner,
              result.profile.id,
              fromAccount.accountId,
            )
          ) {
            profileAccount.setLink(
              appId,
              owner,
              result.profile.id,
              profileAccount.linkAfterLoad(
                fromAccount,
                result.problems,
                // What it holds now: later changes are counted from here.
                require("../profile/profileDigest").profileDigest(
                  appId,
                  result.profile.id,
                ),
              ),
            );
          }
        }
        return result;
      }
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
   * A widget just built in the Widget Builder (v3): can it be published,
   * as what, and is it public already.
   */
  async planBuiltPublish(appId, packageName) {
    try {
      const { planBuiltPublish } = require("../profile/publishBuilt");
      return await planBuiltPublish(String(packageName || ""));
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * Publish a widget just built: private unless "public" is asked for; the
   * version and name are worked out here, never taken from the renderer.
   */
  async publishBuilt(win, appId, packageName, options = {}) {
    try {
      const { publishBuilt } = require("../profile/publishBuilt");
      const o = options || {};
      return await publishBuilt(win, appId, String(packageName || ""), {
        visibility: o.visibility === "public" ? "public" : "private",
        confirmPersonalPaths: o.confirmPersonalPaths === true,
      });
    } catch (e) {
      return fail(e);
    }
  },

  /**
   * How a profile kept in the account saves itself (v3, Slice 3): Manually,
   * When I make changes, or Every day at a time. Only for a profile kept
   * in the signed-in user's account.
   */
  async setAutoSave(appId, profileId, setting = {}) {
    try {
      const owner = await signedInUsername();
      if (!owner) {
        return {
          success: false,
          error: "Sign in to keep profiles in your account.",
        };
      }
      // A profile here (an id, not "constructor"), kept in the account.
      const here = profileStore.list(appId).some((p) => p.id === profileId);
      if (!here || !profileAccount.getLink(appId, owner, profileId)) {
        return {
          success: false,
          error: "Save it to your account first — then it can save itself.",
        };
      }
      const s = setting || {};
      const autoSave = require("../profile/profileAutoSave").setSetting(
        appId,
        owner,
        profileId,
        { mode: s.mode, time: s.time },
      );
      return { success: true, autoSave };
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
