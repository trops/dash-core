/**
 * exportController.js
 *
 * "Export Everything" bundle (Phase 4A of the MVP launch audit).
 *
 * Gathers every piece of user-owned config — workspaces, themes,
 * menu items / folders, and providers (METADATA ONLY, never the
 * decrypted credentials) — into a single ZIP that the user can save
 * as a backup or migration aid.
 *
 * Hard safety property: the ZIP MUST NOT contain provider credentials.
 * `providerController.listProviders` returns `provider.credentials` in
 * the decrypted plaintext form (see providerController.js:188-204), so
 * a naive `JSON.stringify(providers)` would leak every saved token in
 * the user's app to an arbitrary path on disk. This module uses an
 * EXPLICIT FIELD ALLOWLIST (not a blocklist) — only the fields named
 * in `SAFE_PROVIDER_FIELDS` ever leave the function. Re-import is out
 * of scope for MVP; the ZIP is read-only backup.
 *
 * The bundle layout (rooted at the user-picked ZIP path):
 *   /manifest.json     — schemaVersion + exportedAt + counts
 *   /workspaces.json   — array of workspaces (as stored on disk)
 *   /themes.json       — themes keyed by themeKey
 *   /menu-items.json   — folder/menu structure
 *   /providers.json    — providers with credentials stripped
 *
 * Schema versioning: `BUNDLE_SCHEMA_VERSION` stamps the manifest so a
 * future importer can refuse incompatible bundles loudly rather than
 * silently corrupting state.
 */

// `electron`, the four controllers, `path`, and `adm-zip` are
// lazy-required INSIDE `exportEverythingForApplication` so the pure
// helpers (`stripProviderCredentials`, `buildBundleFiles`) can be
// loaded under `node:test` without booting the Electron runtime or
// the controller chain (which itself requires `electron`).

const BUNDLE_SCHEMA_VERSION = "1.0.0";

// Allowlist of provider fields that are safe to include in the
// exported bundle. Any field name NOT in this set is dropped — this
// is the only line of defense against accidental credential leakage,
// and it's tested explicitly in exportController.test.js. Adding a
// new field here requires confirming it never carries a secret.
const SAFE_PROVIDER_FIELDS = [
  "name",
  "type",
  "providerClass",
  "dateCreated",
  "dateUpdated",
  "isDefaultForType",
  "mcpConfig", // connection metadata (command, args mapping) — no secrets
  "allowedTools",
  "wsConfig", // WebSocket URLs — no secrets
];

/**
 * Strip every provider down to the allowlisted fields. Anything else
 * (most importantly `credentials`) is dropped.
 *
 * Exported for direct unit testing — the credential-leak regression
 * pin asserts this function is the only path provider data takes to
 * the bundle.
 *
 * @param {Array<Object>} providers - raw listProviders() output
 * @returns {Array<Object>} sanitized copies
 */
function stripProviderCredentials(providers) {
  if (!Array.isArray(providers)) return [];
  return providers.map((p) => {
    const safe = {};
    for (const field of SAFE_PROVIDER_FIELDS) {
      if (field in p) safe[field] = p[field];
    }
    return safe;
  });
}

/**
 * Build the bundle contents (4 JSON blobs + manifest) without
 * touching the disk. Exported separately so tests can assert on the
 * structure without mocking electron's dialog/fs surfaces.
 *
 * @param {Object} sources - results of the four list calls
 * @param {Array} sources.workspaces
 * @param {Object} sources.themes
 * @param {Array} sources.menuItems
 * @param {Array} sources.providers - raw, MAY contain credentials
 * @returns {Object} map of file name → Buffer
 */
function buildBundleFiles(sources) {
  const safeProviders = stripProviderCredentials(sources.providers || []);
  const manifest = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      workspaces: Array.isArray(sources.workspaces)
        ? sources.workspaces.length
        : 0,
      themes:
        sources.themes && typeof sources.themes === "object"
          ? Object.keys(sources.themes).length
          : 0,
      menuItems: Array.isArray(sources.menuItems)
        ? sources.menuItems.length
        : 0,
      providers: safeProviders.length,
    },
  };
  const stringify = (obj) => Buffer.from(JSON.stringify(obj, null, 2), "utf-8");
  return {
    "manifest.json": stringify(manifest),
    "workspaces.json": stringify(sources.workspaces || []),
    "themes.json": stringify(sources.themes || {}),
    "menu-items.json": stringify(sources.menuItems || []),
    "providers.json": stringify(safeProviders),
  };
}

/**
 * Export every piece of user-owned config to a single ZIP file the
 * user picks via the save dialog. Returns `{success, filePath}` on
 * success, `{success: false, error}` on failure, or
 * `{success: false, canceled: true}` if the user dismissed the
 * dialog.
 *
 * Provider credentials are NEVER included in the bundle.
 *
 * @param {BrowserWindow} win - main window (for dialog)
 * @param {string} appId - application identifier
 * @param {Object} [options]
 * @param {string} [options.defaultPath] - override the default save
 *   path (used by tests to skip the dialog and write directly)
 * @returns {Promise<Object>}
 */
async function exportEverythingForApplication(win, appId, options = {}) {
  try {
    const { app, dialog } = require("electron");
    const path = require("path");
    const AdmZip = require("adm-zip");
    const workspaceController = require("./workspaceController");
    const themeController = require("./themeController");
    const menuItemsController = require("./menuItemsController");
    const providerController = require("./providerController");

    const wsResult = workspaceController.listWorkspacesForApplication(
      win,
      appId,
    );
    const themeResult = themeController.listThemesForApplication(win, appId);
    const menuResult = menuItemsController.listMenuItemsForApplication(
      win,
      appId,
    );
    const provResult = providerController.listProviders(win, appId);

    const files = buildBundleFiles({
      workspaces: wsResult?.workspaces || [],
      themes: themeResult?.themes || {},
      menuItems: menuResult?.menuItems || [],
      providers: provResult?.providers || [],
    });

    // Allow tests to bypass the save dialog by providing a path. In
    // production, always go through Electron's native save picker so
    // the user explicitly chooses where the bundle lands.
    let filePath = options.defaultPath || null;
    if (!filePath) {
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace(/T/, "_")
        .slice(0, 19);
      const suggested = path.join(
        app.getPath("desktop"),
        `dash-backup-${stamp}.zip`,
      );
      const dlg = await dialog.showSaveDialog(win, {
        title: "Export Everything",
        defaultPath: suggested,
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      });
      if (dlg.canceled || !dlg.filePath) {
        return { success: false, canceled: true };
      }
      filePath = dlg.filePath;
    }

    const zip = new AdmZip();
    for (const [name, buf] of Object.entries(files)) {
      zip.addFile(name, buf);
    }
    zip.writeZip(filePath);

    return {
      success: true,
      filePath,
      counts: JSON.parse(files["manifest.json"].toString("utf-8")).counts,
    };
  } catch (e) {
    console.error("[exportController] Export failed:", e);
    return { success: false, error: e?.message || String(e) };
  }
}

module.exports = {
  exportEverythingForApplication,
  // exported for tests
  buildBundleFiles,
  stripProviderCredentials,
  SAFE_PROVIDER_FIELDS,
  BUNDLE_SCHEMA_VERSION,
};
