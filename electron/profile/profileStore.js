/**
 * profileStore.js
 *
 * The list of profiles for an app and which one is active, kept in
 * <userData>/Dashboard/<appId>/profiles.json:
 *
 *   { activeProfileId, profiles: [{ id, name, createdAt }] }
 *
 * Until a second profile is created the file doesn't exist and the app
 * has one profile, Default, whose data stays in Dashboard/<appId>/ exactly
 * as before profiles existed. Other profiles live in
 * Dashboard/<appId>/profiles/<id>/.
 */
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const appName = "Dashboard";
const storeFilename = "profiles.json";
const profilesDirname = "profiles";

const DEFAULT_PROFILE_ID = "default";
const DEFAULT_PROFILE_NAME = "Default";

// Ids we create are "p-<base36>"; only these are ever used in a path.
const PROFILE_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

const cache = new Map();

function getAppRootDir(appId) {
  if (!appId || typeof appId !== "string") {
    throw new Error("profileStore: appId is required");
  }
  return path.join(app.getPath("userData"), appName, appId);
}

function getStorePath(appId) {
  return path.join(getAppRootDir(appId), storeFilename);
}

function defaultStore() {
  return {
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME }],
  };
}

// A missing or unreadable file means "Default only" — never an error, so
// a damaged profiles.json can't hide the user's dashboards.
function normalize(raw) {
  const base = defaultStore();
  if (!raw || !Array.isArray(raw.profiles)) return base;
  const profiles = raw.profiles.filter(
    (p) =>
      p &&
      typeof p.id === "string" &&
      PROFILE_ID_PATTERN.test(p.id) &&
      p.id !== DEFAULT_PROFILE_ID,
  );
  const defaultEntry = raw.profiles.find(
    (p) => p && p.id === DEFAULT_PROFILE_ID,
  );
  const all = [{ ...base.profiles[0], ...defaultEntry }, ...profiles];
  const activeProfileId = all.some((p) => p.id === raw.activeProfileId)
    ? raw.activeProfileId
    : DEFAULT_PROFILE_ID;
  return { activeProfileId, profiles: all };
}

function readStore(appId) {
  if (cache.has(appId)) return cache.get(appId);
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(getStorePath(appId), "utf8"));
  } catch (e) {
    raw = null;
  }
  const store = normalize(raw);
  cache.set(appId, store);
  return store;
}

function writeStore(appId, store) {
  const file = getStorePath(appId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
  cache.set(appId, store);
  return store;
}

function sameName(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function cleanName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new Error("A profile needs a name");
  if (trimmed.length > 60)
    throw new Error("Profile names are 60 characters or fewer");
  return trimmed;
}

function findProfile(store, profileId) {
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`No profile with id ${profileId}`);
  return profile;
}

function newProfileId(store) {
  let id;
  do {
    id = `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (store.profiles.some((p) => p.id === id));
  return id;
}

/**
 * The folder holding a profile's per-profile files. Default keeps the
 * app folder itself.
 */
function getProfileDir(appId, profileId) {
  if (profileId === DEFAULT_PROFILE_ID) return getAppRootDir(appId);
  if (!PROFILE_ID_PATTERN.test(profileId || "")) {
    throw new Error(`Invalid profile id: ${profileId}`);
  }
  return path.join(getAppRootDir(appId), profilesDirname, profileId);
}

const profileStore = {
  list(appId) {
    return readStore(appId).profiles.map((p) => ({ ...p }));
  },

  getActiveProfileId(appId) {
    return readStore(appId).activeProfileId;
  },

  getActive(appId) {
    const store = readStore(appId);
    return { ...findProfile(store, store.activeProfileId) };
  },

  create(appId, name) {
    const store = readStore(appId);
    const clean = cleanName(name);
    if (store.profiles.some((p) => sameName(p.name, clean))) {
      throw new Error(`A profile named "${clean}" already exists`);
    }
    const profile = {
      id: newProfileId(store),
      name: clean,
      createdAt: new Date().toISOString(),
    };
    writeStore(appId, {
      ...store,
      profiles: [...store.profiles, profile],
    });
    fs.mkdirSync(getProfileDir(appId, profile.id), { recursive: true });
    return { ...profile };
  },

  rename(appId, profileId, name) {
    const store = readStore(appId);
    findProfile(store, profileId);
    const clean = cleanName(name);
    if (
      store.profiles.some((p) => p.id !== profileId && sameName(p.name, clean))
    ) {
      throw new Error(`A profile named "${clean}" already exists`);
    }
    const profiles = store.profiles.map((p) =>
      p.id === profileId ? { ...p, name: clean } : p,
    );
    writeStore(appId, { ...store, profiles });
    return { ...profiles.find((p) => p.id === profileId) };
  },

  /**
   * Removes a profile and its folder. Default and the active profile
   * can't be deleted.
   */
  remove(appId, profileId) {
    const store = readStore(appId);
    findProfile(store, profileId);
    if (profileId === DEFAULT_PROFILE_ID) {
      throw new Error("The Default profile can't be deleted");
    }
    if (profileId === store.activeProfileId) {
      throw new Error("Switch to another profile before deleting this one");
    }
    writeStore(appId, {
      ...store,
      profiles: store.profiles.filter((p) => p.id !== profileId),
    });
    fs.rmSync(getProfileDir(appId, profileId), {
      recursive: true,
      force: true,
    });
    return { success: true };
  },

  setActive(appId, profileId) {
    const store = readStore(appId);
    findProfile(store, profileId);
    writeStore(appId, { ...store, activeProfileId: profileId });
    return { ...findProfile(store, profileId) };
  },

  getProfileDir,
  getAppRootDir,

  // Tests only: forget what was read so the next call reads the disk.
  _resetCache() {
    cache.clear();
  },
};

module.exports = profileStore;
module.exports.DEFAULT_PROFILE_ID = DEFAULT_PROFILE_ID;
module.exports.DEFAULT_PROFILE_NAME = DEFAULT_PROFILE_NAME;
