/**
 * profileManifest.js
 *
 * The v2 profile (dash-profiles v2, user 2026-10-27): no records and no
 * code — what the profile holds, as registry packages at exact versions,
 * plus what publishing leaves out (each widget's settings and providers on
 * this computer, each bot's provider choices) and the list of keys the
 * other computer has to enter. The same JSON is what step 2 keeps in the
 * user's account.
 *
 *   { kind, schemaVersion: 2, profileId, name, owner, revision, createdAt,
 *     createdOn, appVersion,
 *     dashboards: { "@user/name": { version, id, name, folder, theme,
 *                                     withTeam? } },
 *     bots:       { "@user/name": { version, kind, dashboard } },
 *     themes:     { "@user/name": { version, key } },
 *     widgets:    { "@scope/name": "1.2.3" },
 *     folders:    [{ id, name, icon }],
 *     providers:  [ provider without credentials ],
 *     settings:   { app, dashboards: { pkg: overlay }, bots: { pkg: overlay } },
 *     secretsToEnter: [...], leftOut: [{ kind, name, reason }] }
 */
const { mapItems } = require("./secretFields");

const PROFILE_MANIFEST_SCHEMA_VERSION = 2;

/**
 * What a dashboard's published copy doesn't carry: each widget's settings
 * and providers on this computer (secret values already blanked), by
 * section and widget id, and the dashboard's own provider choices.
 */
function dashboardOverlay(workspace) {
  const items = {};
  if (workspace && typeof workspace === "object") {
    mapItems(workspace, (item, key) => {
      const entry = {};
      if (item.userPrefs && Object.keys(item.userPrefs).length) {
        entry.userPrefs = item.userPrefs;
      }
      if (
        item.selectedProviders &&
        Object.keys(item.selectedProviders).length
      ) {
        entry.selectedProviders = item.selectedProviders;
      }
      if (Object.keys(entry).length) items[key] = entry;
      return { ...item };
    });
  }
  const out = { items };
  if (
    workspace &&
    workspace.selectedProviders &&
    Object.keys(workspace.selectedProviders).length
  ) {
    out.selectedProviders = workspace.selectedProviders;
  }
  return out;
}

/**
 * How a bot runs on this computer, which publishing leaves out: the
 * providers it's connected to (by name — the other computer maps them) and
 * the tools picked from each, and the AI it runs on. Never approvals
 * (allowedTools / grants) — those are given on each computer.
 */
function botOverlay(bot) {
  const b = bot || {};
  return {
    mcpServers: Array.isArray(b.mcpServers) ? b.mcpServers : [],
    toolSelections:
      b.toolSelections && typeof b.toolSelections === "object"
        ? b.toolSelections
        : {},
    provider: b.provider || null,
    model: b.model || null,
  };
}

/** The v2 profile, from what a save resolved. */
function buildManifestV2({
  profile,
  owner,
  dashboards = [],
  bots = [],
  themes = [],
  widgets = {},
  folders = [],
  providers = [],
  appSettings = null,
  secretsToEnter = [],
  leftOut = [],
  revision = 1,
  createdOn = null,
  appVersion = null,
  now = new Date(),
}) {
  const byPackage = (list, entry) => {
    const out = {};
    for (const x of list) if (x && x.package) out[x.package] = entry(x);
    return out;
  };
  const settings = {
    dashboards: byPackage(dashboards, (d) => d.overlay || { items: {} }),
    bots: byPackage(bots, (b) => b.overlay || {}),
  };
  if (appSettings) settings.app = appSettings;
  return {
    kind: "dash-profile",
    schemaVersion: PROFILE_MANIFEST_SCHEMA_VERSION,
    profileId: profile.id,
    name: profile.name,
    owner: owner || null,
    revision,
    createdAt: now.toISOString(),
    createdOn,
    appVersion,
    dashboards: byPackage(dashboards, (d) => ({
      version: d.version,
      id: d.id != null ? String(d.id) : null,
      name: d.name || null,
      folder: d.folder != null ? String(d.folder) : null,
      theme: d.theme || null,
      // Its own team, unchanged, is installed with it.
      ...(d.withTeam ? { withTeam: true } : {}),
    })),
    bots: byPackage(bots, (b) => ({
      version: b.version,
      kind: b.kind === "team" ? "team" : "bot",
      dashboard: b.dashboard || null,
    })),
    themes: byPackage(themes, (t) => ({ version: t.version, key: t.key })),
    widgets: { ...widgets },
    folders: folders.map((f) => ({
      id: String(f.id),
      name: f.name || "",
      ...(f.icon ? { icon: f.icon } : {}),
    })),
    providers,
    settings,
    secretsToEnter,
    leftOut,
  };
}

module.exports = {
  PROFILE_MANIFEST_SCHEMA_VERSION,
  dashboardOverlay,
  botOverlay,
  buildManifestV2,
};
