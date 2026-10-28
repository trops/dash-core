/**
 * profileSetup.js
 *
 * The v3 profile (dash-profiles v3, user 2026-10-28): a profile is the
 * user's setup — dashboards, themes, folders, bots and teams, kept in the
 * profile itself — plus the widgets it uses by name and version. Widgets
 * are the only items (code, published by their authors); everything else
 * is config, so saving a profile never publishes anything.
 *
 *   { kind, schemaVersion: 3, profileId, name, owner, revision, createdAt,
 *     createdOn, appVersion,
 *     widgets:  { "@scope/name": "1.2.3" },
 *     setup:    "<gzip, base64>" → { dashboards: [], themes: {},
 *                                     folders: [], bots: [] },
 *     providers: [ without keys ], settings: { app },
 *     secretsToEnter, leftOut, unpublished }
 *
 * `setup` is compressed so a profile with many dashboards still fits the
 * account (350 KB per profile). The same JSON is a file or an account copy.
 */
const zlib = require("zlib");
const crypto = require("crypto");
const { normalizePackageRef } = require("../registry/packageRef");

const PROFILE_SETUP_SCHEMA_VERSION = 3;
// What the account keeps per profile (dash-registry MAX_PROFILE_BYTES).
const MAX_ACCOUNT_BYTES = 350000;
// A profile's setup unpacks to no more than this.
const MAX_SETUP_BYTES = 20 * 1024 * 1024;
const MAX_ITEMS = 500;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+)?$/;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// A bot's fields that belong to this computer: its conversation, and the
// approvals given here (tools that skip the prompt, the approval policy) —
// approvals are given on each computer, never carried.
const BOT_LOCAL_FIELDS = ["session", "allowedTools", "approvalPolicy", "ref"];

// Fields that change by themselves (opening, saving, running) and don't
// make two copies different.
const VOLATILE = {
  dashboards: [
    "dateEdited",
    "date_edited",
    "dateUpdated",
    "updatedAt",
    "lastOpened",
    "lastOpenedAt",
    "activePageId",
  ],
  bots: ["createdAt", "updatedAt", ...BOT_LOCAL_FIELDS],
  themes: [],
  folders: [],
};

// A short string from a profile, or null.
const str = (v, max = 200) =>
  typeof v === "string" && v.length <= max ? v : null;
// An id from a profile (string or number), as a string, or null.
const idStr = (v) =>
  (typeof v === "string" && v.length && v.length <= 64) ||
  (typeof v === "number" && Number.isFinite(v))
    ? String(v)
    : null;
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** A bot as a profile carries it: without what belongs to this computer. */
function portableSetupBot(bot) {
  const out = { ...(bot || {}) };
  for (const f of BOT_LOCAL_FIELDS) delete out[f];
  return out;
}

/** Pack a setup for the profile. */
function packSetup(setup) {
  return zlib
    .gzipSync(Buffer.from(JSON.stringify(setup), "utf8"), { level: 9 })
    .toString("base64");
}

/** Unpack a profile's setup (untrusted): the object, or throws. */
function unpackSetup(packed) {
  if (typeof packed !== "string" || !packed) {
    throw new Error("The profile's setup is missing.");
  }
  let json;
  try {
    json = zlib
      .gunzipSync(Buffer.from(packed, "base64"), {
        maxOutputLength: MAX_SETUP_BYTES,
      })
      .toString("utf8");
  } catch (_e) {
    throw new Error("The profile's setup is damaged or too big.");
  }
  try {
    return JSON.parse(json);
  } catch (_e) {
    throw new Error("The profile's setup is damaged.");
  }
}

function hashOf(value) {
  const { stableStringify } = require("../registry/fingerprint");
  return crypto
    .createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 16);
}

/**
 * A fingerprint of one setup record that ignores what changes by itself.
 * Dashboards are compared with their keys blanked (the caller blanks them —
 * a profile never has them). Bots are compared as the bot store keeps them.
 */
function setupHash(kind, rec) {
  let value = rec || {};
  if (kind === "bots") {
    const { withDefaults } = require("../bots/botSchema");
    value = withDefaults(value);
  }
  if (kind === "folders") {
    value = { name: value.name || "", icon: value.icon || null };
  }
  const copy = {};
  for (const key of Object.keys(value)) {
    if (!(VOLATILE[kind] || []).includes(key)) copy[key] = value[key];
  }
  return hashOf(copy);
}

/**
 * A dashboard as two copies of it are compared: without its id (a copy
 * made before v3 has another), its keys and passwords (a profile never has
 * them — typed, blank or missing all compare the same) and settings that
 * point at this computer (a results widget's bot).
 */
function comparableDashboard(ws, secretFieldsFor = () => new Set()) {
  const { mapItems, looksSecretName } = require("./secretFields");
  const out = mapItems(ws || {}, (item) => {
    if (!plain(item.userPrefs)) return { ...item };
    const declared = secretFieldsFor(item) || new Set();
    const prefs = {};
    for (const [field, value] of Object.entries(item.userPrefs)) {
      if (field === "botId" || declared.has(field) || looksSecretName(field)) {
        continue;
      }
      prefs[field] = value;
    }
    return { ...item, userPrefs: prefs };
  });
  const { id: _id, ...rest } = out;
  return rest;
}

/** The v3 profile, from what a save gathered. */
function buildManifestV3({
  profile,
  owner = null,
  widgets = {},
  dashboards = [],
  themes = {},
  folders = [],
  bots = [],
  providers = [],
  appSettings = null,
  secretsToEnter = [],
  leftOut = [],
  unpublished = [],
  revision = 1,
  createdOn = null,
  appVersion = null,
  now = new Date(),
}) {
  return {
    kind: "dash-profile",
    schemaVersion: PROFILE_SETUP_SCHEMA_VERSION,
    profileId: profile.id,
    name: profile.name,
    owner: owner || null,
    revision,
    createdAt: now.toISOString(),
    createdOn,
    appVersion,
    widgets: { ...widgets },
    setup: packSetup({
      dashboards,
      themes,
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name || "",
        ...(f.icon ? { icon: f.icon } : {}),
      })),
      bots: bots.map(portableSetupBot),
    }),
    providers,
    settings: appSettings ? { app: appSettings } : {},
    secretsToEnter,
    leftOut,
    unpublished,
  };
}

// ---- reading (untrusted) ---------------------------------------------------

function cleanSecretEntry(s) {
  if (!plain(s)) return null;
  const out = {};
  for (const k of ["dashboard", "title", "component", "field", "item"]) {
    if (str(s[k])) out[k] = s[k];
  }
  const dashboardId = idStr(s.dashboardId);
  if (dashboardId) out.dashboardId = dashboardId;
  return out.field ? out : null;
}

function cleanSetup(raw) {
  if (!plain(raw)) throw new Error("The profile's setup is damaged.");
  // Well-formed records, each id once (the first), at most MAX_ITEMS.
  const records = (v) => {
    const seen = new Set();
    return (Array.isArray(v) ? v : [])
      .filter((r) => {
        if (!plain(r) || !idStr(r.id) || seen.has(idStr(r.id))) return false;
        seen.add(idStr(r.id));
        return true;
      })
      .slice(0, MAX_ITEMS);
  };
  const dashboards = records(raw.dashboards);
  const folders = records(raw.folders).map((f) => ({
    id: typeof f.id === "number" ? f.id : String(f.id),
    name: str(f.name, 100) || "Folder",
    ...(str(f.icon, 50) ? { icon: f.icon } : {}),
  }));
  const bots = records(raw.bots)
    .filter((b) => b.system !== "dash-team" && str(b.name, 200))
    .map(portableSetupBot);
  const themes = Object.create(null);
  for (const [key, value] of Object.entries(
    plain(raw.themes) ? raw.themes : {},
  )) {
    if (UNSAFE_KEYS.has(key) || !str(key, 100) || !plain(value)) continue;
    themes[key] = value;
  }
  if (
    dashboards.length +
      folders.length +
      bots.length +
      Object.keys(themes).length >
    MAX_ITEMS * 4
  ) {
    throw new Error("The profile holds too many items.");
  }
  return { dashboards, folders, bots, themes };
}

/**
 * A v3 profile from a file's bytes or an account copy, checked: kind,
 * schema, widget names and exact versions, every name a string, the setup
 * unpacked within its limit. `{ manifest }` (setup unpacked) or `{ error }`.
 */
function parseProfileV3(input) {
  let m = input;
  if (Buffer.isBuffer(input) || typeof input === "string") {
    try {
      m = JSON.parse(Buffer.isBuffer(input) ? input.toString("utf8") : input);
    } catch (_e) {
      return { error: "That isn't a Dash profile file." };
    }
  }
  if (!plain(m) || m.kind !== "dash-profile") {
    return { error: "That isn't a Dash profile file." };
  }
  if (m.schemaVersion !== PROFILE_SETUP_SCHEMA_VERSION) {
    return {
      error: "This profile was saved by a newer Dash — update Dash to load it.",
    };
  }
  if (!str(m.name, 60) || !m.name.trim()) {
    return { error: "The profile in this file has no name." };
  }
  const widgets = Object.create(null);
  const rawWidgets = plain(m.widgets) ? m.widgets : {};
  if (Object.keys(rawWidgets).length > MAX_ITEMS) {
    return { error: "The file lists too many widgets." };
  }
  for (const [pkg, version] of Object.entries(rawWidgets)) {
    if (UNSAFE_KEYS.has(pkg) || !normalizePackageRef(pkg)) {
      return { error: `"${pkg}" isn't a package name.` };
    }
    if (typeof version !== "string" || !VERSION.test(version)) {
      return { error: `${pkg} has no exact version.` };
    }
    widgets[pkg] = version;
  }
  let setup;
  try {
    setup = cleanSetup(unpackSetup(m.setup));
  } catch (e) {
    return { error: e.message };
  }
  const settings = plain(m.settings) ? m.settings : {};
  const app = plain(settings.app) ? settings.app : null;
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    manifest: {
      kind: m.kind,
      schemaVersion: PROFILE_SETUP_SCHEMA_VERSION,
      profileId: idStr(m.profileId),
      name: m.name.trim(),
      owner: str(m.owner, 64),
      revision: Number.isFinite(m.revision) ? m.revision : null,
      createdAt: str(m.createdAt, 64),
      createdOn: str(m.createdOn, 100),
      widgets,
      setup,
      providers: list(m.providers)
        .filter(
          (p) =>
            plain(p) &&
            str(p.name, 100) &&
            str(p.type, 100) &&
            !UNSAFE_KEYS.has(p.name),
        )
        .map((p) => ({
          name: p.name,
          type: p.type,
          providerClass: str(p.providerClass, 50),
        }))
        .slice(0, MAX_ITEMS),
      settings: {
        app: app
          ? {
              ...(str(app.theme, 100) ? { theme: app.theme } : {}),
              ...(typeof app.checkForUpdatesOnLaunch === "boolean"
                ? { checkForUpdatesOnLaunch: app.checkForUpdatesOnLaunch }
                : {}),
            }
          : null,
      },
      secretsToEnter: list(m.secretsToEnter)
        .map(cleanSecretEntry)
        .filter(Boolean)
        .slice(0, MAX_ITEMS),
      leftOut: list(m.leftOut)
        .map((l) =>
          plain(l) && str(l.name, 200)
            ? {
                kind: str(l.kind, 20),
                name: l.name,
                reason: str(l.reason, 300) || "",
              }
            : null,
        )
        .filter(Boolean)
        .slice(0, MAX_ITEMS),
    },
  };
}

/** The schema of a profile file's JSON bytes, or null (a v1 zip). */
function jsonSchemaVersion(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer));
  let i = 0;
  while (i < b.length && i < 64 && [0x20, 0x0a, 0x0d, 0x09].includes(b[i])) {
    i += 1;
  }
  if (b[i] !== 0x7b) return null;
  try {
    const m = JSON.parse(b.toString("utf8"));
    return m && typeof m.schemaVersion === "number" ? m.schemaVersion : 0;
  } catch (_e) {
    return 0;
  }
}

module.exports = {
  PROFILE_SETUP_SCHEMA_VERSION,
  MAX_ACCOUNT_BYTES,
  MAX_SETUP_BYTES,
  portableSetupBot,
  packSetup,
  unpackSetup,
  setupHash,
  comparableDashboard,
  buildManifestV3,
  parseProfileV3,
  jsonSchemaVersion,
};
