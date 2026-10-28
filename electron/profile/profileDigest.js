/**
 * profileDigest.js
 *
 * What a profile holds on this computer, as fingerprints — so the
 * out-of-sync check (dash-profiles step 2, S3) can say "you changed 2
 * dashboards here" since the profile was last saved to or loaded from the
 * account, without asking the registry.
 *
 * A digest is `{ dashboards, bots, themes, folders, widgets }`, each
 * `{ id: hash }` for what the profile holds (Default without profiles:
 * everything). A hash covers what a v3 profile save carries — the setup
 * record as the profile keeps it (profileSetup.setupHash: keys blanked,
 * times and run state left out, so opening a dashboard or a bot run isn't
 * a change) — and, per widget its dashboards use, the registry version
 * installed. A widget built or edited here and not published counts as
 * "built here", whatever its version: unpublished edits aren't changes to
 * the profile (the first edit to a published widget counts once).
 */
const crypto = require("crypto");

const KINDS = ["dashboards", "bots", "themes", "folders", "widgets"];

function defaultDeps() {
  const fileOf = (name, fallback) => (appId) => {
    const { getFileContents } = require("../utils/file");
    const { getAppFilePath } = require("../utils/appPaths");
    return getFileContents(getAppFilePath(appId, name), fallback);
  };
  return {
    // Loaded only when used (it needs Electron).
    store: null,
    workspaceFile: fileOf("workspaces.json", []),
    themeFile: fileOf("themes.json", {}),
    folderFile: fileOf("menuItems.json", []),
    widgetRegistry: () => {
      try {
        return require("../widgetRegistry").getWidgetRegistry();
      } catch (_e) {
        return null;
      }
    },
    allBots: () => {
      try {
        const c = require("../controller/botController");
        return c && c._ready ? c._store.list() : [];
      } catch (_e) {
        return [];
      }
    },
  };
}

function hashOf(value) {
  const { stableStringify } = require("../registry/fingerprint");
  return crypto
    .createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 16);
}

const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

/** The digest of what \`profileId\` holds now. */
function profileDigest(appId, profileId, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!d.store) d.store = require("./profileStore");
  const {
    setupHash,
    comparableDashboard,
    installedWidget,
  } = require("./profileSetup");
  const { secretFieldLookup } = require("./secretFields");
  const profile = d.store.list(appId).find((p) => p.id === profileId);
  if (!profile) return null;
  const explicit = d.store.hasProfiles(appId);
  const holds = (kind) =>
    explicit ? new Set(list(profile.items && profile.items[kind])) : null;
  const held = (kind, id) => {
    const ids = holds(kind);
    return ids === null || ids.has(String(id));
  };
  const registry = d.widgetRegistry();
  const secretFieldsFor = secretFieldLookup(registry);

  const out = {
    dashboards: {},
    bots: {},
    themes: {},
    folders: {},
    widgets: {},
  };
  const dashboards = list(d.workspaceFile(appId)).filter(
    (w) => w.id != null && held("dashboards", w.id),
  );
  for (const w of dashboards) {
    out.dashboards[String(w.id)] = setupHash(
      "dashboards",
      comparableDashboard(w, secretFieldsFor),
    );
  }
  for (const b of list(d.allBots())) {
    if (b.system === "dash-team" || b.id == null) continue;
    // Leads aren't changes (the app makes one when its dashboard opens
    // and rewrites it on upgrade).
    if (b.role === "lead") continue;
    if (!held("bots", b.id)) continue;
    out.bots[String(b.id)] = setupHash("bots", b);
  }
  const themes = d.themeFile(appId) || {};
  for (const key of Object.keys(themes)) {
    if (!held("themes", key)) continue;
    out.themes[key] = setupHash("themes", themes[key]);
  }
  for (const f of list(d.folderFile(appId))) {
    if (f.id == null || !held("folders", f.id)) continue;
    out.folders[String(f.id)] = setupHash("folders", f);
  }
  if (registry) {
    const {
      collectDependencyRefsFromWorkspace,
      buildWidgetDependencies,
    } = require("../schema/dashboardConfigUtils");
    for (const w of dashboards) {
      for (const dep of buildWidgetDependencies(
        collectDependencyRefsFromWorkspace(w),
        registry,
      )) {
        const pkg = packageIdOf(dep || {});
        if (!pkg || out.widgets[pkg]) continue;
        const installed = installedWidget(registry, pkg);
        // From the registry (or installed before Dash recorded where from).
        const fromRegistry =
          !!installed &&
          !pkg.startsWith("@ai-built/") &&
          (installed.installSource === "registry" ||
            (!installed.installSource && !installed.copiedFromFolder));
        out.widgets[pkg] = hashOf(
          fromRegistry ? installed.version || null : "built-here",
        );
      }
    }
  }
  return out;
}

/** "@scope/name" for a dashboard's widget dependency. */
function packageIdOf(dep) {
  const scope = String(dep.scope || "").replace(/^@/, "");
  const name = String(dep.packageName || dep.package || "");
  if (!name) return null;
  if (name.startsWith("@")) return name;
  return scope ? `@${scope}/${name}` : name;
}

/**
 * What changed between a recorded digest and now: per kind, how many were
 * added, removed or changed, and the total. No recorded digest: nothing is
 * known to have changed.
 */
function digestChanges(before, now) {
  const counts = {};
  let total = 0;
  for (const kind of KINDS) {
    const a = (before && before[kind]) || {};
    const b = (now && now[kind]) || {};
    let n = 0;
    if (before) {
      for (const id of Object.keys(b)) if (a[id] !== b[id]) n += 1;
      for (const id of Object.keys(a)) if (!(id in b)) n += 1;
    }
    counts[kind] = n;
    total += n;
  }
  return { ...counts, total };
}

/** A digest read back from disk, checked (anything odd is dropped). */
function cleanDigest(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const kind of KINDS) {
    out[kind] = {};
    const src = raw[kind];
    if (!src || typeof src !== "object") continue;
    for (const [id, h] of Object.entries(src)) {
      if (typeof h === "string" && /^[0-9a-f]{16}$/.test(h)) out[kind][id] = h;
    }
  }
  return out;
}

/**
 * How a profile here compares with its account copy: `link` is what this
 * computer last saved or loaded (revision + digest), `remoteRevision` the
 * account's revision now, `now` the profile's digest now. `state`:
 * "in-sync", "account-newer", "local-changed" or "both".
 */
function compareWithAccount(link, remoteRevision, now) {
  const changes = digestChanges(cleanDigest(link && link.digest), now);
  const accountNewer = remoteRevision !== ((link && link.revision) ?? null);
  const localChanged = changes.total > 0;
  return {
    state:
      accountNewer && localChanged
        ? "both"
        : accountNewer
          ? "account-newer"
          : localChanged
            ? "local-changed"
            : "in-sync",
    changes,
  };
}

module.exports = {
  profileDigest,
  digestChanges,
  cleanDigest,
  compareWithAccount,
};
