/**
 * profileLoad.js
 *
 * Load a profile from a .dashprofile file (dash-profiles PRD, PR 5).
 *
 *   readProfileZip  open the zip, refusing anything a profile file
 *                   doesn't contain (paths outside it, symlinks, too big)
 *   planLoad        what loading would do, for the preview: create or
 *                   replace, what's new / changed / already here, and for
 *                   each changed item which copy is newer
 *   applyLoad       do it, with the user's choices
 *
 * Records keep their ids: the profile is a list of ids over the shared
 * dashboards, folders, themes and bots, and so is the one in the file.
 * Default is never replaced — a file of "Default" loads as
 * "Default (from <computer>)".
 *
 * Which copy wins when both exist and differ: the newer published version
 * when both copies have one, else the more recently edited one, else this
 * computer's. Widgets the same way, except a widget built on this computer
 * (not from the registry) is kept unless the user picks the file's.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isNewerVersion } = require("../utils/isNewerVersion");
const {
  PROFILE_FILE_KIND,
  PROFILE_FILE_SCHEMA_VERSION,
  SAFE_PACKAGE_ID,
  MAX_BUNDLED_BYTES,
  dashboardHash,
  portableBot,
} = require("./profileFile");

// A profile file bigger than this (or unpacking to more) isn't opened.
const MAX_FILE_BYTES = MAX_BUNDLED_BYTES + 50 * 1024 * 1024;
const MAX_ENTRIES = 20000;

const JSON_FILES = {
  "manifest.json": "object",
  "profile.json": "object",
  "dashboards.json": "array",
  "folders.json": "array",
  "themes.json": "object",
  "bots.json": "array",
  "providers.json": "array",
  "settings.json": "object",
  "widgets.json": "array",
};

const KINDS = ["dashboards", "bots", "folders", "themes"];

const {
  blankDashboardSecrets,
  secretFieldLookup,
  restoreSecrets,
  hasSecretValue,
} = require("./secretFields");

// Theme keys that would reach an object's prototype.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const DEFAULT_PROFILE_ID = "default";

function sameName(a, b) {
  return (
    String(a || "")
      .trim()
      .toLowerCase() ===
    String(b || "")
      .trim()
      .toLowerCase()
  );
}

// ---- reading --------------------------------------------------------------

/** The package a `widgets/…` entry belongs to, and its path inside it. */
function widgetEntry(name) {
  const parts = name.split("/");
  if (parts[0] !== "widgets") return null;
  const scoped = parts[1] && parts[1].startsWith("@");
  const pkg = scoped ? `${parts[1]}/${parts[2] || ""}` : parts[1];
  const rest = parts.slice(scoped ? 3 : 2);
  if (!pkg || !SAFE_PACKAGE_ID.test(pkg) || !rest.length) return null;
  return { pkg, rel: rest.join("/") };
}

function unsafePath(name) {
  return (
    !name ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[a-z]:/i.test(name) ||
    name.split("/").some((seg) => seg === ".." || seg === ".")
  );
}

/**
 * Open a .dashprofile. Returns `{ error }` for anything that isn't a
 * profile file this version of Dash can load.
 */
function readProfileZip(buffer) {
  const bad = (error) => ({ error });
  if (!buffer || !buffer.length) return bad("The file is empty.");
  if (buffer.length > MAX_FILE_BYTES) return bad("The file is too big.");
  let entries;
  try {
    const AdmZip = require("adm-zip");
    entries = new AdmZip(buffer).getEntries();
  } catch (_e) {
    return bad("This isn't a Dash profile file.");
  }
  if (entries.length > MAX_ENTRIES) return bad("The file has too many parts.");

  const json = {};
  // No prototype: a package named "constructor" is just a key.
  const bundled = Object.create(null);
  let total = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    if (entry.isDirectory) continue;
    if (unsafePath(name)) {
      return bad(`The file contains a path Dash won't open: ${name}`);
    }
    // Symlinks (unix mode in the upper bits of the external attributes).
    if (((entry.attr >>> 16) & 0o170000) === 0o120000) {
      return bad(`The file contains a link Dash won't open: ${name}`);
    }
    total += (entry.header && entry.header.size) || 0;
    if (total > MAX_FILE_BYTES) return bad("The file unpacks to too much.");
    if (Object.prototype.hasOwnProperty.call(JSON_FILES, name)) {
      let value;
      try {
        value = JSON.parse(entry.getData().toString("utf8"));
      } catch (_e) {
        return bad(`${name} in the file is damaged.`);
      }
      const want = JSON_FILES[name];
      const ok =
        want === "array"
          ? Array.isArray(value)
          : value && typeof value === "object" && !Array.isArray(value);
      if (!ok) return bad(`${name} in the file is damaged.`);
      json[name] = value;
      continue;
    }
    const w = widgetEntry(name);
    if (!w) return bad(`The file contains something unexpected: ${name}`);
    (bundled[w.pkg] = bundled[w.pkg] || []).push({ rel: w.rel, entry });
  }

  const manifest = json["manifest.json"];
  if (!manifest || manifest.kind !== PROFILE_FILE_KIND) {
    return bad("This isn't a Dash profile file.");
  }
  if (
    typeof manifest.schemaVersion !== "number" ||
    manifest.schemaVersion > PROFILE_FILE_SCHEMA_VERSION
  ) {
    return bad("This profile was saved by a newer Dash. Update Dash first.");
  }
  const profile = json["profile.json"];
  if (!profile || !profile.items || typeof profile.items !== "object") {
    return bad("profile.json in the file is damaged.");
  }
  const ids = (list) =>
    (Array.isArray(list) ? list : []).filter((x) => x != null).map(String);
  return {
    manifest,
    profile: {
      id: typeof profile.id === "string" ? profile.id : null,
      name: String(profile.name || manifest.name || "Loaded profile").slice(
        0,
        60,
      ),
      items: {
        dashboards: ids(profile.items.dashboards),
        folders: ids(profile.items.folders),
        themes: ids(profile.items.themes),
        bots: ids(profile.items.bots),
      },
    },
    records: {
      dashboards: (json["dashboards.json"] || []).filter(
        (d) => d && d.id != null,
      ),
      folders: (json["folders.json"] || []).filter((f) => f && f.id != null),
      themes: Object.fromEntries(
        Object.entries(json["themes.json"] || {}).filter(
          ([key, value]) =>
            !UNSAFE_KEYS.has(key) && value && typeof value === "object",
        ),
      ),
      bots: (json["bots.json"] || []).filter(
        (b) => b && b.id != null && b.system !== "dash-team",
      ),
    },
    providers: (json["providers.json"] || []).filter((p) => p && p.name),
    settings: json["settings.json"] || null,
    widgets: (json["widgets.json"] || []).filter(
      (w) => w && w.package && SAFE_PACKAGE_ID.test(w.package),
    ),
    bundled,
  };
}

// ---- which copy is newer --------------------------------------------------

function lastSegment(pkg) {
  return String(pkg || "")
    .replace(/^@/, "")
    .split("/")
    .pop()
    .toLowerCase();
}

/** The registry package and version a record was published or installed as. */
function versionOf(kind, rec) {
  if (!rec) return null;
  if (kind === "dashboards") {
    const c = rec._dashboardConfig || {};
    const version = c.version || c.installedVersion;
    return c.registryPackage && version
      ? { pkg: lastSegment(c.registryPackage), version }
      : null;
  }
  if (kind === "bots") {
    const p = rec.published || rec.installedFrom;
    const pkg = p && (p.name || p.package);
    return pkg && p.version
      ? { pkg: lastSegment(pkg), version: p.version }
      : null;
  }
  if (kind === "themes") {
    const m = rec._registryMeta || {};
    const version = m.lastPublishedVersion || rec.version;
    return m.packageName && version
      ? { pkg: lastSegment(m.packageName), version }
      : null;
  }
  return null;
}

function editedAt(rec) {
  const t = Date.parse((rec && (rec.updatedAt || rec.dateUpdated)) || "");
  return Number.isFinite(t) ? t : null;
}

/**
 * Both copies exist and differ: which one loading uses unless the user
 * picks otherwise, and why.
 */
function newerCopy(kind, here, inFile) {
  const a = versionOf(kind, here);
  const b = versionOf(kind, inFile);
  if (a && b && a.pkg === b.pkg && a.version !== b.version) {
    const fileNewer = isNewerVersion(b.version, a.version);
    return {
      useFile: fileNewer,
      reason: fileNewer
        ? `The file has a newer version (${b.version}; ${a.version} here)`
        : `This Mac has a newer version (${a.version}; ${b.version} in the file)`,
    };
  }
  const ta = editedAt(here);
  const tb = editedAt(inFile);
  // Only one copy has an edit time (dashboards record it since PR 5): that
  // one was edited since, so it's the newer.
  if ((ta && !tb) || (tb && !ta) || (ta && tb && ta !== tb)) {
    const fileNewer = !ta || Boolean(tb && tb > ta);
    return {
      useFile: fileNewer,
      reason: fileNewer
        ? "Edited more recently in the file"
        : "Edited more recently on this Mac",
    };
  }
  return {
    useFile: false,
    reason:
      "Can't tell which is newer — this Mac's is kept unless you pick the file's",
  };
}

function recordHash(kind, rec) {
  if (kind !== "bots") return dashboardHash(rec);
  // Compared as the bot store keeps it (its defaults filled in); when it
  // was made isn't part of what it does.
  const { withDefaults } = require("../bots/botSchema");
  const {
    createdAt: _c,
    updatedAt: _u,
    ref: _r,
    ...bot
  } = portableBot(withDefaults(rec));
  return dashboardHash(bot);
}

const isLead = (bot) => !!bot && bot.role === "lead";

function recordName(kind, id, rec) {
  if (kind === "themes") return (rec && rec.name) || id;
  if (kind === "bots") return (rec && rec.name) || "Untitled bot";
  if (kind === "folders") return (rec && rec.name) || "Untitled folder";
  return (rec && (rec.name || rec.label)) || "Untitled";
}

// ---- widgets --------------------------------------------------------------

function builtHere(installed) {
  if (!installed || installed.installSource === "registry") return false;
  return (
    !!installed.copiedFromFolder ||
    installed.installSource === "local" ||
    installed.installSource === "url" ||
    String(installed.name || installed.packageId || "").startsWith("@ai-built/")
  );
}

/**
 * Code copied into the file is trusted by default only for the user's own
 * widgets: `@ai-built/*` or their own scope, and never over a widget that
 * came from the registry. Anything else could be anyone's code under a
 * trusted name — it's offered, unticked, and says so.
 */
function fileCodeTrusted(pkg, installed, username) {
  if (installed && installed.installSource === "registry") return false;
  const scope = String(pkg).replace(/^@/, "").split("/")[0].toLowerCase();
  const user = String(username || "")
    .replace(/^@/, "")
    .toLowerCase();
  return scope === "ai-built" || (!!user && scope === user);
}

const UNTRUSTED_CODE =
  "Code from the file, not the registry — tick only if you trust the file";

function widgetRow(w, installed, inFile, dashboardsUsing, username = null) {
  const row = widgetRowFor(w, installed, inFile, dashboardsUsing);
  if (
    row.how === "file" &&
    ["install", "update", "choose"].includes(row.action) &&
    !fileCodeTrusted(w.package, installed, username)
  ) {
    return { ...row, on: false, untrusted: true, reason: UNTRUSTED_CODE };
  }
  return row;
}

function widgetRowFor(w, installed, inFile, dashboardsUsing) {
  const how = w.source === "registry" ? "download" : "file";
  const base = {
    package: w.package,
    version: w.version || null,
    installedVersion: (installed && installed.version) || null,
    how,
    dashboardsUsing,
  };
  if (how === "file" && !inFile) {
    return installed
      ? {
          ...base,
          action: "keep",
          reason: "Not in the file — this Mac's is used",
        }
      : {
          ...base,
          action: "missing",
          reason: "Not in the file and not on this Mac",
        };
  }
  if (!installed) {
    return {
      ...base,
      action: "install",
      on: true,
      reason:
        how === "download"
          ? "Downloads from the registry"
          : "Installed from the file",
    };
  }
  if (w.version && installed.version === w.version) {
    return { ...base, action: "same", reason: "Already on this Mac" };
  }
  if (builtHere(installed)) {
    return {
      ...base,
      action: "choose",
      on: false,
      reason: `This Mac has its own build (${installed.version || "no version"}) — kept unless you pick the file's`,
    };
  }
  if (
    w.version &&
    installed.version &&
    isNewerVersion(w.version, installed.version)
  ) {
    return {
      ...base,
      action: "update",
      on: true,
      reason: `Updates ${installed.version} → ${w.version}`,
    };
  }
  return {
    ...base,
    action: "keep",
    reason: `This Mac has a newer version (${installed.version})`,
  };
}

function registryDownloadUrl(pkg, version) {
  const m = String(pkg).match(/^@?([^/]+)\/(.+)$/);
  if (!m) return null;
  const base =
    process.env.DASH_REGISTRY_API_URL ||
    "https://main.d919rwhuzp7rj.amplifyapp.com";
  return `${base}/api/packages/${encodeURIComponent(m[1])}/${encodeURIComponent(
    m[2],
  )}/download${version ? `?version=${encodeURIComponent(version)}` : ""}`;
}

// ---- planning -------------------------------------------------------------

function defaultDeps() {
  const file = () => require("../utils/file");
  const appFile = (appId, name) =>
    require("../utils/appPaths").getAppFilePath(appId, name);
  return {
    store: require("./profileStore"),
    workspaceFile: (appId) =>
      file().getFileContents(appFile(appId, "workspaces.json")) || [],
    folderFile: (appId) =>
      file().getFileContents(appFile(appId, "menuItems.json")) || [],
    themeFile: (appId) =>
      file().getFileContents(appFile(appId, "themes.json"), {}) || {},
    writeAppFile: (appId, name, data) => {
      const target = appFile(appId, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(data, null, 2));
    },
    allBots: () => {
      const bots = require("../controller/botController");
      return bots && bots._ready ? bots._store.list() : [];
    },
    saveBot: (definition, opts) =>
      require("../controller/botController").save(definition, opts),
    applyActiveProfile: () => {
      const bots = require("../controller/botController");
      if (bots && typeof bots.applyActiveProfile === "function") {
        bots.applyActiveProfile();
      }
    },
    widgetRegistry: () => require("../widgetRegistry").getWidgetRegistry(),
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
    saveSettings: (data) =>
      require("../controller/settingsController").saveSettingsForApplication(
        null,
        data,
      ),
    username: () => {
      try {
        return require("../controller/registryAuthController").getStoredUsername();
      } catch (_e) {
        return null;
      }
    },
    // Installed is installed: telling the windows can't undo it.
    announceInstalled: (name, config) => {
      try {
        require("../widgetRegistry").announceInstalled(name, config);
      } catch (_e) {
        // no windows yet
      }
    },
    tmpDir: () => fs.mkdtempSync(path.join(os.tmpdir(), "dash-profile-load-")),
    now: () => new Date(),
  };
}

function listOf(kind, records) {
  if (kind === "themes") {
    return Object.keys(records.themes || {}).map((key) => ({
      id: key,
      rec: records.themes[key],
    }));
  }
  return (records[kind] || []).map((rec) => ({ id: String(rec.id), rec }));
}

function localRecords(appId, d) {
  let bots = [];
  try {
    bots = (d.allBots() || []).filter((b) => b && b.system !== "dash-team");
  } catch (_e) {
    bots = [];
  }
  return {
    dashboards: d.workspaceFile(appId) || [],
    folders: d.folderFile(appId) || [],
    themes: d.themeFile(appId) || {},
    bots,
  };
}

/**
 * What loading `read` would do. Pure apart from reading this computer's
 * records through `deps`.
 */
function planLoad(appId, read, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const store = d.store;
  const profiles = store.list(appId);
  const explicit = store.hasProfiles(appId);

  // Which profile it loads into. Default is never the target.
  const fromDefault =
    read.profile.id === DEFAULT_PROFILE_ID ||
    sameName(read.profile.name, "Default");
  const name = fromDefault
    ? `Default (from ${read.manifest.createdOn || "another computer"})`.slice(
        0,
        60,
      )
    : read.profile.name;
  const others = profiles.filter((p) => p.id !== DEFAULT_PROFILE_ID);
  const existing =
    (!fromDefault && others.find((p) => p.id === read.profile.id)) ||
    others.find((p) => sameName(p.name, name)) ||
    null;
  const target = existing
    ? { mode: "replace", profileId: existing.id, name: existing.name }
    : { mode: "create", profileId: null, name };

  const here = localRecords(appId, d);
  const registry = d.widgetRegistry();
  // Files never carry secret values, so dashboards compare without them.
  const secretFieldsFor = secretFieldLookup(registry);
  const comparable = (kind, rec) =>
    kind === "dashboards"
      ? blankDashboardSecrets(rec, secretFieldsFor).workspace
      : rec;
  // A dashboard has one lead: this Mac's, when it has one.
  const fileDashboards = new Set(read.profile.items.dashboards);
  const localLeads = new Map(
    here.bots
      .filter((b) => isLead(b) && b.workspaceId != null)
      .map((b) => [String(b.workspaceId), b]),
  );
  const items = {};
  for (const kind of KINDS) {
    const local = new Map(listOf(kind, here).map((x) => [x.id, x.rec]));
    const rows = [];
    const inFile = new Set();
    for (const { id, rec } of listOf(kind, read.records)) {
      inFile.add(id);
      const mine = local.get(id);
      const leadHere =
        kind === "bots" && !mine && isLead(rec)
          ? localLeads.get(String(rec.workspaceId))
          : null;
      if (leadHere) {
        inFile.add(String(leadHere.id));
        rows.push({
          id,
          name: recordName(kind, id, rec),
          alsoIn: [],
          state: "same",
          // The profile holds this Mac's lead instead.
          sameAs: String(leadHere.id),
        });
        continue;
      }
      const alsoIn = !mine
        ? []
        : explicit
          ? store
              .profilesHolding(appId, kind, id, existing && existing.id)
              .map((p) => p.name)
          : ["Default"];
      const row = { id, name: recordName(kind, id, rec), alsoIn };
      if (!mine) rows.push({ ...row, state: "new" });
      else if (
        recordHash(kind, comparable(kind, mine)) ===
        recordHash(kind, comparable(kind, rec))
      ) {
        rows.push({ ...row, state: "same" });
      } else
        rows.push({ ...row, state: "changed", ...newerCopy(kind, mine, rec) });
    }
    // Replacing: what the profile holds now that the file doesn't.
    if (existing) {
      for (const id of existing.items[kind] || []) {
        if (inFile.has(id)) continue;
        // The lead of a dashboard the profile keeps stays with it.
        const bot = kind === "bots" ? local.get(id) : null;
        if (isLead(bot) && fileDashboards.has(String(bot.workspaceId))) {
          continue;
        }
        rows.push({
          id,
          name: recordName(kind, id, local.get(id)),
          state: "leaves",
          alsoIn: [],
        });
      }
    }
    items[kind] = rows;
  }

  // Secret settings the file left out, unless this Mac already has them.
  const localDashboards = new Map(
    (here.dashboards || []).map((w) => [String(w.id), w]),
  );
  const secretsToEnter = (
    Array.isArray(read.manifest.secretsToEnter)
      ? read.manifest.secretsToEnter
      : []
  )
    .filter(
      (e) =>
        e &&
        e.dashboardId != null &&
        typeof e.field === "string" &&
        fileDashboards.has(String(e.dashboardId)),
    )
    .filter((e) => {
      const mine = localDashboards.get(String(e.dashboardId));
      return !mine || !hasSecretValue(mine, e.item, e.field);
    })
    .map((e) => ({
      dashboard: String(e.dashboard || "Untitled"),
      widget: String(e.title || e.component || "Widget"),
      field: e.field,
    }))
    // The top-level layout mirrors a page: the same setting once.
    .filter(
      (e, i, all) =>
        all.findIndex(
          (o) =>
            o.dashboard === e.dashboard &&
            o.widget === e.widget &&
            o.field === e.field,
        ) === i,
    );

  const dashboardsText = (here.dashboards || []).map((w) => ({
    id: w.id,
    text: JSON.stringify(w),
  }));
  const widgets = read.widgets.map((w) => {
    const installed = registry ? registry.getWidget(w.package) : null;
    const using = dashboardsText.filter((x) =>
      x.text.includes(`"${w.package}"`),
    ).length;
    return widgetRow(
      w,
      installed,
      !!read.bundled[w.package],
      using,
      d.username(),
    );
  });

  const mine = new Set((d.providers(appId) || []).map((p) => p && p.name));
  const providers = read.providers.map((p) => ({
    name: p.name,
    type: p.type || null,
    ready: mine.has(p.name),
  }));

  const s = read.settings || {};
  const settings =
    s.theme || typeof s.checkForUpdatesOnLaunch === "boolean"
      ? {
          theme: s.theme || null,
          checkForUpdatesOnLaunch:
            typeof s.checkForUpdatesOnLaunch === "boolean"
              ? s.checkForUpdatesOnLaunch
              : null,
        }
      : null;

  return {
    file: {
      name: read.profile.name,
      createdOn: read.manifest.createdOn || null,
      createdAt: read.manifest.createdAt || null,
      revision: read.manifest.revision || null,
    },
    target,
    fromDefault,
    items,
    widgets,
    providers,
    settings,
    secretsToEnter,
  };
}

// ---- applying -------------------------------------------------------------

/** Unpack one widget's folder from the zip into a fresh temp folder. */
function unpackWidget(entries, dir) {
  for (const { rel, entry } of entries) {
    const dest = path.join(dir, rel);
    // readProfileZip refused unsafe paths; check again before writing.
    if (!dest.startsWith(dir + path.sep)) {
      throw new Error(`Unsafe path in the file: ${rel}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
  }
}

/**
 * Load the file. `choices`:
 *   asNew        load as a new profile even though one would be replaced
 *   name         the new profile's name (asNew, or the default name)
 *   useFile      { dashboards: [ids], bots, folders, themes } — changed
 *                items to take from the file (missing: the plan's defaults)
 *   widgets      packages to install/update (missing: the plan's defaults)
 *   applySettings  also use the file's app theme + update check
 *   defaultItems   what Default holds if profiles start now
 */
async function applyLoad(appId, read, choices = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const store = d.store;
  const plan = planLoad(appId, read, d);
  const problems = [];

  // Target.
  const replacing = plan.target.mode === "replace" && !choices.asNew;
  const name = replacing
    ? plan.target.name
    : String(choices.name || plan.target.name).trim();
  const taken = store
    .list(appId)
    .some(
      (p) =>
        sameName(p.name, name) &&
        !(replacing && p.id === plan.target.profileId),
    );
  if (!name) return { success: false, error: "The profile needs a name." };
  // Checked before anything is written.
  if (name.length > 60) {
    return {
      success: false,
      error: "Profile names are 60 characters or fewer.",
    };
  }
  if (taken) {
    return {
      success: false,
      error: `A profile named "${name}" already exists.`,
    };
  }
  const fileIdFree =
    read.profile.id &&
    read.profile.id !== DEFAULT_PROFILE_ID &&
    !store.list(appId).some((p) => p.id === read.profile.id);
  const targetId = replacing
    ? plan.target.profileId
    : fileIdFree
      ? read.profile.id
      : null;

  const useFile = {};
  for (const kind of KINDS) {
    const picked = choices.useFile && choices.useFile[kind];
    useFile[kind] = new Set(
      (Array.isArray(picked)
        ? picked
        : plan.items[kind]
            .filter((r) => r.state === "changed" && r.useFile)
            .map((r) => r.id)
      ).map(String),
    );
  }
  const takes = (kind, row) =>
    row.state === "new" ||
    (row.state === "changed" && useFile[kind].has(row.id));

  // 1. Widgets.
  const ticked = Array.isArray(choices.widgets)
    ? new Set(choices.widgets)
    : new Set(plan.widgets.filter((w) => w.on).map((w) => w.package));
  const installed = [];
  const registry = d.widgetRegistry();
  for (const w of plan.widgets) {
    if (w.action === "missing") {
      problems.push(`${w.package} isn't in the file or on this Mac.`);
      continue;
    }
    if (!["install", "update", "choose"].includes(w.action)) continue;
    if (!ticked.has(w.package)) continue;
    try {
      if (w.how === "download") {
        const url = registryDownloadUrl(w.package, w.version);
        if (!url) throw new Error("not a registry package");
        d.announceInstalled(
          w.package,
          await registry.downloadWidget(w.package, url),
        );
      } else {
        const dir = d.tmpDir();
        try {
          unpackWidget(read.bundled[w.package] || [], dir);
          d.announceInstalled(
            w.package,
            await registry.installFromLocalPath(w.package, dir),
          );
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      installed.push(`${w.package}${w.version ? ` ${w.version}` : ""}`);
    } catch (e) {
      problems.push(`${w.package} wasn't installed: ${e.message}`);
    }
  }

  // 2. Dashboards, folders, themes — written as they are, ids kept (a
  //    dashboard over this Mac's copy keeps the secrets this Mac has).
  const secretLookup = secretFieldLookup(registry);
  const defaultItems = store.hasProfiles(appId)
    ? undefined
    : choices.defaultItems;
  const counts = { added: 0, updated: 0 };
  const upsert = (list, row, rec) => {
    const i = list.findIndex((x) => String(x.id) === row.id);
    if (i >= 0) list[i] = rec;
    else list.push(rec);
    counts[row.state === "new" ? "added" : "updated"] += 1;
  };
  const byId = (kind) =>
    new Map(listOf(kind, read.records).map((x) => [x.id, x.rec]));
  for (const [kind, readFile, fileName] of [
    ["dashboards", d.workspaceFile, "workspaces.json"],
    ["folders", d.folderFile, "menuItems.json"],
  ]) {
    const recs = byId(kind);
    const list = [...(readFile(appId) || [])];
    let touched = false;
    for (const row of plan.items[kind]) {
      if (!takes(kind, row)) continue;
      const incoming = recs.get(row.id);
      const mine = list.find((x) => String(x.id) === row.id);
      upsert(
        list,
        row,
        kind === "dashboards" && mine
          ? restoreSecrets(incoming, mine, secretLookup)
          : incoming,
      );
      touched = true;
    }
    if (touched) d.writeAppFile(appId, fileName, list);
  }
  {
    const themes = { ...(d.themeFile(appId) || {}) };
    let touched = false;
    for (const row of plan.items.themes) {
      if (!takes("themes", row)) continue;
      themes[row.id] = read.records.themes[row.id];
      counts[row.state === "new" ? "added" : "updated"] += 1;
      touched = true;
    }
    if (touched) d.writeAppFile(appId, "themes.json", themes);
  }

  // 3. The profile: the file's lists — with this Mac's lead for a dashboard
  //    that already has one here.
  const swap = new Map(
    plan.items.bots.filter((r) => r.sameAs).map((r) => [r.id, r.sameAs]),
  );
  const fileDashboards = new Set(read.profile.items.dashboards);
  const leadsHere = localRecords(appId, d)
    .bots.filter((b) => isLead(b) && fileDashboards.has(String(b.workspaceId)))
    .map((b) => String(b.id));
  const profile = store.put(
    appId,
    {
      id: targetId,
      name,
      items: {
        ...read.profile.items,
        bots: [
          ...new Set([
            ...read.profile.items.bots.map((id) => swap.get(id) || id),
            ...leadsHere,
          ]),
        ],
      },
      link: {
        revision: read.manifest.revision || null,
        savedAt: read.manifest.createdAt || null,
        loadedAt: d.now().toISOString(),
        loadedFrom: read.manifest.createdOn || null,
        dashboardHashes: read.manifest.dashboardHashes || {},
      },
    },
    { defaultItems },
  );

  // 4. Bots: new ones arrive paused (every new bot does) and join this
  //    profile's list; changed ones the user took from the file update.
  const bots = byId("bots");
  for (const row of plan.items.bots) {
    if (!takes("bots", row)) continue;
    const def = portableBot(bots.get(row.id));
    try {
      if (row.state === "new") {
        const saved = d.saveBot(def, {
          addToProfile: profile.id,
          keepId: true,
        });
        if (saved && String(saved.id) !== row.id) {
          store.removeFromProfile(appId, "bots", row.id, profile.id);
        }
        counts.added += 1;
      } else {
        d.saveBot(def);
        counts.updated += 1;
      }
    } catch (e) {
      problems.push(String(e.message || e).split("\n")[0]);
    }
  }

  // 5. App settings, only when asked.
  if (choices.applySettings && plan.settings) {
    const next = { ...(d.settings() || {}) };
    if (plan.settings.theme) next.theme = plan.settings.theme;
    if (typeof plan.settings.checkForUpdatesOnLaunch === "boolean") {
      next.checkForUpdatesOnLaunch = plan.settings.checkForUpdatesOnLaunch;
    }
    d.saveSettings(next);
  }

  // 6. Loaded into the profile in use: its bots follow the new lists.
  if (store.getActiveProfileId(appId) === profile.id) d.applyActiveProfile();

  return {
    success: true,
    profile: { id: profile.id, name: profile.name },
    replaced: replacing,
    counts,
    widgetsInstalled: installed,
    secretsToEnter: plan.secretsToEnter,
    providersToSetUp: plan.providers.filter((p) => !p.ready).map((p) => p.name),
    problems,
  };
}

module.exports = {
  MAX_FILE_BYTES,
  readProfileZip,
  planLoad,
  applyLoad,
  newerCopy,
  versionOf,
  widgetRow,
  registryDownloadUrl,
};
