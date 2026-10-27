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
 * @param {{fetch?: Function}} [opts] a fetch to use (tests); defaults to
 *   the signed-in `authedFetch`
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
  if (!res || res.status === 404 || res.status === 401 || res.status === 403) {
    return null;
  }
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

module.exports = {
  EXACT_VERSION,
  isOwnScope,
  themeKeyFor,
  resolveForInstall,
  packageDownloadUrl,
  getPackageInfo,
  nextFreeVersion,
  freeVersion,
  bumpPatch,
  kindConflict,
};
