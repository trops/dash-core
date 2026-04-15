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
    const widget = registry.getWidget(packageId);
    if (!widget || !widget.path) {
      return {
        success: false,
        error: `Widget package not found locally: ${packageId}`,
      };
    }

    // 3. Read package.json
    const pkgJsonPath = path.join(widget.path, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      return {
        success: false,
        error: `Widget package is missing package.json: ${widget.path}`,
      };
    }
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    // Scope resolution: the caller's registry username always wins. The
    // package.json may use a local naming convention (e.g. `@ai-built/…`
    // for AI-generated widgets) but the registry only allows publishing
    // under the authenticated user's scope. `options.scope` is honored
    // only if explicitly provided (e.g. for future org publishing).
    const parsedName = parsePackageName(pkgJson.name || "");
    const resolvedScope = options.scope || callerScope;

    // 4. Compute + persist new version
    const previousVersion = pkgJson.version || "1.0.0";
    const newVersion = resolveNextVersion(previousVersion, options);
    if (newVersion !== previousVersion) {
      pkgJson.version = newVersion;
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
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

module.exports = {
  prepareWidgetForPublish,
};
