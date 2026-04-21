/**
 * widgetRegistryController.js
 *
 * Prepare a widget package for publishing to the dash-registry.
 * Mirrors themeRegistryController pattern: generate manifest, zip
 * the widget directory, POST to /api/publish.
 *
 * Used by:
 *   - Single-widget publish from Settings → Widgets (future UI)
 *   - Batch-publish from the dashboard publish dialog
 */

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { app } = require("electron");

const registryApiController = require("./registryApiController");
const {
  getAuthStatus,
  getRegistryProfile,
} = require("./registryAuthController");
const widgetRegistryModule = require("../widgetRegistry");
const { dynamicWidgetLoader } = require("../dynamicWidgetLoader");
const { findWidgetsDir } = require("../widgetCompiler");
const {
  resolveNextVersion,
  parsePackageName,
  generateWidgetRegistryManifest,
} = require("../schema/widgetPublishManifest");

/**
 * Resilient widget lookup. Callers pass identifiers in different shapes —
 * `@scope/name`, `scope/name`, sometimes bare `name`. Try a few common
 * variants so the batch-publish dialog (which synthesizes a fallback
 * packageId from scope/packageName without the `@` prefix) still finds
 * the registered package.
 */
function findWidget(registry, packageId) {
  if (!packageId) return null;
  const candidates = new Set();
  candidates.add(packageId);
  if (packageId.startsWith("@")) {
    candidates.add(packageId.slice(1));
  } else if (packageId.includes("/")) {
    candidates.add(`@${packageId}`);
  }
  for (const id of candidates) {
    const w = registry.getWidget(id);
    if (w) return w;
  }
  return null;
}

/**
 * Scan a widget package directory for `.dash.js` component configs and
 * return the parsed configs. Used when the widget registry's cached
 * `config.widgets` is missing or empty (e.g. for orphaned / locally-
 * registered widgets) — lets us build a valid manifest from source.
 */
async function scanWidgetConfigs(widgetPath) {
  try {
    const widgetsDir =
      findWidgetsDir(widgetPath) || path.join(widgetPath, "widgets");
    if (!fs.existsSync(widgetsDir)) return [];
    const files = fs.readdirSync(widgetsDir);
    const configs = [];
    for (const file of files) {
      if (!file.endsWith(".dash.js")) continue;
      const configPath = path.join(widgetsDir, file);
      try {
        // eslint-disable-next-line no-await-in-loop
        const cfg = await dynamicWidgetLoader.loadConfigFile(configPath);
        if (cfg && typeof cfg === "object") configs.push(cfg);
      } catch (err) {
        console.warn(`[widgetRegistry] skip ${file}: ${err.message}`);
      }
    }
    return configs;
  } catch (err) {
    console.warn("[widgetRegistry] scanWidgetConfigs failed:", err.message);
    return [];
  }
}

// ─── ZIP builder ─────────────────────────────────────────────────────────────

const ZIP_EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".DS_Store",
  ".next",
  ".cache",
  "coverage",
]);

// ─── Personal-path scanner ───────────────────────────────────────────────────

// Text files we scan for personal paths. Binary / huge files are skipped.
const SCANNABLE_EXTS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".html",
  ".css",
]);
const MAX_FINDINGS = 50;
const MAX_FILE_SIZE = 2 * 1024 * 1024;

// Patterns that strongly suggest a personal filesystem path got baked into
// source. Conservative by design — we'd rather ask the user than leak
// something. Tildes (`~/…`) are NOT flagged because they're ubiquitous in
// widget defaults and don't reveal identity.
const PERSONAL_PATH_PATTERNS = [
  // /Users/<username>/...  — macOS. Username after /Users is the leak.
  /\/Users\/[A-Za-z][\w.-]{1,32}\/[\w./ -]+/g,
  // /home/<username>/...   — Linux.
  /\/home\/[a-z][\w.-]{1,32}\/[\w./ -]+/g,
  // C:\Users\<username>\... — Windows. Allow both \\ and / separators so
  // JSON-escaped paths match too.
  /[Cc]:[\\/]+Users[\\/]+[A-Za-z][\w.-]{1,32}[\\/]+[\w\\/. -]+/g,
];

/**
 * Walk a widget package directory and collect any strings that look like
 * a user's personal filesystem path. Returns an array of
 * `{ file, line, match, context }` findings, capped at MAX_FINDINGS.
 *
 * Applies the same exclude rules as the ZIP builder — we don't want to
 * warn about paths in files that won't ship anyway.
 */
function scanForPersonalPaths(packagePath) {
  const findings = [];
  const walk = (absDir, relDir = "") => {
    if (findings.length >= MAX_FINDINGS) return;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (findings.length >= MAX_FINDINGS) break;
      if (ZIP_EXCLUDE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(absDir, entry.name);
      const rel = relDir ? path.join(relDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SCANNABLE_EXTS.has(ext)) continue;
      let content;
      try {
        const stat = fs.statSync(abs);
        if (stat.size > MAX_FILE_SIZE) continue;
        content = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (findings.length >= MAX_FINDINGS) break;
        const line = lines[i];
        for (const pattern of PERSONAL_PATH_PATTERNS) {
          pattern.lastIndex = 0;
          const m = pattern.exec(line);
          if (m) {
            findings.push({
              file: rel,
              line: i + 1,
              match: m[0],
              context: line.trim().slice(0, 200),
            });
            break; // one finding per line keeps the list digestible
          }
        }
      }
    }
  };
  walk(packagePath);
  return findings;
}

/**
 * Recursively add a directory to a ZIP, skipping excluded dirs + dotfiles.
 */
function addDirToZip(zip, absDir, relDir = "") {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (ZIP_EXCLUDE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(absDir, entry.name);
    const rel = relDir ? path.join(relDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      addDirToZip(zip, abs, rel);
    } else if (entry.isFile()) {
      try {
        zip.addFile(rel, fs.readFileSync(abs));
      } catch (err) {
        console.warn(`[widgetRegistry] skip ${rel}: ${err.message}`);
      }
    }
  }
}

// ─── Orchestration ───────────────────────────────────────────────────────────

/**
 * Prepare and publish a widget package to the registry.
 *
 * @param {string} appId - Application identifier
 * @param {string} packageId - Widget packageId (e.g. "@scope/name" or "name")
 * @param {Object} options
 * @param {"patch"|"minor"|"major"} [options.bump] - Version bump (ignored if options.version set)
 * @param {string} [options.version] - Explicit new version
 * @param {"public"|"private"} [options.visibility="public"]
 * @param {string} [options.description]
 * @param {string[]} [options.tags]
 * @param {string} [options.icon]
 * @param {string} [options.category]
 * @param {string} [options.authorName]
 * @returns {Promise<Object>} { success, manifest, registryResult, error? }
 */
async function prepareWidgetForPublish(appId, packageId, options = {}) {
  try {
    // 1. Auth
    const auth = getAuthStatus();
    if (!auth.authenticated) {
      return {
        success: false,
        error: "Not authenticated with registry",
        authRequired: true,
      };
    }
    const profile = await getRegistryProfile();
    const callerScope = profile?.username || options.scope || "";
    if (!callerScope) {
      return {
        success: false,
        error: "Could not determine registry username",
        authRequired: true,
      };
    }

    // 2. Look up widget in local registry
    const registry = widgetRegistryModule.getWidgetRegistry();
    const widget = findWidget(registry, packageId);
    if (!widget || !widget.path) {
      return {
        success: false,
        error: `Widget package not found locally: ${packageId}`,
      };
    }

    // 3. Read package.json (or fall back to dash.json for registry-installed widgets)
    const pkgJsonPath = path.join(widget.path, "package.json");
    const dashJsonPath = path.join(widget.path, "dash.json");
    let pkgJson;
    if (fs.existsSync(pkgJsonPath)) {
      pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    } else if (fs.existsSync(dashJsonPath)) {
      // Registry-installed widgets only have dash.json — synthesize
      // the fields the publish flow needs from it.
      const dashJson = JSON.parse(fs.readFileSync(dashJsonPath, "utf8"));
      pkgJson = {
        name: dashJson.name ? `@${callerScope}/${dashJson.name}` : packageId,
        version: dashJson.version || "1.0.0",
        description: dashJson.description || "",
        author: dashJson.author || profile?.displayName || "",
      };
    } else {
      return {
        success: false,
        error: `Widget package is missing package.json and dash.json: ${widget.path}`,
      };
    }
    // Scope resolution: the caller's registry username always wins. The
    // package.json may use a local naming convention (e.g. `@ai-built/…`
    // for AI-generated widgets) but the registry only allows publishing
    // under the authenticated user's scope. `options.scope` is honored
    // only if explicitly provided (e.g. for future org publishing).
    const parsedName = parsePackageName(pkgJson.name || "");
    const resolvedScope = options.scope || callerScope;

    // 3.5 Pre-zip privacy scan. Flag any personal filesystem paths baked
    //     into shipped source (e.g. someone edited a `.dash.js`'s
    //     `defaultValue` from `~/Library/...` to `/Users/me/...` to skip
    //     re-entering it every install). We run BEFORE any state mutation
    //     so that a "cancel" on the confirmation dialog leaves the package
    //     exactly as it was — no version bump, no file rewrites.
    if (!options.confirmPersonalPaths) {
      const personalPathFindings = scanForPersonalPaths(widget.path);
      if (personalPathFindings.length > 0) {
        return {
          success: false,
          needsConfirmation: true,
          reason: "personal-paths",
          personalPathFindings,
        };
      }
    }

    // 4. Compute + persist new version
    const previousVersion = pkgJson.version || "1.0.0";
    const newVersion = resolveNextVersion(previousVersion, options);
    if (newVersion !== previousVersion) {
      pkgJson.version = newVersion;
      // Persist to whichever metadata file exists
      if (fs.existsSync(pkgJsonPath)) {
        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
      } else if (fs.existsSync(dashJsonPath)) {
        const dashJson = JSON.parse(fs.readFileSync(dashJsonPath, "utf8"));
        dashJson.version = newVersion;
        fs.writeFileSync(
          dashJsonPath,
          JSON.stringify(dashJson, null, 2) + "\n",
        );
      }
    }

    // 5. Build manifest using the widget's component configs. The
    //    registry cache may be missing widgets (orphaned / locally-
    //    registered packages), so fall back to scanning the package's
    //    .dash.js files from disk.
    let widgetConfigs = widget.widgets || [];
    if (!widgetConfigs.length) {
      widgetConfigs = await scanWidgetConfigs(widget.path);
    }

    if (!widgetConfigs.length) {
      return {
        success: false,
        error: `No .dash.js widget configs found under ${widget.path}. A widget package must expose at least one component.`,
      };
    }

    const manifest = generateWidgetRegistryManifest(pkgJson, widgetConfigs, {
      scope: resolvedScope,
      version: newVersion,
      visibility: options.visibility,
      description: options.description,
      tags: options.tags,
      icon: options.icon,
      category: options.category,
      authorName: options.authorName,
      appOrigin: appId,
    });

    // 6. Zip the widget directory to a temp file
    const zipName = `widget-${manifest.scope}-${manifest.name}-v${manifest.version}.zip`;
    const zipPath = path.join(app.getPath("temp"), zipName);
    const zip = new AdmZip();
    addDirToZip(zip, widget.path);
    zip.writeZip(zipPath);

    // 7. Publish to registry
    const registryResult = await registryApiController.publishToRegistry(
      zipPath,
      manifest,
    );

    // 8. On failure: revert package.json (if we bumped) and surface details
    if (!registryResult.success) {
      if (newVersion !== previousVersion) {
        try {
          pkgJson.version = previousVersion;
          fs.writeFileSync(
            pkgJsonPath,
            JSON.stringify(pkgJson, null, 2) + "\n",
          );
        } catch {
          /* best effort */
        }
      }
      return {
        success: false,
        error: registryResult.error,
        details: registryResult.details,
        manifest,
      };
    }

    // Clean up the temp zip
    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }

    return {
      success: true,
      manifest,
      registryResult,
      previousVersion,
      newVersion,
    };
  } catch (error) {
    console.error("[widgetRegistry] prepareWidgetForPublish failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Inspect a locally-installed widget package and return a summary of
 * metadata the publish UI can display — package.json fields, the
 * caller's scope, and the list of component widgets the package exposes.
 *
 * @param {string} packageId - Widget packageId (e.g. "@scope/name")
 * @returns {Promise<Object>} { success, packageId, scope, name, version, displayName, description, components: [...] }
 */
async function inspectWidgetPackage(packageId) {
  try {
    const registry = widgetRegistryModule.getWidgetRegistry();
    const widget = findWidget(registry, packageId);
    if (!widget || !widget.path) {
      return {
        success: false,
        error: `Widget package not found locally: ${packageId}`,
      };
    }

    let pkgJson = {};
    const pkgJsonPath = path.join(widget.path, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
      } catch {
        /* ignore */
      }
    }
    const parsed = parsePackageName(pkgJson.name || packageId);

    let widgetConfigs = widget.widgets || [];
    if (!widgetConfigs.length) {
      widgetConfigs = await scanWidgetConfigs(widget.path);
    }

    const components = widgetConfigs.map((cfg) => ({
      name: cfg.component || cfg.name,
      displayName: cfg.name || cfg.component,
      description: cfg.description || "",
      icon: cfg.icon || "square",
    }));

    return {
      success: true,
      packageId,
      localScope: parsed.scope || widget.scope || null,
      name: parsed.name,
      version: pkgJson.version || widget.version || null,
      displayName: pkgJson.displayName || widget.displayName || parsed.name,
      description: pkgJson.description || widget.description || "",
      path: widget.path,
      components,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  prepareWidgetForPublish,
  inspectWidgetPackage,
};
