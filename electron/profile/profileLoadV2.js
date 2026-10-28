/**
 * profileLoadV2.js
 *
 * Loading a v2 profile (dash-profiles v2; the file profileManifest.js
 * describes): everything comes from the registry at the versions it lists,
 * matched to this computer by package — not by id — and what publishing
 * leaves out (widget settings, provider choices) is laid back on top.
 *
 *   parseProfileV2  check the file (JSON; packages and versions well formed;
 *                   every name a string) — it may have been made by anyone
 *   planLoadV2      what loading would do, for the preview: each item
 *                   installed, updated, already here, kept (this Mac's is
 *                   newer, or a build made here), or unavailable; providers
 *                   to use, map or set up; keys to enter
 *   applyLoadV2     do it: widgets, themes, folders, dashboards, then bots
 *                   (paused); the overlays; the profile's lists
 *
 * Default is never replaced (as v1). New bots arrive paused; their tools
 * need the user's approval on this computer (grants never travel).
 */
const {
  normalizePackageRef,
  readRegistryRef,
  samePackage,
} = require("../registry/packageRef");
const { isNewerVersion } = require("../utils/isNewerVersion");

const DEFAULT_PROFILE_ID = "default";
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+)?$/;
const MAX_ITEMS = 500;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// Settings that point at things on the computer that saved the profile
// (a results widget's bot): never carried over.
const LOCAL_PREFS = new Set(["botId"]);

const sameName = (a, b) =>
  String(a || "")
    .trim()
    .toLowerCase() ===
  String(b || "")
    .trim()
    .toLowerCase();

const own = (obj, key) =>
  !!obj && Object.prototype.hasOwnProperty.call(obj, key);

// A short string from the file, or null.
const str = (v, max = 200) =>
  typeof v === "string" && v.length <= max ? v : null;
// An id from the file (string or number), as a string, or null.
const idStr = (v) =>
  (typeof v === "string" && v.length && v.length <= 64) ||
  (typeof v === "number" && Number.isFinite(v))
    ? String(v)
    : null;

// ---- reading --------------------------------------------------------------

function cleanSecretEntry(s) {
  if (!s || typeof s !== "object") return null;
  const out = {};
  for (const k of ["dashboard", "title", "component", "field", "item"]) {
    if (str(s[k])) out[k] = s[k];
  }
  return out.field ? out : null;
}

/**
 * A v2 profile from a file's bytes, checked: kind, schema, every package
 * name and version well formed, and every name a string (anything else is
 * dropped). `{ manifest }` or `{ error }`.
 */
function parseProfileV2(buffer) {
  let m;
  try {
    m = JSON.parse(
      Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer),
    );
  } catch (_e) {
    return { error: "That isn't a Dash profile file." };
  }
  if (!m || typeof m !== "object" || m.kind !== "dash-profile") {
    return { error: "That isn't a Dash profile file." };
  }
  if (m.schemaVersion !== 2) {
    return {
      error: "This profile was saved by a newer Dash — update Dash to load it.",
    };
  }
  if (!str(m.name, 60) || !m.name.trim()) {
    return { error: "The profile in this file has no name." };
  }
  let total = 0;
  const section = (key, clean) => {
    const raw = m[key] || {};
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`The file's ${key} aren't readable.`);
    }
    const out = Object.create(null);
    for (const [pkg, entry] of Object.entries(raw)) {
      total += 1;
      if (UNSAFE_KEYS.has(pkg) || !normalizePackageRef(pkg)) {
        throw new Error(`"${pkg}" isn't a package name.`);
      }
      const version = key === "widgets" ? entry : entry && entry.version;
      if (typeof version !== "string" || !VERSION.test(version)) {
        throw new Error(`${pkg} has no exact version.`);
      }
      out[pkg] = clean(entry, version);
    }
    return out;
  };
  let dashboards;
  let bots;
  let themes;
  let widgets;
  try {
    dashboards = section("dashboards", (e, version) => ({
      version,
      name: str(e.name, 100),
      folder: idStr(e.folder),
      theme: e.theme && normalizePackageRef(e.theme) ? e.theme : null,
      withTeam: e.withTeam === true,
    }));
    bots = section("bots", (e, version) => ({
      version,
      kind: e.kind === "team" ? "team" : "bot",
      dashboard:
        e.dashboard && normalizePackageRef(e.dashboard) ? e.dashboard : null,
    }));
    themes = section("themes", (e, version) => ({
      version,
      key: str(e.key, 100),
    }));
    widgets = section("widgets", (e) => e);
  } catch (e) {
    return { error: e.message };
  }
  if (total > MAX_ITEMS) return { error: "The file lists too many items." };

  const folders = (Array.isArray(m.folders) ? m.folders : [])
    .map((f) =>
      f && idStr(f.id)
        ? {
            id: idStr(f.id),
            name: str(f.name, 100) || "Folder",
            ...(str(f.icon, 50) ? { icon: f.icon } : {}),
          }
        : null,
    )
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  const providers = (Array.isArray(m.providers) ? m.providers : [])
    .filter(
      (p) =>
        p && str(p.name, 100) && str(p.type, 100) && !UNSAFE_KEYS.has(p.name),
    )
    .map((p) => ({
      name: p.name,
      type: p.type,
      providerClass: str(p.providerClass, 50),
    }))
    .slice(0, MAX_ITEMS);
  const settings =
    m.settings && typeof m.settings === "object" ? m.settings : {};
  return {
    manifest: {
      kind: m.kind,
      schemaVersion: 2,
      profileId: idStr(m.profileId),
      name: m.name.trim(),
      owner: str(m.owner, 64),
      revision: Number.isFinite(m.revision) ? m.revision : null,
      createdAt: str(m.createdAt, 64),
      createdOn: str(m.createdOn, 100),
      dashboards,
      bots,
      themes,
      widgets,
      folders,
      providers,
      settings: {
        app:
          settings.app && typeof settings.app === "object"
            ? {
                ...(str(settings.app.theme, 100)
                  ? { theme: settings.app.theme }
                  : {}),
                ...(typeof settings.app.checkForUpdatesOnLaunch === "boolean"
                  ? {
                      checkForUpdatesOnLaunch:
                        settings.app.checkForUpdatesOnLaunch,
                    }
                  : {}),
              }
            : null,
        dashboards:
          settings.dashboards && typeof settings.dashboards === "object"
            ? settings.dashboards
            : {},
        bots:
          settings.bots && typeof settings.bots === "object"
            ? settings.bots
            : {},
      },
      secretsToEnter: (Array.isArray(m.secretsToEnter) ? m.secretsToEnter : [])
        .map(cleanSecretEntry)
        .filter(Boolean)
        .slice(0, MAX_ITEMS),
      leftOut: (Array.isArray(m.leftOut) ? m.leftOut : [])
        .map((l) =>
          l && str(l.name, 100)
            ? {
                kind: str(l.kind, 20),
                name: l.name,
                reason: str(l.reason, 300) || "",
              }
            : null,
        )
        .filter(Boolean)
        .slice(0, MAX_ITEMS),
    },
  };
}

/** Whether these bytes are a v2 profile (JSON) rather than a v1 zip. */
function isProfileV2(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer));
  for (const byte of b.subarray(0, 64)) {
    if (byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09)
      continue;
    return byte === 0x7b; // "{"
  }
  return false;
}

// ---- this computer ------------------------------------------------------

function defaultDeps() {
  const file = () => require("../utils/file");
  const appFile = (appId, name) =>
    require("../utils/appPaths").getAppFilePath(appId, name);
  const bots = () => {
    const c = require("../controller/botController");
    return c && c._ready ? c : null;
  };
  return {
    store: {
      list: (appId) => require("./profileStore").list(appId),
      put: (...a) => require("./profileStore").put(...a),
      getActiveProfileId: (appId) =>
        require("./profileStore").getActiveProfileId(appId),
      hasProfiles: (appId) => require("./profileStore").hasProfiles(appId),
      removeFromProfile: (...a) =>
        require("./profileStore").removeFromProfile(...a),
    },
    workspaceFile: (appId) =>
      file().getFileContents(appFile(appId, "workspaces.json")) || [],
    folderFile: (appId) =>
      file().getFileContents(appFile(appId, "menuItems.json")) || [],
    themeFile: (appId) =>
      file().getFileContents(appFile(appId, "themes.json"), {}) || {},
    writeAppFile: (appId, name, data) => {
      const fs = require("fs");
      const path = require("path");
      const target = appFile(appId, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(data, null, 2));
    },
    saveWorkspace: (appId, ws) =>
      require("../controller/workspaceController").saveWorkspaceForApplication(
        null,
        appId,
        ws,
      ),
    allBots: () => {
      const c = bots();
      return c ? c._store.list() : [];
    },
    teamSettings: (workspaceId) => {
      const c = bots();
      return c ? c._store.getTeamSettings(workspaceId) || {} : {};
    },
    updateBot: (id, patch) => {
      const c = bots();
      if (c) c._store.update(id, patch);
    },
    previewBot: (workspaceId, pkg, version) => {
      const c = bots();
      return c
        ? c.previewRegistryInstall(workspaceId, pkg, { version })
        : { error: "Bots aren't available right now." };
    },
    installBot: (workspaceId, previewId) => {
      const c = bots();
      return c
        ? c.installFromRegistry(workspaceId, previewId)
        : { error: "Bots aren't available right now." };
    },
    updateBotsFromRegistry: (previewId, byRole) => {
      const c = bots();
      return c
        ? c.updateFromRegistry(previewId, byRole)
        : { error: "Bots aren't available right now." };
    },
    applyActiveProfile: () => {
      const c = bots();
      if (c && typeof c.applyActiveProfile === "function")
        c.applyActiveProfile();
    },
    widgetRegistry: () => require("../widgetRegistry").getWidgetRegistry(),
    announceInstalled: (name, config) => {
      try {
        require("../widgetRegistry").announceInstalled(name, config);
      } catch (_e) {
        // no windows yet
      }
    },
    lookup: (pkg) =>
      require("../registry/registryPackages").getPackageInfo(pkg, {
        authFailuresUnreachable: true,
      }),
    downloadUrl: (pkg, version) =>
      require("../registry/registryPackages").packageDownloadUrl(pkg, version),
    installTheme: (win, appId, pkg, version) =>
      require("../controller/themeRegistryController").installThemeFromRegistry(
        win,
        appId,
        pkg,
        { version },
      ),
    installDashboard: (win, appId, pkg, options) =>
      require("../controller/dashboardConfigController").installDashboardFromRegistry(
        win,
        appId,
        pkg,
        require("../widgetRegistry").getWidgetRegistry(),
        options,
      ),
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
    now: () => new Date(),
  };
}

const refMatches = (kind, record, pkg) => {
  const ref = readRegistryRef(kind, record);
  const want = normalizePackageRef(pkg);
  return !!(
    ref &&
    ref.package &&
    want &&
    samePackage(ref, { package: want.id })
  );
};

// ---- planning -------------------------------------------------------------

function itemRow(kind, pkg, version, local, info, extra = {}) {
  const base = { kind, package: pkg, version, name: extra.name || pkg };
  if (info === "unreachable") {
    return {
      ...base,
      action: "unavailable",
      reason: "Couldn't reach the registry.",
      unreachable: true,
    };
  }
  if (!info) {
    return {
      ...base,
      action: "unavailable",
      reason: "Not in the registry any more, or not shared with you.",
    };
  }
  if (!local) return { ...base, action: "install" };
  const localVersion = local.version || null;
  const row = { ...base, localId: local.id, localVersion };
  if (!localVersion || localVersion === version) {
    return { ...row, action: "here" };
  }
  if (isNewerVersion(version, localVersion)) {
    return {
      ...row,
      action: "update",
      useFile: true,
      reason: `${localVersion} here; the profile has ${version}`,
    };
  }
  return {
    ...row,
    action: "keep",
    useFile: false,
    reason: `This Mac has a newer version (${localVersion}; ${version} in the profile)`,
  };
}

/**
 * What loading `manifest` would do. Asks the registry about each package;
 * changes nothing.
 *
 * `linkedProfileId`: the profile here linked to the account copy being
 * loaded (profileAccount.js) — it's the one replaced, Default included
 * (user decision, 2026-10-27: Default's own account copy replaces it in
 * place; any other copy of Default still loads as its own profile).
 */
async function planLoadV2(
  appId,
  manifest,
  deps = {},
  { linkedProfileId } = {},
) {
  const d = { ...defaultDeps(), ...deps };
  const profiles = d.store.list(appId);

  // The target: never Default (a file of Default loads as its own profile).
  const fromDefault =
    manifest.profileId === DEFAULT_PROFILE_ID ||
    sameName(manifest.name, "Default");
  const name = fromDefault
    ? `Default (from ${manifest.createdOn || "another computer"})`.slice(0, 60)
    : manifest.name;
  const others = profiles.filter((p) => p.id !== DEFAULT_PROFILE_ID);
  const linkedDefault =
    linkedProfileId === DEFAULT_PROFILE_ID &&
    profiles.find((p) => p.id === DEFAULT_PROFILE_ID);
  const existing =
    linkedDefault ||
    (linkedProfileId && others.find((p) => p.id === linkedProfileId)) ||
    (!fromDefault && others.find((p) => p.id === manifest.profileId)) ||
    others.find((p) => sameName(p.name, name)) ||
    null;
  const target = existing
    ? { mode: "replace", profileId: existing.id, name: existing.name }
    : { mode: "create", profileId: null, name };

  const workspaces = d.workspaceFile(appId);
  const themes = d.themeFile(appId);
  const bots = (d.allBots() || []).filter((b) => b && b.system !== "dash-team");
  const registry = d.widgetRegistry();
  const rows = [];

  // Widgets.
  for (const [pkg, version] of Object.entries(manifest.widgets)) {
    const installed =
      registry && registry.getWidget ? registry.getWidget(pkg) : null;
    const info = await d.lookup(pkg);
    const row = itemRow(
      "widget",
      pkg,
      version,
      installed ? { id: pkg, version: installed.version } : null,
      info,
    );
    const builtHere =
      installed &&
      (installed.installSource === "local" ||
        installed.installSource === "url" ||
        installed.copiedFromFolder);
    if (builtHere && row.action !== "unavailable") {
      rows.push({
        ...row,
        action: "keep",
        useFile: false,
        reason: "Built on this Mac — kept unless you pick the profile's",
      });
    } else {
      rows.push(row);
    }
  }

  // Themes.
  for (const [pkg, entry] of Object.entries(manifest.themes)) {
    const key = Object.keys(themes).find((k) =>
      refMatches("theme", themes[k], pkg),
    );
    const local = key
      ? { id: key, version: readRegistryRef("theme", themes[key]).version }
      : null;
    rows.push(
      itemRow("theme", pkg, entry.version, local, await d.lookup(pkg), {
        name: entry.key || pkg,
      }),
    );
  }

  // Dashboards.
  const dashboardRow = {};
  for (const [pkg, entry] of Object.entries(manifest.dashboards)) {
    const ws = workspaces.find((w) => refMatches("dashboard", w, pkg));
    const local = ws
      ? { id: ws.id, version: readRegistryRef("dashboard", ws).version }
      : null;
    const row = itemRow(
      "dashboard",
      pkg,
      entry.version,
      local,
      await d.lookup(pkg),
      { name: entry.name || pkg },
    );
    // A new dashboard that brings its own team (its bots arrive paused).
    if (entry.withTeam && row.action === "install") row.withTeam = true;
    dashboardRow[pkg] = row;
    rows.push(row);
  }

  // Bots: a team belongs to its dashboard.
  for (const [pkg, entry] of Object.entries(manifest.bots)) {
    const kind = entry.kind === "team" ? "team" : "bot";
    const dash = entry.dashboard ? dashboardRow[entry.dashboard] : null;
    if (entry.dashboard && (!dash || dash.action === "unavailable")) {
      rows.push({
        kind,
        package: pkg,
        version: entry.version,
        name: pkg,
        action: "unavailable",
        reason: "Its dashboard isn't available.",
      });
      continue;
    }
    let local = null;
    if (kind === "team" && dash && dash.localId != null) {
      const settings = d.teamSettings(dash.localId);
      if (refMatches("bot-team", settings, pkg)) {
        local = {
          id: dash.localId,
          version: readRegistryRef("bot-team", settings).version,
        };
      }
    } else if (kind === "bot") {
      const b = bots.find((x) => refMatches("bot", x, pkg));
      if (b) local = { id: b.id, version: readRegistryRef("bot", b).version };
    }
    rows.push(
      itemRow(kind, pkg, entry.version, local, await d.lookup(pkg), {
        name: pkg,
      }),
    );
  }

  // Providers: this Mac's of the same name; else one of the same type to
  // use instead; else set up here (keys never travel).
  const mine = (d.providers(appId) || []).filter(Boolean);
  const providers = manifest.providers.map((p) => {
    if (mine.some((m) => m.name === p.name)) {
      return { name: p.name, type: p.type, status: "ready" };
    }
    const options = mine.filter((m) => m.type === p.type).map((m) => m.name);
    return options.length
      ? {
          name: p.name,
          type: p.type,
          providerClass: p.providerClass || null,
          status: "map",
          options,
          mapTo: options[0],
        }
      : {
          name: p.name,
          type: p.type,
          providerClass: p.providerClass || null,
          status: "setup",
        };
  });

  // Replacing: what the profile holds now that the profile being loaded
  // doesn't — it leaves the profile (it stays on this computer).
  const leaving = [];
  if (existing) {
    const explicit = d.store.hasProfiles(appId);
    const holds = (kind, all) =>
      explicit
        ? new Set((existing.items && existing.items[kind]) || [])
        : new Set(all.map((x) => String(x.id)));
    const matched = (kind) =>
      new Set(
        rows
          .filter((r) => r.kind === kind && r.localId != null)
          .map((r) => String(r.localId)),
      );
    // Held by no other profile: it'll be in none, so hidden until it's
    // ticked back in Settings › Profiles.
    const inOther = (kind, id) =>
      explicit &&
      profiles.some(
        (p) =>
          p.id !== existing.id &&
          ((p.items && p.items[kind]) || []).map(String).includes(String(id)),
      );
    const heldDash = holds("dashboards", workspaces || []);
    const keptDash = matched("dashboard");
    for (const w of workspaces || []) {
      if (w && heldDash.has(String(w.id)) && !keptDash.has(String(w.id))) {
        leaving.push({
          kind: "dashboard",
          name: w.name || w.label || "Untitled",
          hidden: !inOther("dashboards", w.id),
        });
      }
    }
    const heldBots = holds("bots", bots);
    const keptBots = matched("bot");
    for (const b of bots) {
      // A dashboard's own bots go with it.
      if (b.workspaceId != null || b.role === "lead") continue;
      if (heldBots.has(String(b.id)) && !keptBots.has(String(b.id))) {
        leaving.push({
          kind: "bot",
          name: b.name || "Untitled bot",
          hidden: !inOther("bots", b.id),
        });
      }
    }
  }

  return {
    success: true,
    schemaVersion: 2,
    leaving,
    file: {
      name: manifest.name,
      owner: manifest.owner || null,
      createdOn: manifest.createdOn || null,
      createdAt: manifest.createdAt || null,
    },
    fromDefault,
    target,
    rows,
    unreachable: rows.some((r) => r.unreachable),
    providers,
    secretsToEnter: manifest.secretsToEnter,
    leftOut: manifest.leftOut,
    settings: (manifest.settings && manifest.settings.app) || null,
  };
}

// ---- applying -------------------------------------------------------------

/**
 * Provider names a profile's settings may name: the ones its file lists
 * (each shown in the preview), as this computer calls them. Anything else
 * is dropped — a file can't connect a widget or bot to a provider the
 * preview didn't mention.
 */
function providerNamer(manifest, providerMap) {
  const listed = new Set((manifest.providers || []).map((p) => p.name));
  return (name) => {
    if (typeof name !== "string" || !listed.has(name)) return null;
    return own(providerMap, name) ? providerMap[name] : name;
  };
}

/**
 * Lay a dashboard's overlay (from the profile) over it: each widget's
 * settings and providers, by section and widget id. `fillOnly`: only what
 * this computer doesn't have yet (an update in place keeps this Mac's).
 * A blanked secret ("") never overwrites a value; settings that point at
 * the saving computer (a results widget's bot) are never carried.
 * `nameProvider` maps (or drops) provider names.
 */
function applyDashboardOverlay(
  ws,
  overlay,
  nameProvider = (n) => n,
  { fillOnly = false } = {},
) {
  if (!ws || !overlay || !overlay.items || typeof overlay.items !== "object") {
    return ws;
  }
  const { mapItems } = require("./secretFields");
  const mapProviders = (sel) => {
    if (!sel || typeof sel !== "object") return null;
    const out = {};
    for (const [k, v] of Object.entries(sel)) {
      if (UNSAFE_KEYS.has(k)) continue;
      const to = nameProvider(v);
      if (to) out[k] = to;
    }
    return Object.keys(out).length ? out : null;
  };
  const next = mapItems(ws, (item, key) => {
    const out = { ...item };
    const o = own(overlay.items, key) ? overlay.items[key] : null;
    if (!o || typeof o !== "object") return out;
    if (o.userPrefs && typeof o.userPrefs === "object") {
      const prefs = { ...(item.userPrefs || {}) };
      for (const [field, value] of Object.entries(o.userPrefs)) {
        if (UNSAFE_KEYS.has(field) || LOCAL_PREFS.has(field)) continue;
        const here = prefs[field];
        const hasHere = here !== undefined && here !== null && here !== "";
        if (value === "" && hasHere) continue;
        if (fillOnly && hasHere) continue;
        prefs[field] = value;
      }
      out.userPrefs = prefs;
    }
    if (o.selectedProviders && (!fillOnly || !item.selectedProviders)) {
      const mapped = mapProviders(o.selectedProviders);
      if (mapped) out.selectedProviders = mapped;
    }
    return out;
  });
  if (overlay.selectedProviders && (!fillOnly || !ws.selectedProviders)) {
    const mapped = mapProviders(overlay.selectedProviders);
    if (mapped) next.selectedProviders = mapped;
  }
  return next;
}

/**
 * A new bot's overlay: the providers it uses (names the file lists, mapped
 * to this computer's) and the tools picked from each, and its AI. Never
 * approvals.
 */
function botPatch(overlay, nameProvider = (n) => n) {
  if (!overlay || typeof overlay !== "object") return null;
  const servers = (Array.isArray(overlay.mcpServers) ? overlay.mcpServers : [])
    .map(nameProvider)
    .filter(Boolean);
  const toolSelections = {};
  for (const [k, v] of Object.entries(overlay.toolSelections || {})) {
    const to = nameProvider(k);
    if (to && Array.isArray(v)) {
      toolSelections[to] = v.filter((t) => typeof t === "string");
    }
  }
  const patch = { mcpServers: [...new Set(servers)], toolSelections };
  if (str(overlay.provider, 100)) patch.provider = overlay.provider;
  if (str(overlay.model, 200)) patch.model = overlay.model;
  return patch;
}

/**
 * Load: install and update as planned (with the user's choices), lay the
 * overlays back on, and write the profile's lists.
 *
 * @param {{asNew?: boolean, name?: string, keep?: string[],
 *   take?: string[], providerMap?: object, applySettings?: boolean,
 *   defaultItems?: object}} choices
 *   `keep`: "<kind>:<package>" updates to skip (keep this Mac's);
 *   `take`: "<kind>:<package>" kept rows to replace with the profile's;
 *   `providerMap`: the file's provider name → this computer's (null: none)
 */
async function applyLoadV2(win, appId, manifest, choices = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const plan = await planLoadV2(appId, manifest, d, {
    linkedProfileId: choices.linkedProfileId,
  });
  if (plan.unreachable) {
    return {
      success: false,
      error: "Couldn't reach the registry — try again.",
    };
  }
  const problems = [];
  const store = d.store;

  // Target (checked before anything is installed).
  const replacing = plan.target.mode === "replace" && !choices.asNew;
  const name = replacing
    ? plan.target.name
    : String(choices.name || plan.target.name).trim();
  if (!name) return { success: false, error: "The profile needs a name." };
  if (name.length > 60) {
    return {
      success: false,
      error: "Profile names are 60 characters or fewer.",
    };
  }
  const taken = store
    .list(appId)
    .some(
      (p) =>
        sameName(p.name, name) &&
        !(replacing && p.id === plan.target.profileId),
    );
  if (taken) {
    return {
      success: false,
      error: `A profile named "${name}" already exists.`,
    };
  }

  const keep = new Set(choices.keep || []);
  const take = new Set(choices.take || []);
  // The plan's provider mapping, with the user's picks (only to providers
  // the plan offered).
  const providerMap = Object.create(null);
  for (const p of plan.providers) {
    if (p.status !== "map") continue;
    const picked = own(choices.providerMap, p.name)
      ? choices.providerMap[p.name]
      : undefined;
    const to = picked === null ? null : picked || p.mapTo;
    if (to && p.options.includes(to)) providerMap[p.name] = to;
  }
  const nameProvider = providerNamer(manifest, providerMap);
  const id = (row) => `${row.kind}:${row.package}`;
  const loads = (row) =>
    row.action === "install" ||
    (row.action === "update" && !keep.has(id(row))) ||
    (row.action === "keep" && take.has(id(row)));
  const counts = { added: 0, updated: 0 };
  const count = (row) =>
    row.action === "install" ? (counts.added += 1) : (counts.updated += 1);
  const of = (kind) => plan.rows.filter((r) => r.kind === kind);

  // What's here before: what the load adds is what's new after.
  const before = {
    dashboards: new Set(d.workspaceFile(appId).map((w) => String(w.id))),
    themes: new Set(Object.keys(d.themeFile(appId))),
    bots: new Set((d.allBots() || []).map((b) => String(b.id))),
  };

  // 1. Widgets, at the profile's versions.
  const registry = d.widgetRegistry();
  const widgetsInstalled = [];
  for (const row of of("widget")) {
    if (!loads(row)) continue;
    try {
      const url = d.downloadUrl(row.package, row.version);
      d.announceInstalled(
        row.package,
        await registry.downloadWidget(row.package, url),
      );
      widgetsInstalled.push(row.package);
      count(row);
    } catch (e) {
      problems.push(
        `${row.package} didn't install: ${String(e.message || e).split("\n")[0]}`,
      );
    }
  }

  // 2. Themes.
  const themeKey = Object.create(null);
  for (const row of of("theme")) {
    if (row.localId != null) themeKey[row.package] = row.localId;
    if (!loads(row)) continue;
    const res = await d.installTheme(win, appId, row.package, row.version);
    if (res && res.success) {
      themeKey[row.package] = res.themeKey;
      count(row);
    } else {
      problems.push(
        `${row.name} didn't install: ${(res && res.error) || "unknown error"}`,
      );
    }
  }

  // 3. Folders the dashboards go in — by this computer's own folder ids.
  const folders = d.folderFile(appId);
  const folderId = Object.create(null);
  for (const f of folders) {
    if (f && f.id != null) folderId[String(f.id)] = f.id;
  }
  let foldersChanged = false;
  for (const f of manifest.folders) {
    if (own(folderId, f.id)) continue;
    const newId = /^\d+$/.test(f.id) ? Number(f.id) : f.id;
    folders.push({
      id: newId,
      name: f.name,
      ...(f.icon ? { icon: f.icon } : {}),
    });
    folderId[f.id] = newId;
    foldersChanged = true;
  }
  if (foldersChanged) d.writeAppFile(appId, "menuItems.json", folders);

  // 4. Dashboards, then their overlays.
  const dashId = Object.create(null);
  for (const row of of("dashboard")) {
    const entry = manifest.dashboards[row.package] || {};
    if (row.localId != null) dashId[row.package] = row.localId;
    let fillOnly = true;
    if (loads(row)) {
      const res = await d.installDashboard(win, appId, row.package, {
        version: row.version,
        exactWidgetVersions: true,
        ...(row.localId != null
          ? { intoWorkspaceId: row.localId }
          : {
              withTeam: !!entry.withTeam,
              name: entry.name || undefined,
              menuId:
                entry.folder != null && own(folderId, entry.folder)
                  ? folderId[entry.folder]
                  : undefined,
              themeKey:
                entry.theme && themeKey[entry.theme]
                  ? themeKey[entry.theme]
                  : undefined,
            }),
      });
      if (!res || !res.success) {
        problems.push(
          `${row.name} didn't install: ${(res && res.error) || "unknown error"}`,
        );
        continue;
      }
      dashId[row.package] = res.workspace.id;
      fillOnly = row.localId != null;
      count(row);
    }
    if (dashId[row.package] == null) continue;
    const dashboards = manifest.settings.dashboards || {};
    const overlay = own(dashboards, row.package)
      ? dashboards[row.package]
      : null;
    if (!overlay) continue;
    const ws = d
      .workspaceFile(appId)
      .find((w) => String(w.id) === String(dashId[row.package]));
    if (ws) {
      d.saveWorkspace(
        appId,
        applyDashboardOverlay(ws, overlay, nameProvider, { fillOnly }),
      );
    }
  }

  // 5. Bots and teams (paused), then — for new ones — their overlays.
  const botsPaused = [];
  const botSettings = manifest.settings.bots || {};
  for (const row of [...of("bot"), ...of("team")]) {
    const entry = manifest.bots[row.package] || {};
    const overlay = own(botSettings, row.package)
      ? botSettings[row.package]
      : null;
    const wsId = entry.dashboard ? dashId[entry.dashboard] : null;
    if (!loads(row)) continue;
    const preview = await d.previewBot(
      wsId != null ? wsId : null,
      row.package,
      row.version,
    );
    if (!preview || preview.error) {
      problems.push(
        `${row.package} didn't install: ${(preview && preview.error) || "unknown error"}`,
      );
      continue;
    }
    if (row.action === "install") {
      const res = await d.installBot(
        wsId != null ? wsId : null,
        preview.previewId,
      );
      if (!res || res.error) {
        problems.push(
          `${row.package} didn't install: ${(res && res.error) || "unknown error"}`,
        );
        continue;
      }
      count(row);
      for (const c of res.installed || []) {
        botsPaused.push(c.name || row.package);
        // Provider choices from the profile (by bot name in a team).
        const o =
          row.kind === "team"
            ? overlay && overlay.members && own(overlay.members, c.name)
              ? overlay.members[c.name]
              : null
            : overlay;
        const patch = botPatch(o, nameProvider);
        if (patch) d.updateBot(c.id, patch);
      }
      continue;
    }
    // An update in place: this computer's copy keeps how it runs here.
    const byRole = {};
    if (row.kind === "bot") {
      const role =
        preview.plan && preview.plan.members && preview.plan.members[0]
          ? preview.plan.members[0].role
          : null;
      if (role && row.localId) byRole[role] = row.localId;
    } else {
      for (const b of d.allBots() || []) {
        if (String(b.workspaceId) !== String(wsId)) continue;
        if (!refMatches("bot-team", b, row.package)) continue;
        const role = b.installedFrom && b.installedFrom.role;
        if (role) byRole[role] = b.id;
      }
    }
    const res = await d.updateBotsFromRegistry(preview.previewId, byRole);
    if (!res || res.error) {
      problems.push(
        `${row.package} didn't update: ${(res && res.error) || "unknown error"}`,
      );
      continue;
    }
    count(row);
  }

  // 6. The profile: what it holds on this computer — its dashboards, every
  //    bot on them (teams, leads, a dashboard's own team), its other bots.
  const after = d.allBots() || [];
  const dashIds = new Set(Object.values(dashId).map(String));
  const botIds = new Set();
  for (const b of after) {
    if (!b || b.system === "dash-team") continue;
    if (b.workspaceId != null && dashIds.has(String(b.workspaceId))) {
      botIds.add(String(b.id));
    }
  }
  for (const row of of("bot")) {
    if (row.action === "unavailable") continue;
    const match = after.find((b) => refMatches("bot", b, row.package));
    if (match) botIds.add(String(match.id));
  }
  const items = {
    dashboards: [...dashIds],
    folders: [
      ...new Set(
        Object.values(manifest.dashboards)
          .map((e) => e.folder)
          .filter((f) => f != null && own(folderId, f))
          .map((f) => String(folderId[f])),
      ),
    ],
    themes: [...new Set(Object.values(themeKey).map(String))],
    bots: [...botIds],
  };
  const profile = store.put(
    appId,
    {
      id: replacing
        ? plan.target.profileId
        : manifest.profileId &&
            manifest.profileId !== DEFAULT_PROFILE_ID &&
            !store.list(appId).some((p) => p.id === manifest.profileId)
          ? manifest.profileId
          : null,
      name,
      items,
      link: {
        revision: manifest.revision || null,
        savedAt: manifest.createdAt || null,
        loadedAt: d.now().toISOString(),
        loadedFrom: manifest.createdOn || null,
      },
    },
    // What Default holds if this load starts profiles (taken by the caller
    // before anything was written). Default is replaced only by its own
    // account copy (the plan targets it only then).
    {
      defaultItems: choices.defaultItems,
      replaceDefault: replacing && plan.target.profileId === DEFAULT_PROFILE_ID,
    },
  );

  // Installing adds what's new to the profile in use too; when that's not
  // the profile loaded into, take it back out.
  const active = store.getActiveProfileId(appId);
  if (active && active !== profile.id && store.hasProfiles(appId)) {
    const added = {
      dashboards: d
        .workspaceFile(appId)
        .map((w) => String(w.id))
        .filter((x) => !before.dashboards.has(x)),
      themes: Object.keys(d.themeFile(appId)).filter(
        (k) => !before.themes.has(k),
      ),
      bots: after.map((b) => String(b.id)).filter((x) => !before.bots.has(x)),
    };
    for (const [kind, ids] of Object.entries(added)) {
      if (ids.length) store.removeFromProfile(appId, kind, ids, active);
    }
  }

  // 7. App settings, only when asked.
  if (choices.applySettings && plan.settings) {
    const next = { ...(d.settings() || {}) };
    if (plan.settings.theme) next.theme = plan.settings.theme;
    if (typeof plan.settings.checkForUpdatesOnLaunch === "boolean") {
      next.checkForUpdatesOnLaunch = plan.settings.checkForUpdatesOnLaunch;
    }
    d.saveSettings(next);
  }
  if (active === profile.id) d.applyActiveProfile();

  // Bots that came with a dashboard arrive paused too.
  for (const b of after) {
    if (
      !before.bots.has(String(b.id)) &&
      b.role !== "lead" &&
      !botsPaused.includes(b.name)
    ) {
      botsPaused.push(b.name || "Bot");
    }
  }
  for (const row of plan.rows) {
    if (row.action === "unavailable")
      problems.push(`${row.name}: ${row.reason}`);
  }
  return {
    success: true,
    profile: { id: profile.id, name: profile.name },
    replaced: replacing,
    counts,
    widgetsInstalled,
    botsPaused,
    secretsToEnter: plan.secretsToEnter,
    providersToSetUp: plan.providers
      .filter(
        (p) =>
          p.status === "setup" || (p.status === "map" && !providerMap[p.name]),
      )
      .map((p) => p.name),
    providersMapped: { ...providerMap },
    problems,
  };
}

module.exports = {
  parseProfileV2,
  isProfileV2,
  planLoadV2,
  applyLoadV2,
  applyDashboardOverlay,
  botPatch,
  providerNamer,
};
