/**
 * profileLoadV3.js
 *
 * Loading a v3 profile (dash-profiles v3; profileSetup.js describes it):
 * the setup — dashboards, folders, themes, bots and teams — is restored as
 * the profile has it, with its ids (as v1 files were), and widgets install
 * from the registry at the versions it lists.
 *
 *   planLoadV3   what loading would do, for the preview: each widget
 *                installed, updated, already here or kept; each dashboard,
 *                folder, theme and bot new, already here, or changed (which
 *                copy is used, and why); what leaves the profile; providers
 *                to use, map or set up; keys to enter
 *   applyLoadV3  do it, with the user's choices
 *
 * Default is replaced only by its own account copy (otherwise a copy of
 * Default loads as its own profile). Loading a profile's own account copy
 * into the profile it's linked to keeps it in step: the account's copy wins
 * for everything changed — except keys, which never travel. New bots arrive
 * paused; approvals are never carried.
 */
const fs = require("fs");
const path = require("path");
const { readRegistryRef, samePackage } = require("../registry/packageRef");
const {
  setupHash,
  portableSetupBot,
  comparableDashboard,
  installedWidget,
} = require("./profileSetup");
const {
  secretFieldLookup,
  restoreSecrets,
  hasSecretValue,
  mapItems,
  itemsByKey,
} = require("./secretFields");

const DEFAULT_PROFILE_ID = "default";
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Setup kinds: the profile's list name and a row's kind.
const SETUP = [
  { list: "folders", kind: "folder" },
  { list: "themes", kind: "theme" },
  { list: "dashboards", kind: "dashboard" },
  { list: "bots", kind: "bot" },
];

const sameName = (a, b) =>
  String(a || "")
    .trim()
    .toLowerCase() ===
  String(b || "")
    .trim()
    .toLowerCase();
const own = (obj, key) =>
  !!obj && Object.prototype.hasOwnProperty.call(obj, key);
const isLead = (bot) => !!bot && bot.role === "lead";

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
      const target = appFile(appId, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(data, null, 2));
    },
    allBots: () => {
      const c = bots();
      return c ? c._store.list() : [];
    },
    saveBot: (definition, opts) => {
      const c = bots();
      if (!c) throw new Error("Bots aren't available right now.");
      return c.save(definition, opts);
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

function recordName(kind, id, rec) {
  if (kind === "theme") return (rec && rec.name) || id;
  if (kind === "bot") return (rec && rec.name) || "Untitled bot";
  if (kind === "folder") return (rec && rec.name) || "Untitled folder";
  return (rec && (rec.name || rec.label)) || "Untitled";
}

/** [{ id, rec }] of one kind, from a setup (or this computer's records). */
function listOf(list, records) {
  if (list === "themes") {
    return Object.keys(records.themes || {}).map((key) => ({
      id: key,
      rec: records.themes[key],
    }));
  }
  return (records[list] || []).map((rec) => ({ id: String(rec.id), rec }));
}

/** The registry package a dashboard or bot was installed or published as. */
function packageOf(kind, rec) {
  const ref = readRegistryRef(kind, rec);
  return ref && ref.package ? ref : null;
}

// ---- planning -------------------------------------------------------------

/**
 * What loading `manifest` (parsed by profileSetup.parseProfileV3) would do.
 * Asks the registry about each widget; changes nothing.
 *
 * `linkedProfileId`: the profile here linked to the account copy being
 * loaded — it's the one replaced, Default included. `sync`: loading that
 * copy into it keeps it in step (the account's copy wins when changed).
 */
async function planLoadV3(
  appId,
  manifest,
  deps = {},
  { linkedProfileId = null, sync = false } = {},
) {
  const d = { ...defaultDeps(), ...deps };
  const { itemRow } = require("./profileLoadV2");
  const { newerCopy } = require("./profileLoad");
  const profiles = d.store.list(appId);

  // The target: Default only for its own account copy.
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
  const keepingInStep =
    sync &&
    !!existing &&
    linkedProfileId != null &&
    existing.id === linkedProfileId;

  const registry = d.widgetRegistry();
  const rows = [];

  // Widgets.
  for (const [pkg, version] of Object.entries(manifest.widgets)) {
    const installed = installedWidget(registry, pkg);
    const row = itemRow(
      "widget",
      pkg,
      version,
      installed ? { id: pkg, version: installed.version } : null,
      await d.lookup(pkg),
    );
    const builtHere =
      installed &&
      (installed.installSource === "local" ||
        installed.installSource === "url" ||
        installed.copiedFromFolder);
    rows.push(
      builtHere && row.action !== "unavailable"
        ? {
            ...row,
            action: "keep",
            useFile: false,
            reason: "Built on this Mac — kept unless you pick the profile's",
          }
        : row,
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
  const { providerNamer } = require("./profileLoadV2");
  const defaultMap = Object.create(null);
  for (const p of providers)
    if (p.status === "map") defaultMap[p.name] = p.mapTo;
  const namer = providerNamer(manifest, defaultMap);

  // The setup, matched by id (dashboards and bots installed from the
  // registry also by their package, for copies made before v3).
  const here = {
    dashboards: d.workspaceFile(appId) || [],
    folders: d.folderFile(appId) || [],
    themes: d.themeFile(appId) || {},
    bots: (d.allBots() || []).filter((b) => b && b.system !== "dash-team"),
  };
  const secretFieldsFor = secretFieldLookup(registry);
  const dashMatch = Object.create(null); // incoming dashboard id → local id
  // Two copies compared as they'd be here: the profile's with its provider
  // names mapped to this computer's and its dashboards' ids; neither's id.
  const comparable = (list, rec, incoming) => {
    if (list === "dashboards") {
      return comparableDashboard(
        incoming ? mapDashboardProviders(rec, namer) : rec,
        secretFieldsFor,
      );
    }
    if (list === "bots") {
      const b = incoming
        ? mapBotProviders(portableSetupBot(rec), namer)
        : portableSetupBot(rec);
      const { id: _id, ...rest } = b;
      const ws = rest.workspaceId != null ? String(rest.workspaceId) : null;
      if (incoming && ws != null && own(dashMatch, ws)) {
        rest.workspaceId = dashMatch[ws];
      }
      if (rest.workspaceId != null) rest.workspaceId = String(rest.workspaceId);
      return rest;
    }
    return rec;
  };
  // The Dash team is this computer's: a profile's bot never lands on it.
  const dashTeam = new Set(
    (d.allBots() || [])
      .filter((b) => b && b.system === "dash-team")
      .map((b) => String(b.id)),
  );
  const folderElsewhere = (fid) =>
    d.store.hasProfiles(appId) &&
    profiles.some(
      (p) =>
        p.id !== (existing && existing.id) &&
        ((p.items && p.items.folders) || []).map(String).includes(String(fid)),
    );
  for (const { list, kind } of SETUP) {
    const local = listOf(list, here);
    const byId = new Set(local.map((x) => x.id));
    const taken = new Set();
    const incoming = listOf(list, manifest.setup);
    const ids = new Set(incoming.map((x) => x.id));
    for (const { id, rec } of incoming) {
      if (kind === "bot" && dashTeam.has(id)) {
        rows.push({
          kind,
          package: id,
          name: recordName(kind, id, rec),
          action: "install",
          newId: true,
        });
        continue;
      }
      let localId = byId.has(id) ? id : null;
      if (localId == null && (kind === "dashboard" || kind === "bot")) {
        const pkg = packageOf(kind, rec);
        const found = pkg
          ? local.find(
              (x) =>
                !ids.has(x.id) &&
                !taken.has(x.id) &&
                packageOf(kind, x.rec) &&
                samePackage(packageOf(kind, x.rec), pkg),
            )
          : null;
        if (found) localId = found.id;
      }
      // A dashboard's lead: this Mac's, when it has one for that dashboard.
      if (localId == null && kind === "bot" && isLead(rec)) {
        const wsId = own(dashMatch, String(rec.workspaceId))
          ? dashMatch[String(rec.workspaceId)]
          : String(rec.workspaceId);
        const lead = here.bots.find(
          (b) => isLead(b) && String(b.workspaceId) === wsId,
        );
        if (lead) {
          rows.push({
            kind,
            package: id,
            name: recordName(kind, id, rec),
            action: "here",
            localId: String(lead.id),
            lead: true,
          });
          continue;
        }
      }
      if (localId != null) taken.add(localId);
      if (kind === "dashboard") dashMatch[id] = localId != null ? localId : id;
      const base = { kind, package: id, name: recordName(kind, id, rec) };
      if (localId == null) {
        rows.push({ ...base, action: "install" });
        continue;
      }
      const mine = (local.find((x) => x.id === localId) || {}).rec;
      if (
        setupHash(list, comparable(list, mine, false)) ===
        setupHash(list, comparable(list, rec, true))
      ) {
        rows.push({ ...base, action: "here", localId });
        continue;
      }
      // Keeping in step never renames a folder another profile here uses
      // (folder 1 is on every computer).
      if (keepingInStep && kind === "folder" && folderElsewhere(localId)) {
        rows.push({
          ...base,
          action: "here",
          localId,
          reason: "Another profile here uses it — not renamed",
        });
        continue;
      }
      if (keepingInStep) {
        rows.push({
          ...base,
          action: "update",
          useFile: true,
          localId,
          reason: "Changed in your account's copy",
        });
        continue;
      }
      const newer = newerCopy(list, mine, rec);
      rows.push({
        ...base,
        action: newer.useFile ? "update" : "keep",
        useFile: newer.useFile,
        localId,
        reason: String(newer.reason).replace(/the file/g, "the profile"),
      });
    }
  }

  // Replacing: what the profile holds now that the one being loaded
  // doesn't — it leaves the profile (it stays on this computer); what no
  // other profile holds is hidden until it's ticked back.
  const leaving = [];
  if (existing) {
    const explicit = d.store.hasProfiles(appId);
    const matched = (kind) =>
      new Set(
        rows
          .filter((r) => r.kind === kind && r.localId != null)
          .map((r) => String(r.localId)),
      );
    const inOther = (list, id) =>
      explicit &&
      profiles.some(
        (p) =>
          p.id !== existing.id &&
          ((p.items && p.items[list]) || []).map(String).includes(String(id)),
      );
    const holds = (list, all) =>
      explicit
        ? new Set(((existing.items && existing.items[list]) || []).map(String))
        : new Set(all.map((x) => String(x.id)));
    const heldDash = holds("dashboards", here.dashboards);
    const keptDash = matched("dashboard");
    for (const w of here.dashboards) {
      if (w && heldDash.has(String(w.id)) && !keptDash.has(String(w.id))) {
        leaving.push({
          kind: "dashboard",
          name: w.name || w.label || "Untitled",
          hidden: !inOther("dashboards", w.id),
        });
      }
    }
    const heldBots = holds("bots", here.bots);
    const keptBots = matched("bot");
    for (const b of here.bots) {
      // A dashboard's own bots go with it.
      if (b.workspaceId != null || isLead(b)) continue;
      if (heldBots.has(String(b.id)) && !keptBots.has(String(b.id))) {
        leaving.push({
          kind: "bot",
          name: b.name || "Untitled bot",
          hidden: !inOther("bots", b.id),
        });
      }
    }
  }

  // Keys the profile left out, unless this Mac already has them.
  const localDash = new Map(here.dashboards.map((w) => [String(w.id), w]));
  const secretsToEnter = manifest.secretsToEnter
    .filter((e) => e.dashboardId != null && own(dashMatch, e.dashboardId))
    .filter((e) => {
      const w = localDash.get(String(dashMatch[e.dashboardId]));
      return !w || !hasSecretValue(w, e.item, e.field);
    })
    .map((e) => ({
      dashboard: e.dashboard || "Untitled",
      title: e.title || null,
      component: e.component || null,
      field: e.field,
    }))
    // The top-level layout mirrors a page: the same setting once.
    .filter(
      (e, i, all) =>
        all.findIndex(
          (o) =>
            o.dashboard === e.dashboard &&
            (o.title || o.component) === (e.title || e.component) &&
            o.field === e.field,
        ) === i,
    );

  return {
    success: true,
    schemaVersion: 3,
    leaving,
    file: {
      name: manifest.name,
      owner: manifest.owner || null,
      createdOn: manifest.createdOn || null,
      createdAt: manifest.createdAt || null,
    },
    fromDefault,
    target,
    keepingInStep,
    rows,
    unreachable: rows.some((r) => r.unreachable),
    providers,
    secretsToEnter,
    leftOut: manifest.leftOut,
    settings: (manifest.settings && manifest.settings.app) || null,
  };
}

// ---- applying -------------------------------------------------------------

/** A dashboard with its provider names as this computer has them. */
function mapDashboardProviders(ws, nameProvider) {
  const mapSel = (sel) => {
    if (!sel || typeof sel !== "object") return sel;
    const out = {};
    for (const [k, v] of Object.entries(sel)) {
      if (UNSAFE_KEYS.has(k)) continue;
      const to = nameProvider(v);
      if (to) out[k] = to;
    }
    return out;
  };
  const next = mapItems(ws, (item) =>
    item.selectedProviders
      ? { ...item, selectedProviders: mapSel(item.selectedProviders) }
      : { ...item },
  );
  if (ws.selectedProviders)
    next.selectedProviders = mapSel(ws.selectedProviders);
  return next;
}

/** A bot with its providers as this computer has them (others dropped). */
function mapBotProviders(bot, nameProvider) {
  const servers = (Array.isArray(bot.mcpServers) ? bot.mcpServers : [])
    .map((s) => (typeof s === "string" ? nameProvider(s) : null))
    .filter(Boolean);
  const toolSelections = {};
  for (const [k, v] of Object.entries(bot.toolSelections || {})) {
    const to = nameProvider(k);
    if (to && Array.isArray(v)) {
      toolSelections[to] = v.filter((t) => typeof t === "string");
    }
  }
  return { ...bot, mcpServers: [...new Set(servers)], toolSelections };
}

/**
 * Load: install the widgets, write the setup as planned (with the user's
 * choices), the profile's lists, then the bots (paused when new).
 *
 * @param {{asNew?: boolean, name?: string, keep?: string[],
 *   take?: string[], providerMap?: object, applySettings?: boolean,
 *   defaultItems?: object, linkedProfileId?: string, syncLinked?: boolean}}
 *   choices — `keep`: "<kind>:<id>" updates to skip (keep this Mac's);
 *   `take`: kept rows to replace with the profile's; `providerMap`: the
 *   profile's provider name → this computer's (null: none).
 *   `linkedProfileId` and `syncLinked` come from the main process only.
 */
async function applyLoadV3(win, appId, manifest, choices = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const plan = await planLoadV3(appId, manifest, d, {
    linkedProfileId: choices.linkedProfileId,
    // Planned as the preview was (loading as new too), so the rows the
    // user ticked are the rows loaded.
    sync: choices.syncLinked === true,
  });
  if (plan.unreachable) {
    return {
      success: false,
      error: "Couldn't reach the registry — try again.",
    };
  }
  const store = d.store;
  const problems = [];

  // Target (checked before anything is written).
  const replacing = plan.target.mode === "replace" && !choices.asNew;
  const sync = plan.keepingInStep && replacing;
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
  if (
    store
      .list(appId)
      .some(
        (p) =>
          sameName(p.name, name) &&
          !(replacing && p.id === plan.target.profileId),
      )
  ) {
    return {
      success: false,
      error: `A profile named "${name}" already exists.`,
    };
  }

  const keep = new Set(choices.keep || []);
  const take = new Set(choices.take || []);
  const { providerNamer } = require("./profileLoadV2");
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
  const rid = (row) => `${row.kind}:${row.package}`;
  const loads = (row) =>
    row.action === "install" ||
    (row.action === "update" && !keep.has(rid(row))) ||
    (row.action === "keep" && take.has(rid(row)));
  const counts = { added: 0, updated: 0 };
  const count = (row) =>
    row.action === "install" ? (counts.added += 1) : (counts.updated += 1);
  const of = (kind) => plan.rows.filter((r) => r.kind === kind);
  // Where each of the profile's records lands here.
  const localId = (row) => (row.localId != null ? row.localId : row.package);
  const record = (list, id) =>
    list === "themes"
      ? manifest.setup.themes[id]
      : manifest.setup[list].find((r) => String(r.id) === id);

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
  {
    const themes = { ...(d.themeFile(appId) || {}) };
    let touched = false;
    for (const row of of("theme")) {
      if (!loads(row)) continue;
      themes[localId(row)] = record("themes", row.package);
      count(row);
      touched = true;
    }
    if (touched) d.writeAppFile(appId, "themes.json", themes);
  }

  // 3. Folders (one another profile uses isn't renamed — the plan said).
  {
    const folders = [...(d.folderFile(appId) || [])];
    let touched = false;
    for (const row of of("folder")) {
      if (!loads(row)) continue;
      const rec = record("folders", row.package);
      const i = folders.findIndex((f) => f && String(f.id) === localId(row));
      if (i >= 0) folders[i] = { ...folders[i], ...rec, id: folders[i].id };
      else folders.push(rec);
      count(row);
      touched = true;
    }
    if (touched) d.writeAppFile(appId, "menuItems.json", folders);
  }

  // 4. Dashboards — over this Mac's copy, this Mac's keys are kept, and
  //    so is what its widgets point at here (a results widget's bot).
  const dashId = Object.create(null);
  for (const row of of("dashboard")) dashId[row.package] = String(localId(row));
  const botId = Object.create(null); // the profile's bot id → this Mac's
  for (const row of of("bot")) {
    if (!row.newId) botId[row.package] = String(localId(row));
  }
  const pointHere = (incoming, local) => {
    const mineByKey = local ? itemsByKey(local) : new Map();
    return mapItems(incoming, (item, key) => {
      if (!item.userPrefs || typeof item.userPrefs !== "object") {
        return { ...item };
      }
      const prefs = { ...item.userPrefs };
      const here = mineByKey.get(key);
      if (here && here.userPrefs && here.userPrefs.botId != null) {
        prefs.botId = here.userPrefs.botId;
      } else if (prefs.botId != null && own(botId, String(prefs.botId))) {
        prefs.botId = botId[String(prefs.botId)];
      } else {
        delete prefs.botId;
      }
      return { ...item, userPrefs: prefs };
    });
  };
  {
    const secretLookup = secretFieldLookup(registry);
    const list = [...(d.workspaceFile(appId) || [])];
    let touched = false;
    for (const row of of("dashboard")) {
      if (!loads(row)) continue;
      const incoming = mapDashboardProviders(
        record("dashboards", row.package),
        nameProvider,
      );
      const id = localId(row);
      const i = list.findIndex((w) => w && String(w.id) === String(id));
      if (i >= 0) {
        list[i] = {
          ...pointHere(
            restoreSecrets(incoming, list[i], secretLookup),
            list[i],
          ),
          id: list[i].id,
        };
      } else {
        list.push(pointHere(incoming, null));
      }
      count(row);
      touched = true;
    }
    if (touched) d.writeAppFile(appId, "workspaces.json", list);
  }

  // 5. The profile: what it holds here — every dashboard, folder, theme
  //    and bot of the profile (kept ones too), and every bot this Mac has
  //    on its dashboards (leads, teams) — they go with their dashboard.
  const botRows = of("bot");
  const fileBots = new Map(manifest.setup.bots.map((b) => [String(b.id), b]));
  const before = new Map((d.allBots() || []).map((b) => [String(b.id), b]));
  const dashboards = [
    ...new Set(of("dashboard").map((r) => String(localId(r)))),
  ];
  const onDashboards = [...before.values()]
    .filter(
      (b) =>
        b &&
        b.system !== "dash-team" &&
        b.workspaceId != null &&
        dashboards.includes(String(b.workspaceId)),
    )
    .map((b) => String(b.id));
  const items = {
    dashboards,
    folders: [...new Set(of("folder").map((r) => String(localId(r))))],
    themes: [...new Set(of("theme").map((r) => String(localId(r))))],
    bots: [
      ...new Set([
        ...botRows.filter((r) => !r.newId).map((r) => String(localId(r))),
        ...onDashboards,
      ]),
    ],
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
    {
      defaultItems: choices.defaultItems,
      replaceDefault: replacing && plan.target.profileId === DEFAULT_PROFILE_ID,
    },
  );

  // 6. Bots: new ones arrive paused and join this profile; changed ones
  //    the user took from the profile update (keeping this Mac's
  //    approvals and conversation). Providers this Mac doesn't have yet
  //    are left off (a bot can't be saved with them) and said; a bot is
  //    never left without the providers it had here.
  const haveProvider = new Set(
    (d.providers(appId) || []).filter(Boolean).map((p) => p.name),
  );
  const remap = (ws) =>
    ws != null && own(dashId, String(ws)) ? dashId[String(ws)] : ws;
  const botsPaused = [];
  const botsWaiting = [];
  for (const row of botRows) {
    if (row.lead || !loads(row)) continue;
    const src = fileBots.get(row.package);
    let def = mapBotProviders(portableSetupBot(src), nameProvider);
    const waiting = def.mcpServers.filter((n) => !haveProvider.has(n));
    def = {
      ...def,
      mcpServers: def.mcpServers.filter((n) => haveProvider.has(n)),
      toolSelections: Object.fromEntries(
        Object.entries(def.toolSelections).filter(([n]) => haveProvider.has(n)),
      ),
      workspaceId: remap(src.workspaceId),
      subscriptions: (Array.isArray(def.subscriptions)
        ? def.subscriptions
        : []
      ).map((sub) =>
        sub && sub.source && sub.source.workspaceId != null
          ? {
              ...sub,
              source: {
                ...sub.source,
                workspaceId: remap(sub.source.workspaceId),
              },
            }
          : sub,
      ),
    };
    if (row.newId) delete def.id;
    else def.id = localId(row);
    const mine = row.localId != null ? before.get(String(row.localId)) : null;
    if (
      mine &&
      Array.isArray(mine.mcpServers) &&
      mine.mcpServers.length &&
      !def.mcpServers.length
    ) {
      def.mcpServers = mine.mcpServers;
      def.toolSelections = mine.toolSelections || {};
    }
    try {
      if (!mine) {
        const saved = d.saveBot(def, {
          addToProfile: profile.id,
          keepId: !row.newId,
        });
        if (saved && def.id != null && String(saved.id) !== String(def.id)) {
          store.removeFromProfile(appId, "bots", String(def.id), profile.id);
        }
        botsPaused.push(def.name || "Bot");
      } else {
        d.saveBot(def);
      }
      if (waiting.length) {
        botsWaiting.push({ bot: def.name || "Bot", providers: waiting });
      }
      count(row);
    } catch (e) {
      // Not saved: the profile doesn't hold an id that isn't here.
      if (!mine && def.id != null) {
        store.removeFromProfile(appId, "bots", String(def.id), profile.id);
      }
      problems.push(
        `${row.name} wasn't loaded: ${String(e.message || e).split("\n")[0]}`,
      );
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
  if (store.getActiveProfileId(appId) === profile.id) d.applyActiveProfile();

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
    // Bots that use a provider this Mac doesn't have yet: added to the bot
    // once it's set up here.
    botsWaiting,
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
  planLoadV3,
  applyLoadV3,
  mapDashboardProviders,
  mapBotProviders,
};
