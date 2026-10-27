/**
 * remix.js
 *
 * Publishing your own version of someone else's widget, dashboard, theme or
 * bot is a remix (user decisions, 2026-10-27): it goes under your name,
 * credits the original, and is refused when the original's author doesn't
 * allow remixes — by default public packages may be remixed and private
 * ones (shared or, later, paid) may not. The registry enforces the rule
 * (dash-registry lib/remixRules); this side finds what an item is a copy
 * of, asks first so the reason shows before anything is uploaded, and
 * sends `remixedFrom` with the publish.
 */
const { normalizePackageRef, readRegistryRef } = require("./packageRef");
const { getPackageInfo, isOwnScope } = require("./registryPackages");

// Scopes that never name a registry package (local builds).
const LOCAL_SCOPES = new Set(["ai-built"]);
// The registry's version rule (dash-registry src/lib/validate.ts).
const REGISTRY_SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+)?$/;

function originFrom(pkg, version, username) {
  const ref = normalizePackageRef(pkg);
  if (!ref) return null;
  if (LOCAL_SCOPES.has(ref.scope.toLowerCase())) return null;
  if (isOwnScope(ref.scope, username)) return null;
  return {
    scope: ref.scope,
    name: ref.name,
    version: REGISTRY_SEMVER.test(String(version || "")) ? version : null,
  };
}

/**
 * The registry package an item is a copy of, when it isn't the user's own:
 * `{ scope, name, version|null }`, or null (made here, the user's own, or
 * not known to come from the registry).
 *
 * @param {"widget"|"dashboard"|"theme"|"bot"|"bot-team"} kind
 * @param {object} record  for a widget, its dash.json (plus `packageId`,
 *   `version`, `installSource` from the widget registry); otherwise the
 *   stored dashboard, theme, bot or team settings
 * @param {string} [username]  the signed-in user (defaults to the stored one)
 */
function remixOrigin(kind, record, username) {
  if (!record || typeof record !== "object") return null;
  // Recorded when the copy was made (Widget Builder remix, Duplicate).
  const r = record.remixedFrom;
  if (r && typeof r === "object") {
    const origin = originFrom(
      r.package ||
        (r.scope && r.name ? { scope: r.scope, name: r.name } : null),
      r.version,
      username,
    );
    if (origin) return origin;
  }
  if (kind === "widget") {
    // Someone else's widget installed from the registry, published as-is.
    // Installs from before `installSource` was recorded count as registry
    // installs (as profileFile does); a local or URL build doesn't.
    if (record.installSource && record.installSource !== "registry") {
      return null;
    }
    return originFrom(record.packageId, record.version, username);
  }
  // Installed from the registry (not published from here).
  const ref = readRegistryRef(kind, record);
  if (!ref || ref.origin !== "installed" || !ref.package) return null;
  return originFrom(ref.package, ref.version, username);
}

/**
 * Whether a copy of `origin` may be published, and the `remixedFrom` to
 * send. The registry has the last word; asking first means the reason shows
 * before anything is uploaded.
 *
 * @returns {Promise<{remixedFrom: object|null}|{error: string}>} remixedFrom
 *   null when there's no origin (the user's own work)
 */
async function checkRemix(
  origin,
  // A sign-in the registry didn't accept is "try again", not "not there".
  lookup = (pkg) => getPackageInfo(pkg, { authFailuresUnreachable: true }),
) {
  if (!origin) return { remixedFrom: null };
  const id = `@${origin.scope}/${origin.name}`;
  const info = await lookup(id);
  if (info === "unreachable") {
    return {
      error: `Couldn't check with the registry whether ${id} may be remixed — try again.`,
    };
  }
  // Gone, or made private since (which turns remixes off): the registry
  // gives the same answer, so a copy can't go out uncredited.
  if (!info) {
    return {
      error: `${id} isn't a package you can remix any more, so your copy can't be published.`,
    };
  }
  if (info.allowRemix === false) {
    return {
      error: `The author of ${id} doesn't allow remixes, so your copy can't be published.`,
    };
  }
  // The version it was copied from, when the registry has it (a local
  // version number may have moved on since).
  const versions = Array.isArray(info.versions) ? info.versions : [];
  const version =
    origin.version && (!versions.length || versions.includes(origin.version))
      ? origin.version
      : info.latestVersion;
  if (!version || !REGISTRY_SEMVER.test(version)) {
    return {
      error: `Couldn't tell which version of ${id} your copy comes from.`,
    };
  }
  return {
    remixedFrom: { scope: origin.scope, name: origin.name, version },
  };
}

/**
 * The check for several originals at once (a team whose bots come from
 * different packages): refused if any of them refuses. The credit sent is the
 * one sent before (`credited`) when there is one — the registry keeps a
 * package a remix of the same original — else the first by name.
 */
async function checkRemixAll(origins, lookup, credited = null) {
  const key = (o) => `${o.scope}/${o.name}`.toLowerCase();
  const seen = new Map();
  for (const o of origins || []) if (o) seen.set(key(o), o);
  const sorted = [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, o]) => o);
  if (credited && seen.has(key(credited))) {
    sorted.sort((a, b) =>
      key(a) === key(credited) ? -1 : key(b) === key(credited) ? 1 : 0,
    );
  }
  let first = null;
  for (const origin of sorted) {
    const res = await checkRemix(origin, lookup);
    if (res.error) return res;
    if (!first) first = res.remixedFrom;
  }
  return { remixedFrom: first };
}

module.exports = { remixOrigin, checkRemix, checkRemixAll };
