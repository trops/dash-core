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

module.exports = {
  getPackageInfo,
  nextFreeVersion,
  freeVersion,
  bumpPatch,
  kindConflict,
};
