/**
 * profileFile.js
 *
 * Save a profile to a .dashprofile file (dash-profiles PRD, PR 4): a zip of
 * the profile's own records, as they are — ids, widget settings, pages —
 * so loading it on another computer restores exactly this setup. Secrets
 * and things that only make sense on this computer are left out.
 *
 *   manifest.json   kind, profileId, name, revision, createdAt/On, counts,
 *                   dashboardHashes
 *   profile.json    the profile's id lists
 *   dashboards.json folders.json themes.json bots.json providers.json
 *   settings.json   app theme + update check only
 *   widgets.json    [{ package, version, source, status, registryVersion }]
 *   widgets/<package>/…  copies of widgets the registry doesn't have
 *
 * Every widget is checked against the registry by exact version: only an
 * exact, registry-installed version is referenced; anything else (newer
 * here, a local build, not published, @ai-built) is copied into the file.
 */
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { isNewerVersion } = require("../utils/isNewerVersion");

const PROFILE_FILE_SCHEMA_VERSION = 1;
const PROFILE_FILE_KIND = "dash-profile";
const PROFILE_FILE_EXTENSION = "dashprofile";

// Widget code copied into one file stops here (the save says so).
const MAX_BUNDLED_BYTES = 250 * 1024 * 1024;

// Package ids that are safe as a folder path inside the zip.
const SAFE_PACKAGE_ID = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

// Folders never copied with a bundled widget.
const SKIP_DIRS = new Set(["node_modules", ".git", ".cache", ".staging"]);

// Dashboard fields that change on their own (opening, saving) and must not
// make two copies of the same dashboard look different.
const VOLATILE_DASHBOARD_FIELDS = new Set([
  "dateEdited",
  "date_edited",
  "dateUpdated",
  "updatedAt",
  "lastOpened",
  "lastOpenedAt",
  "activePageId",
]);

// ---- pure helpers ---------------------------------------------------------

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** A fingerprint of a dashboard that ignores fields that change by themselves. */
function dashboardHash(workspace) {
  const copy = {};
  for (const key of Object.keys(workspace || {})) {
    if (!VOLATILE_DASHBOARD_FIELDS.has(key)) copy[key] = workspace[key];
  }
  return crypto
    .createHash("sha256")
    .update(stableStringify(copy))
    .digest("hex")
    .slice(0, 32);
}

/** A bot definition without what only makes sense on this computer. */
function portableBot(bot) {
  // The conversation session belongs to this computer's engine; runs,
  // results, memory and approvals aren't part of the definition at all.
  const { session, ...rest } = bot || {};
  return rest;
}

/** App settings worth carrying: the app theme and the update check. */
function portableSettings(settings) {
  const s = settings || {};
  const out = {};
  if (s.theme) out.theme = s.theme;
  if (typeof s.checkForUpdatesOnLaunch === "boolean") {
    out.checkForUpdatesOnLaunch = s.checkForUpdatesOnLaunch;
  }
  return out;
}

function splitPackage(pkg) {
  const stripped = String(pkg || "").replace(/^@/, "");
  const [scope, ...rest] = stripped.split("/");
  return rest.length ? { scope, name: rest.join("/") } : null;
}

/**
 * Where a widget comes from on the other computer.
 *
 * @param {{package: string, version: string}} dep
 * @param {object|null} installed  this computer's registry.json entry
 * @param {{versions: string[], latestVersion?: string}|null|"unreachable"} info
 *   the registry's answer: null = not there (or not yours), "unreachable"
 *   = couldn't ask
 */
function classifyWidget(dep, installed, info) {
  const version =
    (installed && installed.version) ||
    (dep.version && dep.version !== "*" ? dep.version : null);
  const base = { package: dep.package, version, registryVersion: null };
  const bundled = (status) => ({ ...base, source: "bundled", status });

  if (String(dep.package).startsWith("@ai-built/")) {
    return bundled("not-in-registry");
  }
  if (info === "unreachable") {
    return { ...base, source: "registry", status: "unchecked" };
  }
  if (!info) return bundled("not-in-registry");

  const versions = info.versions || [];
  const latest = info.latestVersion || versions[0] || null;
  base.registryVersion = latest;
  // Published from here (PR 4b) counts as the registry's code.
  const localBuild =
    !!installed &&
    installed.installSource !== "registry" &&
    (installed.copiedFromFolder ||
      installed.installSource === "local" ||
      installed.installSource === "url");

  if (version && versions.includes(version)) {
    if (localBuild) return bundled("local-build");
    return {
      ...base,
      source: "registry",
      // Installed before Dash recorded where widgets come from: the same
      // version is in the registry, so it's assumed to be the same code.
      status:
        installed && !installed.installSource
          ? "assumed-registry"
          : "in-registry",
      updateAvailable: !!latest && isNewerVersion(latest, version),
    };
  }
  if (version && latest && isNewerVersion(version, latest)) {
    return bundled("newer-here");
  }
  return bundled("version-missing");
}

/**
 * The JSON files of a .dashprofile (bundled widget folders are added by
 * the caller). Pure.
 */
function buildProfileFiles({
  profile,
  dashboards = [],
  folders = [],
  themes = {},
  bots = [],
  providers = [],
  settings = null,
  widgets = [],
  secretsLeftOut = [],
  revision = 1,
  createdOn = null,
  appVersion = null,
  now = new Date(),
}) {
  const dashboardHashes = {};
  for (const d of dashboards) dashboardHashes[String(d.id)] = dashboardHash(d);
  const manifest = {
    schemaVersion: PROFILE_FILE_SCHEMA_VERSION,
    kind: PROFILE_FILE_KIND,
    profileId: profile.id,
    name: profile.name,
    revision,
    createdAt: now.toISOString(),
    createdOn,
    appVersion,
    counts: {
      dashboards: dashboards.length,
      folders: folders.length,
      themes: Object.keys(themes).length,
      bots: bots.length,
      providers: providers.length,
      widgets: widgets.length,
      bundledWidgets: widgets.filter((w) => w.source === "bundled").length,
    },
    dashboardHashes,
    // Secret settings left out — the loading computer asks for them.
    secretsToEnter: secretsLeftOut,
  };
  const json = (v) => Buffer.from(JSON.stringify(v, null, 2), "utf8");
  const files = {
    "manifest.json": json(manifest),
    "profile.json": json({
      id: profile.id,
      name: profile.name,
      items: {
        dashboards: dashboards.map((d) => String(d.id)),
        folders: folders.map((f) => String(f.id)),
        themes: Object.keys(themes),
        bots: bots.map((b) => String(b.id)),
      },
    }),
    "dashboards.json": json(dashboards),
    "folders.json": json(folders),
    "themes.json": json(themes),
    "bots.json": json(bots.map(portableBot)),
    "providers.json": json(providers),
    "widgets.json": json(widgets),
  };
  if (settings) files["settings.json"] = json(portableSettings(settings));
  return { files, manifest };
}

// ---- gathering (main process) ---------------------------------------------

function defaultDeps() {
  return {
    store: require("./profileStore"),
    workspaceFile: (appId) =>
      require("../utils/file").getFileContents(
        require("../utils/appPaths").getAppFilePath(appId, "workspaces.json"),
      ),
    folderFile: (appId) =>
      require("../utils/file").getFileContents(
        require("../utils/appPaths").getAppFilePath(appId, "menuItems.json"),
      ),
    themeFile: (appId) =>
      require("../utils/file").getFileContents(
        require("../utils/appPaths").getAppFilePath(appId, "themes.json"),
        {},
      ),
    allBots: () => {
      const bots = require("../controller/botController");
      return bots && bots._ready ? bots._store.list() : [];
    },
    providers: (appId) =>
      (
        require("../controller/providerController").listProviders(
          null,
          appId,
        ) || {}
      ).providers || [],
    settings: () =>
      require("../controller/settingsController").getSettingsForApplication(
        null,
      )?.settings || {},
    widgetRegistry: () => require("../widgetRegistry").getWidgetRegistry(),
    lookupPackage: lookupRegistryPackage,
    appVersion: () => {
      try {
        return require("electron").app.getVersion();
      } catch (_e) {
        return null;
      }
    },
  };
}

/** The registry's versions of a package, as this user sees them. */
async function lookupRegistryPackage(pkg) {
  const ref = splitPackage(pkg);
  if (!ref) return null;
  const { authedFetch } = require("../controller/registryAuthController");
  const base =
    process.env.DASH_REGISTRY_API_URL ||
    "https://main.d919rwhuzp7rj.amplifyapp.com";
  let res;
  try {
    res = await authedFetch(
      `${base}/api/packages/${encodeURIComponent(ref.scope)}/${encodeURIComponent(ref.name)}`,
    );
  } catch (_e) {
    return "unreachable";
  }
  // Not there, or this user can't download it: the other computer
  // couldn't either, so it goes in the file.
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    return null;
  }
  if (!res.ok) return "unreachable";
  const body = await res.json().catch(() => null);
  if (!body) return "unreachable";
  return {
    latestVersion: body.latestVersion || null,
    versions: (body.versions || []).map((v) => v.version).filter(Boolean),
    visibility: body.visibility || null,
  };
}

/** "@scope/name" for a dependency (or the bare name when it has no scope). */
function packageIdOf(dep) {
  const scope = String(dep.scope || "").replace(/^@/, "");
  const name = String(dep.packageName || dep.package || "");
  if (name.startsWith("@")) return name;
  return scope ? `@${scope}/${name}` : name;
}

function idsOf(list) {
  return new Set((list || []).map(String));
}

function providerNamesIn(value, out) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const v of value) providerNamesIn(v, out);
    return out;
  }
  if (value.selectedProviders && typeof value.selectedProviders === "object") {
    for (const name of Object.values(value.selectedProviders)) {
      if (typeof name === "string") out.add(name);
    }
  }
  for (const key of ["layout", "items", "pages", "sidebarLayout"]) {
    if (value[key]) providerNamesIn(value[key], out);
  }
  return out;
}

/**
 * Everything a profile save writes, gathered and checked — used by the
 * save dialog's preview and by the save itself.
 *
 * @param {{bots?: boolean, providers?: boolean, settings?: boolean}} options
 */
async function gatherProfile(appId, profileId, options = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const opts = { bots: true, providers: true, settings: true, ...options };
  const profile = d.store.list(appId).find((p) => p.id === profileId);
  if (!profile) throw new Error(`No profile with id ${profileId}`);
  // Only Default (no profiles.json): it holds everything.
  const explicit = d.store.hasProfiles(appId);
  const holds = (kind) => (explicit ? idsOf(profile.items[kind]) : null);
  const keep = (kind, list, idOf) => {
    const ids = holds(kind);
    return (Array.isArray(list) ? list : []).filter(
      (x) => x && (ids === null || ids.has(String(idOf(x)))),
    );
  };

  // Secret widget settings (keys typed into a widget) keep their name but
  // not their value: the other computer asks for them.
  const registry = d.widgetRegistry();
  const { blankSecretsInDashboards } = require("./secretFields");
  const { workspaces: dashboards, blanked: secretsLeftOut } =
    blankSecretsInDashboards(
      keep("dashboards", d.workspaceFile(appId), (w) => w.id),
      registry,
    );

  // Folders and themes the dashboards use come along, so nothing on the
  // other computer ends up uncategorized or unstyled.
  const folderIds = holds("folders");
  const usedFolders = new Set(
    dashboards
      .map((w) => w.menuId)
      .filter((x) => x != null)
      .map(String),
  );
  const folders = (d.folderFile(appId) || []).filter(
    (f) =>
      f &&
      (folderIds === null ||
        folderIds.has(String(f.id)) ||
        usedFolders.has(String(f.id))),
  );

  const settings = opts.settings ? d.settings() : null;
  const themeIds = holds("themes");
  const usedThemes = new Set(dashboards.map((w) => w.themeKey).filter(Boolean));
  if (settings && settings.theme) usedThemes.add(settings.theme);
  const allThemes = d.themeFile(appId) || {};
  const themes = {};
  for (const key of Object.keys(allThemes)) {
    if (themeIds === null || themeIds.has(key) || usedThemes.has(key)) {
      themes[key] = allThemes[key];
    }
  }

  let bots = [];
  if (opts.bots) {
    const all = d.allBots().filter((b) => b && b.system !== "dash-team");
    bots = keep("bots", all, (b) => b.id);
    // A dashboard's lead goes with it, held or not.
    const dashIds = new Set(dashboards.map((w) => String(w.id)));
    const have = new Set(bots.map((b) => String(b.id)));
    for (const b of all) {
      if (
        b.role === "lead" &&
        dashIds.has(String(b.workspaceId)) &&
        !have.has(String(b.id))
      ) {
        bots.push(b);
      }
    }
  }

  // Widgets: every package the dashboards use, checked by exact version.
  const {
    collectDependencyRefsFromWorkspace,
    buildWidgetDependencies,
    buildProviderRequirements,
    collectComponentNamesFromWorkspace,
  } = require("../schema/dashboardConfigUtils");
  const refs = [];
  const componentNames = new Set();
  for (const w of dashboards) {
    refs.push(...collectDependencyRefsFromWorkspace(w));
    for (const n of collectComponentNamesFromWorkspace(w))
      componentNames.add(n);
  }
  const deps0 = buildWidgetDependencies(refs, registry);
  const byPackage = new Map();
  for (const dep0 of deps0) {
    if (!dep0 || !(dep0.packageName || dep0.package)) continue;
    // buildWidgetDependencies gives scope and package name apart; the
    // installed registry and the registry API know "@scope/name". A bare
    // name would match an old unscoped install instead.
    const pkg = packageIdOf(dep0);
    if (!byPackage.has(pkg)) byPackage.set(pkg, { ...dep0, package: pkg });
  }
  const widgets = [];
  const installedOf = {};
  for (const dep of byPackage.values()) {
    const installed = registry ? registry.getWidget(dep.package) : null;
    installedOf[dep.package] = installed || null;
    const info = String(dep.package).startsWith("@ai-built/")
      ? null
      : await d.lookupPackage(dep.package);
    widgets.push(classifyWidget(dep, installed, info));
  }

  // Providers the profile uses (by name or by type) — never their keys.
  let providers = [];
  if (opts.providers) {
    const names = providerNamesIn(dashboards, new Set());
    for (const b of bots) {
      if (b.provider) names.add(b.provider);
      for (const s of b.mcpServers || []) {
        if (typeof s === "string") names.add(s);
        else if (s && s.name) names.add(s.name);
      }
    }
    const types = new Set(
      (buildProviderRequirements([...componentNames], registry) || [])
        .map((p) => p && p.type)
        .filter(Boolean),
    );
    const {
      stripProviderCredentials,
    } = require("../controller/exportController");
    const all = (d.providers(appId) || []).filter(Boolean);
    const named = all.filter((p) => names.has(p.name));
    const coveredTypes = new Set(named.map((p) => p.type));
    const defaults = all.filter(
      (p) =>
        types.has(p.type) &&
        !coveredTypes.has(p.type) &&
        !names.has(p.name) &&
        (p.isDefaultForType ||
          all.filter((q) => q.type === p.type).length === 1),
    );
    providers = stripProviderCredentials([...named, ...defaults]);
  }

  return {
    profile,
    explicit,
    dashboards,
    folders,
    themes,
    bots,
    providers,
    settings,
    widgets,
    installedOf,
    secretsLeftOut,
    appVersion: d.appVersion(),
  };
}

function folderSize(dir) {
  const fs = require("fs");
  let total = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return 0;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name) || e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += folderSize(p);
    else if (e.isFile()) {
      try {
        total += fs.lstatSync(p).size;
      } catch (_e) {
        // unreadable: skip
      }
    }
  }
  return total;
}

/** What the save dialog shows before anything is written. */
function summarize(gathered) {
  const bundled = gathered.widgets.filter((w) => w.source === "bundled");
  let bundledBytes = 0;
  for (const w of bundled) {
    const installed = gathered.installedOf[w.package];
    if (installed && installed.path) bundledBytes += folderSize(installed.path);
  }
  return {
    profile: { id: gathered.profile.id, name: gathered.profile.name },
    counts: {
      dashboards: gathered.dashboards.length,
      bots: gathered.bots.length,
      folders: gathered.folders.length,
      themes: Object.keys(gathered.themes).length,
      providers: gathered.providers.length,
      widgets: gathered.widgets.length,
      bundledWidgets: bundled.length,
      secretsLeftOut: (gathered.secretsLeftOut || []).length,
    },
    widgets: gathered.widgets,
    bundledBytes,
  };
}

function computerName() {
  return String(os.hostname() || "").replace(/\.local$/i, "") || null;
}

/** Add a widget's installed folder to the zip, without build leftovers. */
function addWidgetFolder(zip, dir, zipDir) {
  const fs = require("fs");
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return false;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    const z = `${zipDir}/${e.name}`;
    if (e.isDirectory()) addWidgetFolder(zip, p, z);
    else if (e.isFile()) zip.addFile(z, fs.readFileSync(p));
  }
  return true;
}

/**
 * Write a profile to `filePath` (a save dialog picks it when omitted).
 * Records the save on the profile (revision, dashboard hashes) for sync.
 */
async function saveProfileToFile(
  win,
  appId,
  profileId,
  options = {},
  deps = {},
) {
  const d = { ...defaultDeps(), ...deps };
  const gathered = await gatherProfile(appId, profileId, options, d);
  const summary = summarize(gathered);
  if (summary.bundledBytes > MAX_BUNDLED_BYTES) {
    return {
      success: false,
      error: `The widgets this profile needs add up to more than ${Math.round(
        MAX_BUNDLED_BYTES / (1024 * 1024),
      )} MB, too much for one file.`,
    };
  }
  const revision =
    ((gathered.profile.link && gathered.profile.link.revision) || 0) + 1;
  const { files, manifest } = buildProfileFiles({
    ...gathered,
    revision,
    createdOn: computerName(),
  });

  let filePath = options.filePath || null;
  if (!filePath) {
    const { dialog, app } = require("electron");
    const safe =
      gathered.profile.name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Profile";
    const res = await dialog.showSaveDialog(win, {
      title: `Save ${gathered.profile.name} to a file`,
      defaultPath: path.join(
        app.getPath("desktop"),
        `${safe}.${PROFILE_FILE_EXTENSION}`,
      ),
      filters: [{ name: "Dash profile", extensions: [PROFILE_FILE_EXTENSION] }],
    });
    if (res.canceled || !res.filePath)
      return { success: false, canceled: true };
    filePath = res.filePath;
  }

  const AdmZip = require("adm-zip");
  const zip = new AdmZip();
  for (const [name, buf] of Object.entries(files)) zip.addFile(name, buf);
  const missing = [];
  for (const w of gathered.widgets) {
    if (w.source !== "bundled") continue;
    const installed = gathered.installedOf[w.package];
    const ok =
      SAFE_PACKAGE_ID.test(w.package) &&
      installed &&
      installed.path &&
      addWidgetFolder(zip, installed.path, `widgets/${w.package}`);
    if (!ok) missing.push(w.package);
  }
  zip.writeZip(filePath);

  // Only once there are profiles: writing profiles.json for Default alone
  // would start filtering with empty lists.
  if (gathered.explicit && typeof d.store.setLink === "function") {
    d.store.setLink(appId, profileId, {
      revision,
      savedAt: manifest.createdAt,
      dashboardHashes: manifest.dashboardHashes,
    });
  }

  return {
    success: true,
    filePath,
    revision,
    ...summary,
    // Widgets that should have been copied but whose folder was missing.
    missingWidgets: missing,
  };
}

module.exports = {
  MAX_BUNDLED_BYTES,
  SAFE_PACKAGE_ID,
  PROFILE_FILE_SCHEMA_VERSION,
  PROFILE_FILE_KIND,
  PROFILE_FILE_EXTENSION,
  dashboardHash,
  portableBot,
  portableSettings,
  classifyWidget,
  buildProfileFiles,
  gatherProfile,
  summarize,
  saveProfileToFile,
  lookupRegistryPackage,
};
