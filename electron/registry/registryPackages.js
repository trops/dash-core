/**
 * registryPackages.js
 *
 * What the registry knows about one package, and the publish decisions
 * that follow from it (dash-profiles v2 groundwork):
 *
 *   - getPackageInfo: its kind, versions, latest version and visibility,
 *     as the signed-in user sees it;
 *   - nextFreeVersion: the version to publish — never one the registry
 *     already has (it refuses those), never below its newest;
 *   - kindConflict: the name already belongs to another kind of package
 *     (the registry refuses that too; this says so before publishing).
 */
const { isNewerVersion } = require("../utils/isNewerVersion");
const { normalizePackageRef } = require("./packageRef");

function registryBase() {
  return (
    process.env.DASH_REGISTRY_API_URL ||
    "https://main.d919rwhuzp7rj.amplifyapp.com"
  );
}

/**
 * The registry's details for "@scope/name".
 *
 * @param {string|{scope: string, name: string}} pkg
 * @param {{fetch?: Function, authFailuresUnreachable?: boolean}} [opts]
 *   `fetch`: a fetch to use (tests); defaults to the signed-in
 *   `authedFetch`. `authFailuresUnreachable`: a 401/403 (the sign-in wasn't
 *   accepted) answers "unreachable" rather than "not there" — for deciding
 *   a name is free.
 * @returns {Promise<object|null|"unreachable">} null when it isn't there or
 *   this user can't see it (the registry answers 404 for someone else's
 *   private package); "unreachable" when the registry couldn't be asked
 */
async function getPackageInfo(pkg, opts = {}) {
  const ref = normalizePackageRef(pkg);
  if (!ref) return null;
  const doFetch =
    opts.fetch || require("../controller/registryAuthController").authedFetch;
  let res;
  try {
    res = await doFetch(
      `${registryBase()}/api/packages/${encodeURIComponent(ref.scope)}/${encodeURIComponent(ref.name)}`,
    );
  } catch (_e) {
    return "unreachable";
  }
  if (res && (res.status === 401 || res.status === 403)) {
    return opts.authFailuresUnreachable ? "unreachable" : null;
  }
  if (!res || res.status === 404) return null;
  if (!res.ok) return "unreachable";
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== "object") return "unreachable";
  return {
    package: ref.id,
    scope: ref.scope,
    name: ref.name,
    // Packages published before kinds existed are widgets.
    type: body.type || "widget",
    latestVersion: body.latestVersion || null,
    versions: (Array.isArray(body.versions) ? body.versions : [])
      .map((v) => v && v.version)
      .filter(Boolean),
    visibility: body.visibility || null,
  };
}

function bumpPatch(version) {
  const m = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return "1.0.0";
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** The first version at or after `version` that isn't in `taken`. */
function freeVersion(version, taken) {
  const have = new Set(taken || []);
  let v = /^\d+\.\d+\.\d+/.test(String(version || "")) ? version : "1.0.0";
  // Never below what's published: start past the newest taken version.
  for (const t of have) {
    if (isNewerVersion(t, v)) v = t;
  }
  while (have.has(v)) v = bumpPatch(v);
  return v;
}

/**
 * The version to publish next: this computer's version, or the next free
 * one when the registry already has it (or anything newer).
 *
 * @param {string|null} localVersion
 * @param {object|null|"unreachable"} info  getPackageInfo's answer
 */
function nextFreeVersion(localVersion, info) {
  const taken = info && typeof info === "object" ? info.versions : [];
  return freeVersion(localVersion, taken);
}

/**
 * Why `pkg` can't be published as a `kind` package, or null. Mirrors the
 * registry's rule: a package keeps its kind.
 */
function kindConflict(pkg, kind, info) {
  if (!info || typeof info !== "object") return null;
  const was = info.type || "widget";
  const now = kind || "widget";
  if (was === now) return null;
  const ref = normalizePackageRef(pkg);
  const id = ref ? ref.id : String(pkg);
  return `"${id}" is already a ${was} package — a ${now} can't be published under the same name. Choose another name.`;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The registry entry to install, at an exact version when one is asked for
 * (profiles list exact versions) — otherwise the latest.
 *
 * @param {string} ref  any form registryController.getPackage accepts
 * @param {{kinds?: string[], version?: string}} [opts]  the package kinds
 *   this install accepts ("dashboard", "theme", "bot"/"bot-team"…)
 * @param {{getPackage?: Function, refreshIndex?: Function}} [deps]
 * @returns {Promise<{pkg: object}|{error: string}>} `pkg.version` is the
 *   version to download
 */
async function resolveForInstall(ref, opts = {}, deps = {}) {
  const registry = () => require("../controller/registryController");
  const lookup = deps.getPackage || ((r) => registry().getPackage(r));
  const refresh =
    deps.refreshIndex || (() => registry().fetchRegistryIndex(true));
  let pkg = await lookup(ref);
  // Published from another computer a moment ago: the cached index (a few
  // minutes old) may not list it yet.
  if (!pkg && normalizePackageRef(ref)) {
    try {
      await refresh();
    } catch (_e) {
      // the lookup below says it wasn't found
    }
    pkg = await lookup(ref);
  }
  if (!pkg) return { error: `"${ref}" was not found in the registry.` };
  // A listing without a kind isn't refused here: the download itself shows
  // whether it's the right kind of package.
  if (pkg.type && Array.isArray(opts.kinds) && !opts.kinds.includes(pkg.type)) {
    return { error: `"${ref}" is a ${pkg.type}, not a ${opts.kinds[0]}.` };
  }
  const exact =
    typeof opts.version === "string" && EXACT_VERSION.test(opts.version)
      ? opts.version
      : null;
  // Asked for a version that isn't one ("^1.2.0"): say so rather than
  // quietly installing — and recording — the latest. "*" / "latest" mean it.
  if (opts.version && !exact && !["*", "latest"].includes(opts.version)) {
    return { error: `"${opts.version}" isn't a version of "${ref}".` };
  }
  return {
    pkg: {
      ...pkg,
      version: exact || pkg.version || pkg.latestVersion || "1.0.0",
    },
  };
}

/** The registry download endpoint for "@scope/name" at `version` (or the latest). */
function packageDownloadUrl(pkg, version) {
  const ref = normalizePackageRef(pkg);
  if (!ref) return null;
  return `${registryBase()}/api/packages/${encodeURIComponent(ref.scope)}/${encodeURIComponent(
    ref.name,
  )}/download${version ? `?version=${encodeURIComponent(version)}` : ""}`;
}

/**
 * Whether a package scope is the signed-in user's own — what they can
 * publish again (the registry only accepts publishes under your username).
 */
function isOwnScope(scope, username) {
  let user = username;
  if (user === undefined) {
    try {
      user =
        require("../controller/registryAuthController").getStoredUsername();
    } catch (_e) {
      user = null;
    }
  }
  const a = String(scope || "")
    .replace(/^@/, "")
    .toLowerCase();
  const b = String(user || "")
    .replace(/^@/, "")
    .toLowerCase();
  return !!a && a === b;
}

/**
 * Where an installed theme goes in `themes` (keyed by name): over the theme
 * already installed from or published as this package, else under its own
 * name — and when another theme has that name, "<name> (2)" and so on,
 * never over it.
 */
function themeKeyFor(themes, pkg, preferredKey) {
  const {
    readRegistryRef,
    samePackage,
    normalizePackageRef: norm,
  } = require("./packageRef");
  const want = norm(pkg);
  const all = themes && typeof themes === "object" ? themes : {};
  if (want) {
    const target = { package: want.id, name: want.name.toLowerCase() };
    for (const [key, theme] of Object.entries(all)) {
      const ref = readRegistryRef("theme", theme);
      // Older records may keep only a bare name; only a scoped match counts.
      if (ref && ref.package && samePackage(ref, target)) return key;
    }
  }
  const base = String(preferredKey || (want && want.name) || "Theme");
  if (!Object.prototype.hasOwnProperty.call(all, base)) return base;
  // An older install under that name that kept only the bare package name:
  // the same package, so it's updated.
  const there = readRegistryRef("theme", all[base]);
  if (
    want &&
    there &&
    !there.package &&
    there.name === want.name.toLowerCase()
  ) {
    return base;
  }
  for (let n = 2; ; n++) {
    const key = `${base} (${n})`;
    if (!Object.prototype.hasOwnProperty.call(all, key)) return key;
  }
}

const MAX_NAME_TRIES = 50;

/**
 * Where publishing a dashboard, theme, bot or team without asking goes
 * (user, 2026-10-27: pick a free name automatically and show it):
 *
 *   - an item already published from (or installed from) the user's own
 *     account keeps that package — later publishes are new versions of it;
 *   - otherwise a slug of its name under the user's scope, "-2", "-3"… when
 *     that name is taken — by another item of the user's, of any kind —
 *     so a different item never lands on top of an existing package.
 *
 * The version is this computer's, or the next one the registry doesn't
 * have. A new package is private; an existing one keeps its visibility
 * (none is sent).
 *
 * @param {{kind: string, record: object, displayName: string,
 *   localVersion?: string, username: string}} item
 * @param {(pkg: string) => Promise<object|null|"unreachable">} [lookup]
 * @returns {Promise<{package: string, name: string, version: string,
 *   exists: boolean, visibility?: "private", renamed: boolean}|{error: string}>}
 */
async function planPackagePublish(
  item,
  // A sign-in the registry didn't accept isn't "no such package" (it hides
  // private packages behind a 404/401): only a clear "not there" is free.
  lookup = (pkg) => getPackageInfo(pkg, { authFailuresUnreachable: true }),
) {
  const { readRegistryRef } = require("./packageRef");
  const {
    slugifyPackageName,
    suffixedPackageName,
  } = require("../schema/dashboardConfigUtils");
  const user = String(item.username || "").replace(/^@/, "");
  if (!user) return { error: "Sign in to publish." };
  const kind = item.kind;
  const ref = readRegistryRef(kind, item.record);
  const bound = ref && ref.package ? normalizePackageRef(ref.package) : null;
  const ownBound = bound && isOwnScope(bound.scope, user) ? bound.name : null;
  const slug = slugifyPackageName(
    item.displayName,
    kind === "bot-team" ? "team" : kind,
  );
  // Its own package continues from its version; a new package (even of
  // something installed from someone else) starts fresh.
  const localVersion = ownBound
    ? item.localVersion || (ref && ref.version) || null
    : null;

  const at = (name) => `@${user}/${name}`;
  const ready = (name, info, renamed) => ({
    package: at(name),
    name,
    version: nextFreeVersion(localVersion, info),
    exists: !!info,
    ...(info ? {} : { visibility: "private" }),
    renamed,
  });

  // Already this package: a new version of it (or, if it was deleted from
  // the registry, published again under the same name).
  if (ownBound) {
    const info = await lookup(at(ownBound));
    if (info === "unreachable") {
      return { error: "Couldn't reach the registry right now." };
    }
    if (!info || !kindConflict(at(ownBound), kind, info)) {
      return ready(ownBound, info, false);
    }
    // Its name now belongs to another kind of package: a free name below.
  }

  for (let n = 1; n <= MAX_NAME_TRIES; n++) {
    const name = n === 1 ? slug : suffixedPackageName(slug, n);
    const info = await lookup(at(name));
    if (info === "unreachable") {
      return { error: "Couldn't reach the registry right now." };
    }
    if (!info) return ready(name, null, name !== slug || !!ownBound);
  }
  return {
    error: `Couldn't find a free name for "${item.displayName}" — rename it and try again.`,
  };
}

module.exports = {
  EXACT_VERSION,
  isOwnScope,
  themeKeyFor,
  planPackagePublish,
  resolveForInstall,
  packageDownloadUrl,
  getPackageInfo,
  nextFreeVersion,
  freeVersion,
  bumpPatch,
  kindConflict,
};
