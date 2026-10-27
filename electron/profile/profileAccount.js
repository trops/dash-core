/**
 * profileAccount.js
 *
 * Profiles kept in the user's registry account (dash-profiles step 2).
 *
 * Each profile on this computer can be linked to one profile in the
 * account: `{ accountId, revision, savedAt, updatedOn }`, the account
 * copy's id and the revision this computer last saved or loaded. Links
 * belong to a registry user (`owner`, the username): someone else signed
 * in on this computer sees none of them and can't move them. They live in
 * their own file (profileAccounts.json, `{ owner: { profileId: link } }`)
 * rather than profiles.json, so Default can be kept in the account without
 * starting profiles.
 *
 * The account calls go to the registry's /api/auth/me/profiles routes as
 * the signed-in user. A save sends the revision it last saw; the registry
 * refuses (409) when another computer saved since, so a save never
 * overwrites newer work unless the user chose to replace it.
 */
const path = require("path");
const fs = require("fs");

const linksFilename = "profileAccounts.json";
// What the registry accepts as a profile id.
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function defaultDeps() {
  return {
    appDataDir: (appId) => require("../utils/appPaths").getAppDataDir(appId),
    authedFetch: (...args) =>
      require("../controller/registryAuthController").authedFetch(...args),
    signedIn: () =>
      !!require("../controller/registryAuthController").getStoredToken(),
    baseUrl: () =>
      process.env.DASH_REGISTRY_API_URL ||
      "https://main.d919rwhuzp7rj.amplifyapp.com",
  };
}

/** A revision as a whole number, or null. */
function revisionOf(v) {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Text from the registry, made safe to store and show. */
function text(v, max = 100) {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

// --- Links (this computer) ---------------------------------------------

function linksPath(appId, d) {
  if (!appId || typeof appId !== "string") {
    throw new Error("profileAccount: appId is required");
  }
  return path.join(d.appDataDir(appId), linksFilename);
}

const ownerKey = (owner) => String(owner || "").toLowerCase();

function readAll(appId, d) {
  const out = Object.create(null);
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(linksPath(appId, d), "utf8"));
  } catch (_e) {
    return out;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [owner, links] of Object.entries(raw)) {
    if (!links || typeof links !== "object") continue;
    const clean = Object.create(null);
    for (const [profileId, link] of Object.entries(links)) {
      if (link && ACCOUNT_ID_PATTERN.test(String(link.accountId || ""))) {
        clean[profileId] = link;
      }
    }
    out[owner] = clean;
  }
  return out;
}

// One user's links: { profileId: link }. Nobody signed in: none.
function readLinks(appId, owner, d) {
  if (!owner) return Object.create(null);
  return readAll(appId, d)[ownerKey(owner)] || Object.create(null);
}

function writeLinks(appId, owner, links, d) {
  const all = readAll(appId, d);
  all[ownerKey(owner)] = links;
  const file = linksPath(appId, d);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...all }, null, 2));
}

/** The account copy `profileId` is linked to for `owner`, or null. */
function getLink(appId, owner, profileId, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  return readLinks(appId, owner, d)[profileId] || null;
}

/** `owner`'s links on this computer: { profileId: link }. */
function allLinks(appId, owner, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  return { ...readLinks(appId, owner, d) };
}

/**
 * Link `profileId` to an account copy (for `owner`). An account copy is
 * linked to one profile here at most: linking it again moves the link.
 */
function setLink(appId, owner, profileId, link, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!owner) throw new Error("Sign in to keep profiles in your account.");
  if (!ACCOUNT_ID_PATTERN.test(String(link.accountId || ""))) {
    throw new Error("That isn't a profile id.");
  }
  const links = readLinks(appId, owner, d);
  for (const [other, l] of Object.entries(links)) {
    if (other !== profileId && l.accountId === link.accountId) {
      delete links[other];
    }
  }
  links[profileId] = {
    accountId: link.accountId,
    revision: revisionOf(link.revision),
    savedAt: text(link.savedAt, 40),
    updatedOn: text(link.updatedOn),
  };
  writeLinks(appId, owner, links, d);
  return links[profileId];
}

function clearLink(appId, owner, profileId, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const links = readLinks(appId, owner, d);
  if (!links[profileId]) return;
  delete links[profileId];
  writeLinks(appId, owner, links, d);
}

/** Forget `profileId`'s links for everyone (the profile was deleted). */
function forgetProfile(appId, profileId, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const all = readAll(appId, d);
  let changed = false;
  for (const links of Object.values(all)) {
    if (links[profileId]) {
      delete links[profileId];
      changed = true;
    }
  }
  if (!changed) return;
  const file = linksPath(appId, d);
  fs.writeFileSync(file, JSON.stringify({ ...all }, null, 2));
}

/** The profile here linked to `accountId` for `owner`, or null. */
function profileFor(appId, owner, accountId, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const links = readLinks(appId, owner, d);
  return (
    Object.keys(links).find((id) => links[id].accountId === accountId) || null
  );
}

/**
 * After loading account copy `accountId` into `profileId`: whether to link
 * them. Only when no other profile here holds that copy and `profileId`
 * isn't linked to a different one — a load never moves or steals a link
 * (e.g. Default's copy loaded as its own profile leaves Default linked).
 */
function shouldLinkAfterLoad(appId, owner, profileId, accountId, deps = {}) {
  if (!owner) return false;
  const holder = profileFor(appId, owner, accountId, deps);
  if (holder && holder !== profileId) return false;
  const own = getLink(appId, owner, profileId, deps);
  return !own || own.accountId === accountId;
}

function newAccountId() {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// --- The account (registry) -------------------------------------------

const SIGN_IN = "Sign in to keep profiles in your account.";

async function call(d, method, accountId, body) {
  if (!d.signedIn()) return { ok: false, status: 401, error: SIGN_IN };
  if (accountId != null && !ACCOUNT_ID_PATTERN.test(String(accountId))) {
    return { ok: false, status: 400, error: "That isn't a profile id." };
  }
  const url = `${d.baseUrl()}/api/auth/me/profiles${
    accountId != null ? `/${encodeURIComponent(accountId)}` : ""
  }`;
  let res;
  try {
    res = await d.authedFetch(url, {
      method,
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch (_e) {
    return {
      ok: false,
      status: 0,
      unreachable: true,
      error: "Couldn't reach the registry — try again.",
    };
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_e) {
    data = null;
  }
  if (res.ok) return { ok: true, status: res.status, data: data || {} };
  return {
    ok: false,
    status: res.status,
    data,
    error:
      res.status === 401
        ? SIGN_IN
        : (data && typeof data.error === "string" && data.error) ||
          `The registry answered ${res.status}.`,
  };
}

/** The profiles in the account: [{ id, name, revision, updatedAt, updatedOn, size }]. */
async function listRemote(deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const r = await call(d, "GET", null);
  if (!r.ok) return { success: false, ...pick(r) };
  const profiles = Array.isArray(r.data.profiles) ? r.data.profiles : [];
  return {
    success: true,
    // Untrusted: only what's shown, checked.
    profiles: profiles
      .filter((p) => p && ACCOUNT_ID_PATTERN.test(String(p.id || "")))
      .map((p) => ({
        id: p.id,
        name: text(p.name, 60) || "Untitled profile",
        revision: revisionOf(p.revision),
        updatedAt: text(p.updatedAt, 40),
        updatedOn: text(p.updatedOn),
      })),
  };
}

/** One account profile with its manifest (untrusted — parse before use). */
async function getRemote(accountId, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const r = await call(d, "GET", accountId);
  if (!r.ok) return { success: false, ...pick(r) };
  // Untrusted: the manifest is parsed by the caller; the rest is checked.
  return {
    success: true,
    profile: {
      manifest: r.data.manifest,
      revision: revisionOf(r.data.revision),
      updatedAt: text(r.data.updatedAt, 40),
      updatedOn: text(r.data.updatedOn),
    },
  };
}

/**
 * Save `manifest` as account profile `accountId`, from `baseRevision` (the
 * revision last seen here; null for a new one). A refusal because another
 * computer saved since comes back as `{ conflict: { revision, updatedOn,
 * updatedAt, missing } }`.
 */
async function putRemote(accountId, manifest, baseRevision, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const r = await call(d, "PUT", accountId, { manifest, baseRevision });
  if (r.ok) return { success: true, saved: r.data };
  if (r.status === 409) {
    const data = r.data || {};
    return {
      success: false,
      error: r.error,
      conflict: {
        revision: revisionOf(data.revision),
        updatedOn: text(data.updatedOn),
        updatedAt: text(data.updatedAt, 40),
        // The account copy was removed: saving again adds it as new.
        missing: revisionOf(data.revision) === null && baseRevision != null,
      },
    };
  }
  return { success: false, ...pick(r) };
}

async function deleteRemote(accountId, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const r = await call(d, "DELETE", accountId);
  if (!r.ok) return { success: false, ...pick(r) };
  return { success: true };
}

function pick(r) {
  return {
    error: r.error,
    ...(r.status === 401 ? { signInRequired: true } : {}),
    ...(r.unreachable ? { unreachable: true } : {}),
  };
}

module.exports = {
  ACCOUNT_ID_PATTERN,
  revisionOf,
  getLink,
  allLinks,
  setLink,
  clearLink,
  forgetProfile,
  profileFor,
  shouldLinkAfterLoad,
  newAccountId,
  listRemote,
  getRemote,
  putRemote,
  deleteRemote,
};
