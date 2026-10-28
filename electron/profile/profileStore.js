/**
 * profileStore.js
 *
 * The profiles for an app, which one is active, and what each one holds,
 * kept in <userData>/Dashboard/<appId>/profiles.json:
 *
 *   { activeProfileId,
 *     profiles: [{ id, name, createdAt,
 *                  items: { dashboards, folders, themes, bots } }] }
 *
 * Dashboards, folders, themes and bots live once, in the app's shared
 * files; a profile is the list of ids it holds, so one item can be in
 * several profiles.
 *
 * Until a second profile is created the file doesn't exist, the app has
 * one profile, Default, and it holds everything (members() returns null:
 * no filtering). Creating the first extra profile writes Default's lists
 * out from what exists at that moment.
 */
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const appName = "Dashboard";
const storeFilename = "profiles.json";

const DEFAULT_PROFILE_ID = "default";
const DEFAULT_PROFILE_NAME = "Default";

const KINDS = ["dashboards", "folders", "themes", "bots"];

const PROFILE_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

const cache = new Map();

function getStorePath(appId) {
  if (!appId || typeof appId !== "string") {
    throw new Error("profileStore: appId is required");
  }
  return path.join(app.getPath("userData"), appName, appId, storeFilename);
}

function emptyItems() {
  return { dashboards: [], folders: [], themes: [], bots: [] };
}

// Ids are kept as strings: dashboards and folders use numbers, themes and
// bots use strings, and the same id must match either way.
function cleanIds(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((id) => id != null).map(String))];
}

function cleanItems(items) {
  const out = emptyItems();
  for (const kind of KINDS) out[kind] = cleanIds(items && items[kind]);
  return out;
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown profile item: ${kind}`);
}

// A missing or unreadable file means "Default only, holding everything" —
// never an error, so a damaged profiles.json can't hide the user's things.
function normalize(raw) {
  const base = {
    explicit: false,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        items: emptyItems(),
      },
    ],
  };
  if (!raw || !Array.isArray(raw.profiles)) return base;
  const defaultEntry =
    raw.profiles.find((p) => p && p.id === DEFAULT_PROFILE_ID) || {};
  const others = raw.profiles
    .filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        PROFILE_ID_PATTERN.test(p.id) &&
        p.id !== DEFAULT_PROFILE_ID,
    )
    .map((p) => ({ ...p, items: cleanItems(p.items) }));
  const all = [
    {
      ...base.profiles[0],
      ...defaultEntry,
      id: DEFAULT_PROFILE_ID,
      items: cleanItems(defaultEntry.items),
    },
    ...others,
  ];
  const activeProfileId = all.some((p) => p.id === raw.activeProfileId)
    ? raw.activeProfileId
    : DEFAULT_PROFILE_ID;
  return { explicit: true, activeProfileId, profiles: all };
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
  const { explicit, ...onDisk } = store;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(onDisk, null, 2));
  const next = { ...store, explicit: true };
  cache.set(appId, next);
  return next;
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

function copyProfile(p) {
  return { ...p, items: cleanItems(p.items) };
}

function updateItems(appId, store, profileIds, kind, change) {
  const profiles = store.profiles.map((p) => {
    if (!profileIds.includes(p.id)) return p;
    const current = p.items[kind];
    const next = cleanIds(change(current));
    return { ...p, items: { ...p.items, [kind]: next } };
  });
  return writeStore(appId, { ...store, profiles });
}

const profileStore = {
  /** True once a second profile has been created (profiles.json exists). */
  hasProfiles(appId) {
    return readStore(appId).explicit;
  },

  list(appId) {
    return readStore(appId).profiles.map(copyProfile);
  },

  getActiveProfileId(appId) {
    return readStore(appId).activeProfileId;
  },

  getActive(appId) {
    const store = readStore(appId);
    return copyProfile(findProfile(store, store.activeProfileId));
  },

  /**
   * Creates an empty profile. The first time, Default's lists are written
   * out from `defaultItems` (everything that exists now) so Default keeps
   * holding it all once filtering starts.
   */
  create(appId, name, { defaultItems, items } = {}) {
    let store = readStore(appId);
    const clean = cleanName(name);
    if (store.profiles.some((p) => sameName(p.name, clean))) {
      throw new Error(`A profile named "${clean}" already exists`);
    }
    if (!store.explicit) {
      store = {
        ...store,
        profiles: store.profiles.map((p) =>
          p.id === DEFAULT_PROFILE_ID
            ? { ...p, items: cleanItems(defaultItems) }
            : p,
        ),
      };
    }
    const profile = {
      id: newProfileId(store),
      name: clean,
      createdAt: new Date().toISOString(),
      items: cleanItems(items),
    };
    writeStore(appId, { ...store, profiles: [...store.profiles, profile] });
    return copyProfile(profile);
  },

  /**
   * Create or replace a profile with a given id and lists — loading a
   * profile file. Default can't be replaced, except by its own copy from
   * the user's account (`replaceDefault`; it keeps its name). The first
   * time profiles are written, Default's lists come from `defaultItems`.
   */
  put(appId, { id, name, items, link }, { defaultItems, replaceDefault } = {}) {
    let store = readStore(appId);
    const isDefault = id === DEFAULT_PROFILE_ID;
    if (isDefault && !replaceDefault) {
      throw new Error("The Default profile can't be replaced");
    }
    const clean = isDefault ? DEFAULT_PROFILE_NAME : cleanName(name);
    if (store.profiles.some((p) => p.id !== id && sameName(p.name, clean))) {
      throw new Error(`A profile named "${clean}" already exists`);
    }
    if (!store.explicit) {
      store = {
        ...store,
        profiles: store.profiles.map((p) =>
          p.id === DEFAULT_PROFILE_ID
            ? { ...p, items: cleanItems(defaultItems) }
            : p,
        ),
      };
    }
    const existing = store.profiles.find((p) => p.id === id);
    const profileId =
      existing || (typeof id === "string" && PROFILE_ID_PATTERN.test(id))
        ? id
        : newProfileId(store);
    const profile = {
      ...(existing || { createdAt: new Date().toISOString() }),
      id: profileId,
      name: clean,
      items: cleanItems(items),
      ...(link ? { link } : {}),
    };
    const profiles = existing
      ? store.profiles.map((p) => (p.id === profileId ? profile : p))
      : [...store.profiles, profile];
    writeStore(appId, { ...store, profiles });
    return copyProfile(profile);
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
    return copyProfile(profiles.find((p) => p.id === profileId));
  },

  /**
   * Removes a profile. Its items stay in the shared files (and in any
   * other profile that holds them). Default and the active profile can't
   * be removed.
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
    return { success: true };
  },

  setActive(appId, profileId) {
    const store = readStore(appId);
    const profile = findProfile(store, profileId);
    if (store.explicit || profileId !== DEFAULT_PROFILE_ID) {
      writeStore(appId, { ...store, activeProfileId: profileId });
    }
    return copyProfile(profile);
  },

  /**
   * The ids of `kind` a profile holds, or null when there is only Default
   * (no filtering: Default holds everything).
   */
  members(appId, kind, profileId) {
    assertKind(kind);
    const store = readStore(appId);
    if (!store.explicit) return null;
    const id = profileId || store.activeProfileId;
    return [...findProfile(store, id).items[kind]];
  },

  /** Adds ids to a profile (default: the active one). No-op before profiles exist. */
  add(appId, kind, ids, profileId) {
    assertKind(kind);
    const store = readStore(appId);
    if (!store.explicit) return;
    const target = profileId || store.activeProfileId;
    findProfile(store, target);
    updateItems(appId, store, [target], kind, (current) => [
      ...current,
      ...cleanIds([].concat(ids)),
    ]);
  },

  /** Takes ids out of one profile; the items themselves stay. */
  removeFromProfile(appId, kind, ids, profileId) {
    assertKind(kind);
    const store = readStore(appId);
    if (!store.explicit) return;
    const target = profileId || store.activeProfileId;
    findProfile(store, target);
    const drop = new Set(cleanIds([].concat(ids)));
    updateItems(appId, store, [target], kind, (current) =>
      current.filter((id) => !drop.has(id)),
    );
  },

  /** Takes ids out of every profile — used when the item is deleted. */
  removeEverywhere(appId, kind, ids) {
    assertKind(kind);
    const store = readStore(appId);
    if (!store.explicit) return;
    const drop = new Set(cleanIds([].concat(ids)));
    updateItems(
      appId,
      store,
      store.profiles.map((p) => p.id),
      kind,
      (current) => current.filter((id) => !drop.has(id)),
    );
  },

  /**
   * Record the last save or load of a profile — `{ revision, savedAt,
   * dashboardHashes }` — so later saves count up and sync can tell what
   * changed. No-op before profiles exist.
   */
  setLink(appId, profileId, link) {
    const store = readStore(appId);
    if (!store.explicit) return;
    findProfile(store, profileId);
    const profiles = store.profiles.map((p) =>
      p.id === profileId ? { ...p, link: { ...(p.link || {}), ...link } } : p,
    );
    writeStore(appId, { ...store, profiles });
  },

  /** Profiles (other than `exceptProfileId`) that hold this id. */
  profilesHolding(appId, kind, id, exceptProfileId) {
    assertKind(kind);
    const key = String(id);
    return readStore(appId)
      .profiles.filter(
        (p) => p.id !== exceptProfileId && p.items[kind].includes(key),
      )
      .map((p) => ({ id: p.id, name: p.name }));
  },

  // Tests only: forget what was read so the next call reads the disk.
  _resetCache() {
    cache.clear();
  },
};

module.exports = profileStore;
module.exports.DEFAULT_PROFILE_ID = DEFAULT_PROFILE_ID;
module.exports.DEFAULT_PROFILE_NAME = DEFAULT_PROFILE_NAME;
module.exports.KINDS = KINDS;
