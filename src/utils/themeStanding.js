/**
 * themeStanding.js — whose a saved theme is, for changing it through the
 * Dash team (lead-workspace theme change round). The user's own theme is
 * changed in place and can be published; one downloaded from the registry
 * is never changed — the change is saved as a remix that credits its
 * author. Pure; the main process requires it too (like themeGenerator).
 */
// ".js": the main process loads this as an ES module.
import { toDisplayColor } from "./colorUtils.js";

export const THEME_CHANNELS = ["primary", "secondary", "tertiary", "neutral"];

const scopeOf = (pkg) => {
  const m = /^@([^/]+)\//.exec(String(pkg || ""));
  return m ? `@${m[1]}` : null;
};

/** A package under the signed-in user's own registry scope (theme change
 * leftovers): theirs, wherever it was installed. */
export function isOwnPackage(pkg, username) {
  const scope = scopeOf(pkg);
  const user = String(username || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
  return !!scope && !!user && scope.slice(1).toLowerCase() === user;
}

/**
 * Downloaded from the registry (installed, never published from here):
 * its package, version and author — null for the user's own theme (made
 * here, a copy, published from here, or — `username` given — installed
 * from their own registry scope).
 * @param {object} raw  a saved (raw) theme
 * @param {{ username?: string|null }} [opts]
 * @returns {{ package: string, version: string|null, author: string|null }|null}
 */
export function themeOrigin(raw, { username = null } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const ref = raw.registryRef;
  const meta = raw._registryMeta;
  let pkg = null;
  let version = null;
  if (ref && ref.package) {
    if (ref.origin !== "installed") return null;
    pkg = ref.package;
    version = ref.version || null;
  } else if (meta && meta.packageName && !meta.lastPublishedVersion) {
    pkg = String(meta.packageName).startsWith("@")
      ? meta.packageName
      : meta.scope
        ? `@${String(meta.scope).replace(/^@/, "")}/${meta.packageName}`
        : meta.packageName;
    version = raw.version || null;
  } else {
    return null;
  }
  if (isOwnPackage(pkg, username)) return null;
  const author =
    (typeof raw.author === "string" && raw.author.trim()) || scopeOf(pkg);
  return { package: pkg, version, author: author || null };
}

/**
 * Published from here — or, `username` given, installed from the user's
 * own scope: its package and the version the registry has; null when it
 * was never published.
 * @returns {{ package: string, version: string|null }|null}
 */
export function themePublished(raw, { username = null } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const ref = raw.registryRef;
  if (
    ref &&
    ref.package &&
    (ref.origin === "published" ||
      (ref.origin === "installed" && isOwnPackage(ref.package, username)))
  ) {
    return { package: ref.package, version: ref.version || null };
  }
  const meta = raw._registryMeta;
  if (meta && meta.packageName && meta.lastPublishedVersion) {
    const pkg = String(meta.packageName);
    return {
      package: pkg.startsWith("@") ? pkg : `@${pkg}`,
      version: meta.lastPublishedVersion,
    };
  }
  return null;
}

/** A theme's four colors as #rrggbb where they're known (a Tailwind family
 * name becomes its display hex). */
export function themeColors(raw) {
  const out = {};
  for (const c of THEME_CHANNELS) {
    const v = raw && raw[c];
    if (typeof v === "string" && v.trim()) {
      out[c] = String(toDisplayColor(v)).toLowerCase();
    }
  }
  return out;
}

/** Whether the theme editor changed anything in it (kept by a change). */
export function hasEditorChanges(raw) {
  const has = (v) => !!v && typeof v === "object" && Object.keys(v).length > 0;
  return !!raw && (has(raw.dark) || has(raw.light));
}

/** "Dusk (remix)" — or "Dusk (remix 2)" when that's taken. */
export function remixName(name, taken = []) {
  const lower = new Set(taken.map((n) => String(n || "").toLowerCase()));
  const base = `${String(name || "Theme").trim()} (remix)`;
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i += 1) {
    const next = `${String(name || "Theme").trim()} (remix ${i})`;
    if (!lower.has(next.toLowerCase())) return next;
  }
  return `${base} ${Date.now()}`;
}

/**
 * A saved theme by its name — the one the plan's piece names, any case.
 * @param {object} themes  { key: raw }
 * @returns {[string, object]|null}  [key, raw], or null when none or more
 *   than one has that name
 */
export function themeByName(themes, name) {
  const want = String(name || "")
    .trim()
    .toLowerCase();
  if (!want) return null;
  const hits = Object.entries(themes || {}).filter(
    ([, t]) =>
      t &&
      String(t.name || "")
        .trim()
        .toLowerCase() === want,
  );
  return hits.length === 1 ? hits[0] : null;
}
