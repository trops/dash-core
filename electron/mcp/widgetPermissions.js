/**
 * widgetPermissions.js
 *
 * Read and parse the `dash.permissions.mcp` block from an installed
 * widget's package.json.
 *
 * Manifest format (declared by widget authors in their package.json):
 *
 *   {
 *     "name": "@trops/notes-summarizer",
 *     "dash": {
 *       "permissions": {
 *         "mcp": {
 *           "filesystem": {
 *             "tools": ["read_file", "list_directory"],
 *             "readPaths": ["~/Documents/notes"],
 *             "writePaths": []
 *           },
 *           "github": {
 *             "tools": ["search_repositories", "get_file_contents"]
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 * Path strings beginning with `~` are expanded to the user's home
 * directory at parse time. Tool-only servers (no path I/O, e.g.
 * github) omit the `readPaths`/`writePaths` keys.
 *
 * Public API:
 *
 *   getWidgetMcpPermissions(widgetId) → permissions | null
 *     Returns the parsed permissions for a widget, or null if the
 *     widget is unmanifested. Cached per process.
 *
 *   parseManifestPermissions(packageJson) → permissions | null
 *     Pure function — exposed for tests.
 *
 *   clearCache() → void
 *     Test-only. Drops the in-process cache so tests can re-read.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { app } = require("electron");

// Cache: widgetId → permissions | null. Populated lazily on first
// lookup; invalidated when a widget is installed/uninstalled (the
// install/uninstall paths call clearCache()).
const _cache = new Map();

/**
 * Expand a leading "~" to the user's home directory. Other paths are
 * returned as-is.
 */
function expandHome(p) {
  if (typeof p !== "string" || !p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Parse a widget's package.json contents into a normalized permissions
 * object. Returns null if no `dash.permissions.mcp` block exists.
 */
function parseManifestPermissions(packageJson) {
  if (!packageJson || typeof packageJson !== "object") return null;
  const mcp = packageJson?.dash?.permissions?.mcp;
  if (!mcp || typeof mcp !== "object") return null;

  const servers = {};
  for (const [serverName, raw] of Object.entries(mcp)) {
    if (!raw || typeof raw !== "object") continue;
    const tools = Array.isArray(raw.tools)
      ? raw.tools.filter((t) => typeof t === "string")
      : [];
    const readPaths = Array.isArray(raw.readPaths)
      ? raw.readPaths.filter((p) => typeof p === "string").map(expandHome)
      : [];
    const writePaths = Array.isArray(raw.writePaths)
      ? raw.writePaths.filter((p) => typeof p === "string").map(expandHome)
      : [];
    servers[serverName] = { tools, readPaths, writePaths };
  }

  return { servers };
}

/**
 * Translate a dotted component widget id into the npm package id whose
 * package.json holds the manifest. Mirrors the construction logic in
 * `src/Components/Dashboard/WidgetsTab.js` (`<scope>.<pkg>.<comp>`):
 *
 *   "@trops/gmail"                       → "@trops/gmail"
 *   "trops.gmail.GmailCompose"           → "@trops/gmail"
 *   "ai-built.pipeline.ProspectWorkspace" → "@ai-built/pipeline"
 *   "pipeline.AutomationHub"             → "pipeline"   (bare, no scope)
 *   "legacy-bare-package"                → "legacy-bare-package"
 *
 * The grant store keys grants by the dotted form; the on-disk widget
 * folder is keyed by the npm form. This bridges the two.
 */
function dottedComponentIdToPackageId(widgetId) {
  if (typeof widgetId !== "string" || !widgetId) return null;
  if (widgetId.startsWith("@")) return widgetId;
  const parts = widgetId.split(".");
  if (parts.length >= 3) return `@${parts[0]}/${parts[1]}`;
  if (parts.length === 2) return parts[0];
  return widgetId;
}

/**
 * Find a widget's installed package.json on disk. Widgets live under
 * userData/widgets/<scope>/<name>/ for scoped packages or
 * userData/widgets/<name>/ for unscoped. Accepts either npm package
 * ids ("@trops/gmail") or dotted component ids
 * ("trops.gmail.GmailCompose") — the latter is translated first.
 */
function resolveWidgetPackagePath(widgetId) {
  const packageId = dottedComponentIdToPackageId(widgetId);
  if (typeof packageId !== "string" || !packageId) return null;
  const widgetsRoot = path.join(app.getPath("userData"), "widgets");
  // Split scope from name for "@scope/name" form.
  const parts = packageId.startsWith("@") ? packageId.split("/") : [packageId];
  return path.join(widgetsRoot, ...parts, "package.json");
}

/**
 * Read and parse a widget's MCP permissions. Returns null if:
 *   - the widget directory doesn't exist
 *   - package.json is unreadable / malformed
 *   - the widget hasn't declared dash.permissions.mcp
 *
 * Result is cached per widgetId for the lifetime of this process.
 */
function getWidgetMcpPermissions(widgetId) {
  if (_cache.has(widgetId)) return _cache.get(widgetId);
  const pkgPath = resolveWidgetPackagePath(widgetId);
  if (!pkgPath || !fs.existsSync(pkgPath)) {
    _cache.set(widgetId, null);
    return null;
  }
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    const perms = parseManifestPermissions(pkg);
    _cache.set(widgetId, perms);
    return perms;
  } catch (e) {
    console.warn(
      "[widgetPermissions] failed to read package.json for " +
        widgetId +
        ": " +
        e.message,
    );
    _cache.set(widgetId, null);
    return null;
  }
}

function clearCache() {
  _cache.clear();
}

module.exports = {
  getWidgetMcpPermissions,
  parseManifestPermissions,
  dottedComponentIdToPackageId,
  expandHome,
  clearCache,
};
