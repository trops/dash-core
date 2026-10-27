/**
 * packageRef.js
 *
 * One way to name a registry package, and one record of which package a
 * dashboard, theme, bot or team came from (dash-profiles v2 groundwork).
 *
 * Each kind used to record this differently — `@scope/name`, `scope/name`
 * or a bare name, with or without a version, in `_dashboardConfig`,
 * `_registryMeta`, `installedFrom` or `published`. Install and publish now
 * also write `registryRef`:
 *
 *   { package: "@scope/name", kind, version, origin, at }
 *
 * `origin` is "installed" (downloaded from the registry) or "published"
 * (published from this computer). `readRegistryRef` reads it, falling back
 * to the older fields, so items installed or published before it existed
 * are understood without a migration.
 */

const KINDS = ["dashboard", "theme", "bot", "bot-team", "widget"];
const ORIGINS = ["installed", "published"];

// Registry scopes are usernames; package names are slugs.
const SCOPE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

/**
 * `{ scope, name, id: "@scope/name" }` for "@scope/name", "scope/name" or
 * `{ scope, name }`; null for a bare name (its scope is unknown) or
 * anything malformed.
 */
function normalizePackageRef(input) {
  let scope;
  let name;
  if (input && typeof input === "object") {
    scope = input.scope;
    name = input.name;
    if (!scope && typeof name === "string") return normalizePackageRef(name);
  } else if (typeof input === "string") {
    const m = input.trim().match(/^@?([^/]+)\/([^/]+)$/);
    if (!m) return null;
    scope = m[1];
    name = m[2];
  } else {
    return null;
  }
  scope = String(scope || "").replace(/^@/, "");
  name = String(name || "");
  if (!SCOPE_RE.test(scope) || !NAME_RE.test(name)) return null;
  return { scope, name, id: `@${scope}/${name}` };
}

/** The last part of a package name, lowercased: "@trops/Kitchen" → "kitchen". */
function bareName(pkg) {
  return String(pkg || "")
    .replace(/^@/, "")
    .split("/")
    .pop()
    .toLowerCase();
}

/** A `registryRef` to store on a record, or null when the package is unknown. */
function makeRegistryRef({ package: pkg, kind, version, origin, at } = {}) {
  const ref = normalizePackageRef(pkg);
  if (!ref || !KINDS.includes(kind) || !ORIGINS.includes(origin)) return null;
  return {
    package: ref.id,
    kind,
    version: typeof version === "string" && version ? version : null,
    origin,
    at: at || new Date().toISOString(),
  };
}

// What `readRegistryRef` returns: `package` is "@scope/name", or null when
// an older record kept only a bare name; `name` is always the bare name,
// lowercased.
function found(pkg, kind, version, origin) {
  const ref = normalizePackageRef(pkg);
  const name = ref ? ref.name.toLowerCase() : bareName(pkg);
  if (!name) return null;
  return {
    package: ref ? ref.id : null,
    name,
    kind,
    version: typeof version === "string" && version ? version : null,
    origin,
  };
}

/**
 * Which registry package a record was installed or published as.
 *
 * @param {"dashboard"|"theme"|"bot"|"bot-team"|"widget"} kind
 * @param {object} record  a workspace, theme, bot, team settings object
 *   (`getTeamSettings`) or widget registry entry
 * @returns {{package: string|null, name: string, kind: string,
 *   version: string|null, origin: "installed"|"published"|"local"}|null}
 */
function readRegistryRef(kind, record) {
  if (!record || typeof record !== "object") return null;
  const r = record.registryRef;
  if (r && r.kind === kind && normalizePackageRef(r.package)) {
    return found(r.package, kind, r.version, r.origin);
  }

  if (kind === "dashboard") {
    const c = record._dashboardConfig || {};
    if (c.registryScope && c.registryPackage && c.version) {
      return found(
        { scope: c.registryScope, name: bareName(c.registryPackage) },
        kind,
        c.version,
        "published",
      );
    }
    if (c.registryPackage) {
      return c.version
        ? found(c.registryPackage, kind, c.version, "published")
        : found(c.registryPackage, kind, c.installedVersion, "installed");
    }
    return null;
  }

  if (kind === "theme") {
    const m = record._registryMeta || {};
    if (!m.packageName) return null;
    if (m.lastPublishedVersion) {
      return found(m.packageName, kind, m.lastPublishedVersion, "published");
    }
    return found(m.packageName, kind, record.version, "installed");
  }

  if (kind === "bot" || kind === "bot-team") {
    const p = record.published;
    if (p && p.name) return found(p.name, kind, p.version, "published");
    const i = record.installedFrom;
    if (i && i.package) return found(i.package, kind, i.version, "installed");
    return null;
  }

  if (kind === "widget") {
    const pkg =
      record.packageId ||
      (record.scope && record.name
        ? { scope: record.scope, name: bareName(record.name) }
        : record.name);
    if (!pkg) return null;
    return found(
      pkg,
      kind,
      record.version,
      record.installSource === "registry" ? "installed" : "local",
    );
  }
  return null;
}

/**
 * Whether two `readRegistryRef` results name the same package. When either
 * kept only a bare name, the bare names are compared.
 */
function samePackage(a, b) {
  if (!a || !b) return false;
  if (a.package && b.package) {
    return a.package.toLowerCase() === b.package.toLowerCase();
  }
  return a.name === b.name;
}

/** A copy of a record without its `registryRef` (for sharing or copying). */
function withoutRegistryRef(record) {
  if (!record || typeof record !== "object") return record;
  const { registryRef: _ref, ...rest } = record;
  return rest;
}

// Where a dashboard came from: `registryRef`, and `_dashboardConfig` (the
// older record — install source, version, author, whether it can be
// published).
const PACKAGE_FIELDS = ["registryRef", "_dashboardConfig"];

/**
 * The record to store when `incoming` replaces `existing`: the dashboard
 * editor saves from a model that doesn't carry where the dashboard came
 * from, so the stored fields are kept unless the incoming record has them
 * (even as undefined, to clear one).
 */
function keepRegistryRef(incoming, existing) {
  if (!incoming || !existing) return incoming;
  let out = incoming;
  for (const field of PACKAGE_FIELDS) {
    if (field in incoming || existing[field] === undefined) continue;
    if (out === incoming) out = { ...incoming };
    out[field] = existing[field];
  }
  return out;
}

module.exports = {
  KINDS,
  withoutRegistryRef,
  keepRegistryRef,
  normalizePackageRef,
  bareName,
  makeRegistryRef,
  readRegistryRef,
  samePackage,
};
