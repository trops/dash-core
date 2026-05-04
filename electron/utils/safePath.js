/**
 * safePath.js
 *
 * Path-traversal containment for IPC handlers that accept renderer-
 * supplied paths.
 *
 * Why: dash-core exposes IPC handlers (mainApi.data.saveData,
 * mainApi.data.parseXMLStream, mainApi.algolia.createBatchesFromFile,
 * etc.) that historically passed renderer-controlled paths directly to
 * fs.writeFileSync / fs.createReadStream. A widget could pass
 * "../../etc/passwd" and the handler would write/read OUTSIDE the
 * intended app data directory because path.join doesn't reject `..`
 * segments. See docs/security/ipc-filesystem-audit.md for the full
 * finding set.
 *
 * This utility resolves the requested path, walks symlinks, and asserts
 * containment within at least one explicitly-allowed root. Any handler
 * that takes a renderer path runs it through `safePath(p, roots)` and
 * either gets back a validated absolute real-path, or throws.
 *
 * Public API:
 *
 *   safePath(requested, allowedRoots[]) → string
 *     Throws on traversal, missing input, or empty roots. Returns the
 *     resolved real-path (which is what the caller should pass to fs).
 *
 *   getAllowedRoots(category) → string[]
 *     Canonical roots per category. Categories:
 *       "data"     — userData/Dashboard/data + user-configured override
 *       "themes"   — userData/Dashboard/themes
 *       "widgets"  — userData/widgets
 *       "plugins"  — userData/plugins
 *       "downloads"— OS Downloads folder
 *
 * Defense layers:
 *   1. path.resolve() to absolute form.
 *   2. fs.realpathSync() through any symlinks. If the path doesn't
 *      exist yet, realpath the parent directory (so a symlink-in-parent
 *      can't trick a future create operation).
 *   3. startsWith(realRoot + path.sep) test — single-equals check
 *      handles "exactly the root" case, prefix-with-sep handles
 *      "inside the root" without false-matching `/data-evil/` against
 *      `/data/`.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const APP_NAME = "Dashboard";

/**
 * @param {string} category
 * @returns {string[]} ordered allowed roots for that category
 */
function getAllowedRoots(category) {
  const userData = app.getPath("userData");
  switch (category) {
    case "data": {
      const def = path.join(userData, APP_NAME, "data");
      // The user can configure a custom data directory in
      // Settings → General → Data Directory. If set, that
      // location is ALSO an allowed root. We don't replace the
      // default — both are valid because legacy data may still
      // live in the default while new data goes to the override.
      const override = readDataDirectoryFromSettings();
      return override ? [def, override] : [def];
    }
    case "themes":
      return [path.join(userData, APP_NAME, "themes")];
    case "widgets":
      return [path.join(userData, "widgets")];
    case "plugins":
      return [path.join(userData, "plugins")];
    case "downloads":
      return [app.getPath("downloads")];
    default:
      throw new Error("safePath: unknown allowed-roots category: " + category);
  }
}

/**
 * Read the user-configured data directory from settings.json. Returns
 * undefined if not set or unreadable.
 *
 * Inlined to avoid a circular require with settingsController. Reads
 * the same settings.json file directly.
 */
function readDataDirectoryFromSettings() {
  try {
    const settingsPath = path.join(
      app.getPath("userData"),
      APP_NAME,
      "settings.json",
    );
    if (!fs.existsSync(settingsPath)) return undefined;
    const raw = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw);
    const dir = settings && settings.dataDirectory;
    if (typeof dir === "string" && dir) return dir;
  } catch (_e) {
    // best-effort — fall through to default
  }
  return undefined;
}

/**
 * Resolve and validate a path against allowed roots.
 *
 * @param {string} requested  the path the renderer asked for
 * @param {string[]} allowedRoots  list of absolute paths the result must be inside
 * @returns {string} validated absolute real-path
 * @throws if requested is not contained within any allowed root
 */
function safePath(requested, allowedRoots) {
  if (typeof requested !== "string" || !requested) {
    throw new Error("safePath: requested must be a non-empty string");
  }
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    throw new Error("safePath: allowedRoots must be a non-empty array");
  }

  const resolved = path.resolve(requested);

  // Real-path through symlinks. If the file doesn't exist yet (a
  // create-new operation), real-path the parent so a symlink in the
  // parent chain can't trick us.
  let real = resolved;
  try {
    real = fs.realpathSync(resolved);
  } catch (_e) {
    try {
      const parent = fs.realpathSync(path.dirname(resolved));
      real = path.join(parent, path.basename(resolved));
    } catch (_e2) {
      // Parent doesn't exist either. Use the resolved-but-not-
      // real path; the caller's mkdirSync will happen inside the
      // validated root, and any symlinks underneath will be
      // re-checked the next time safePath sees the same path.
    }
  }

  for (const root of allowedRoots) {
    let realRoot = root;
    try {
      if (fs.existsSync(root)) realRoot = fs.realpathSync(root);
    } catch (_e) {
      // root doesn't exist or isn't reachable — keep as-is for
      // the comparison below
    }
    // Exact match OR strictly-inside (with separator to prevent
    // /data-evil/ matching /data/).
    if (real === realRoot || real.startsWith(realRoot + path.sep)) {
      return real;
    }
  }

  throw new Error(
    "safePath: requested path is not within any allowed root. " +
      "Requested: " +
      requested +
      " (resolved to " +
      real +
      "). Allowed roots: " +
      allowedRoots.join(", "),
  );
}

module.exports = {
  safePath,
  getAllowedRoots,
};
