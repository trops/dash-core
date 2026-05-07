/**
 * Widget Registry System
 *
 * Manages widget discovery, download, and dynamic loading
 * Widgets are expected to have:
 * - package.json (or dash.json) with metadata
 * - widgets/ folder containing [WidgetName].js and [WidgetName].dash.js
 *
 * Files are stored in the Electron app's userData directory:
 * - macOS: ~/Library/Application Support/[appName]/
 * - Windows: %APPDATA%/[appName]/
 * - Linux: ~/.config/[appName]/
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");
const { fileURLToPath } = require("url");
const { app, ipcMain, BrowserWindow } = require("electron");
const { dynamicWidgetLoader } = require("./dynamicWidgetLoader");
const { compileWidget, findWidgetsDir } = require("./widgetCompiler");
const { toPackageId, parsePackageId } = require("./utils/packageId");
const { getStoredToken } = require("./controller/registryAuthController");
const {
  getWidgetMcpPermissions,
  clearCache: clearWidgetPermsCache,
} = require("./mcp/widgetPermissions");
const { scanForMcpUsage } = require("./utils/manifestScanner");

let WIDGETS_CACHE_DIR = null;
let REGISTRY_CONFIG_FILE = null;

/**
 * Populate an existing registry entry with componentNames + widgets
 * metadata derived from the package on disk. Tries, in order:
 *   1. dash.json's `widgets` array (the canonical manifest)
 *   2. scanning `widgets/` for *.dash.js files if dash.json is missing
 * Mutates the entry in place. Safe to call on entries that already
 * carry the metadata — only fills blanks, never overwrites existing
 * values except to promote a more complete list.
 */
function enrichEntryFromDisk(entry, pkgPath) {
  try {
    const dashJsonPath = path.join(pkgPath, "dash.json");
    let widgetsMeta = [];
    // Drop non-object provider entries before caching. A sparse array
    // in a widget's dash.json (trailing comma, conditional include
    // that returned undefined) otherwise propagates into every renderer
    // useMemo that iterates `widget.providers` and crashes on
    // `p.providerClass`. Sanitizing at install/enrich time keeps the
    // in-process cache clean regardless of what shipped in the ZIP.
    const sanitizeWidget = (w) => {
      if (!w || typeof w !== "object") return w;
      if (!Array.isArray(w.providers)) return w;
      const clean = w.providers.filter((p) => p && typeof p === "object");
      return clean.length === w.providers.length
        ? w
        : { ...w, providers: clean };
    };
    if (fs.existsSync(dashJsonPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(dashJsonPath, "utf8"));
        if (Array.isArray(manifest.widgets)) {
          widgetsMeta = manifest.widgets.map(sanitizeWidget);
        }
        if (!entry.displayName && manifest.displayName)
          entry.displayName = manifest.displayName;
        if (!entry.description && manifest.description)
          entry.description = manifest.description;
        if (!entry.author && manifest.author) entry.author = manifest.author;
        if (!entry.version && manifest.version)
          entry.version = manifest.version;
      } catch (err) {
        console.warn(
          `[WidgetRegistry] Could not parse dash.json at ${dashJsonPath}:`,
          err.message,
        );
      }
    }
    // Fallback: scan widgets/*.dash.js if dash.json didn't yield anything.
    if (widgetsMeta.length === 0) {
      const widgetsDir = path.join(pkgPath, "widgets");
      if (fs.existsSync(widgetsDir)) {
        try {
          widgetsMeta = fs
            .readdirSync(widgetsDir)
            .filter((f) => f.endsWith(".dash.js"))
            .map((f) => ({ name: f.replace(/\.dash\.js$/, "") }));
        } catch (_) {
          /* ignore */
        }
      }
    }
    if (widgetsMeta.length > 0) {
      const names = widgetsMeta
        .map((w) => w && w.name)
        .filter((n) => typeof n === "string" && n.length > 0);
      if (
        names.length >
        (Array.isArray(entry.componentNames) ? entry.componentNames.length : 0)
      ) {
        entry.componentNames = names;
      }
      if (
        widgetsMeta.length >
        (Array.isArray(entry.widgets) ? entry.widgets.length : 0)
      ) {
        entry.widgets = widgetsMeta;
      }
    }
  } catch (err) {
    console.warn(
      `[WidgetRegistry] enrichEntryFromDisk failed for ${pkgPath}:`,
      err.message,
    );
  }
}

/**
 * Validate ZIP entries to prevent path traversal attacks.
 * Rejects entries containing '..' segments or absolute paths that would
 * write outside the target extraction directory.
 * @param {AdmZip} zip - AdmZip instance
 * @param {string} targetDir - Intended extraction directory
 * @throws {Error} If any entry would escape the target directory
 */
function validateZipEntries(zip, targetDir) {
  const resolvedTarget = path.resolve(targetDir);
  for (const entry of zip.getEntries()) {
    const entryPath = entry.entryName;
    // Reject entries with '..' path segments
    if (
      entryPath.split("/").includes("..") ||
      entryPath.split("\\").includes("..")
    ) {
      throw new Error(
        `Malicious ZIP entry rejected (path traversal): ${entryPath}`,
      );
    }
    // Reject absolute paths
    if (path.isAbsolute(entryPath)) {
      throw new Error(
        `Malicious ZIP entry rejected (absolute path): ${entryPath}`,
      );
    }
    // Final check: resolved path must be within target directory
    const resolvedEntry = path.resolve(resolvedTarget, entryPath);
    if (
      !resolvedEntry.startsWith(resolvedTarget + path.sep) &&
      resolvedEntry !== resolvedTarget
    ) {
      throw new Error(
        `Malicious ZIP entry rejected (escapes target): ${entryPath}`,
      );
    }
  }
}

/**
 * Initialize registry with custom path or default userData path
 * @param {string} customPath - Optional custom path for storing widgets
 */
function initializeRegistry(customPath = null) {
  if (customPath) {
    WIDGETS_CACHE_DIR = path.join(customPath, "widgets");
  } else {
    WIDGETS_CACHE_DIR = path.join(app.getPath("userData"), "widgets");
  }
  REGISTRY_CONFIG_FILE = path.join(WIDGETS_CACHE_DIR, "registry.json");
  console.log(`[WidgetRegistry] Using storage path: ${WIDGETS_CACHE_DIR}`);
}

class WidgetRegistry {
  constructor(componentManager = null, customPath = null) {
    if (!WIDGETS_CACHE_DIR) {
      initializeRegistry(customPath);
    }

    this.widgets = new Map();
    this.componentManager = componentManager;
    this.ensureCacheDir();
    this.loadRegistry();
  }

  /**
   * Static method to initialize registry with custom path
   * Call this early in your app startup (e.g., in main.js)
   * @param {string} customPath - Custom path for storing widgets/configs
   */
  static initialize(customPath = null) {
    initializeRegistry(customPath);
  }

  /**
   * Set ComponentManager instance for automatic widget registration
   * @param {Object} manager - ComponentManager instance from @trops/dash-react
   */
  setComponentManager(manager) {
    this.componentManager = manager;
  }

  /**
   * Ensure cache directory exists
   */
  ensureCacheDir() {
    if (!fs.existsSync(WIDGETS_CACHE_DIR)) {
      fs.mkdirSync(WIDGETS_CACHE_DIR, { recursive: true });
    }
  }

  /**
   * Load registry from disk
   */
  loadRegistry() {
    try {
      if (fs.existsSync(REGISTRY_CONFIG_FILE)) {
        const data = fs.readFileSync(REGISTRY_CONFIG_FILE, "utf8");
        const registryData = JSON.parse(data);
        this.widgets = new Map(registryData.widgets || []);
        console.log(
          `[WidgetRegistry] Loaded ${this.widgets.size} widgets from cache`,
        );

        // Migration: re-key bare-name entries that have scope metadata
        if (!registryData._scopeMigrated) {
          let migrated = false;
          const entries = Array.from(this.widgets.entries());
          for (const [key, entry] of entries) {
            if (entry.scope && !key.startsWith("@")) {
              const scopedId = toPackageId(entry.scope, key);

              // Move folder from widgets/{name}/ to widgets/@{scope}/{name}/
              const oldPath = path.join(WIDGETS_CACHE_DIR, key);
              const newPath = path.join(
                WIDGETS_CACHE_DIR,
                ...scopedId.split("/"),
              );
              if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
                const scopeDir = path.dirname(newPath);
                if (!fs.existsSync(scopeDir)) {
                  fs.mkdirSync(scopeDir, { recursive: true });
                }
                fs.renameSync(oldPath, newPath);
                console.log(
                  `[WidgetRegistry] Migrated folder: ${key} → ${scopedId}`,
                );
              }

              // Re-key in the Map
              entry.name = scopedId;
              entry.packageId = scopedId;
              entry.path = newPath;
              this.widgets.delete(key);
              this.widgets.set(scopedId, entry);
              migrated = true;
            }
          }
          if (migrated) {
            this.saveRegistry();
            console.log("[WidgetRegistry] Scope migration complete");
          }
        }
      }
    } catch (error) {
      console.error("[WidgetRegistry] Error loading registry:", error);
    }

    // Reconcile: re-register orphaned widget packages found on disk
    this.reconcileWithDisk();
  }

  /**
   * Scan the widgets directory for packages that exist on disk but are
   * missing from the registry (e.g. because registry.json was manually edited).
   * Re-registers them so they can be properly managed (listed, uninstalled).
   */
  reconcileWithDisk() {
    try {
      if (!WIDGETS_CACHE_DIR || !fs.existsSync(WIDGETS_CACHE_DIR)) return;

      const registeredPaths = new Set(
        Array.from(this.widgets.values()).map((w) => w.path),
      );
      let reconciled = false;

      const entries = fs.readdirSync(WIDGETS_CACHE_DIR, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        if (entry.name.startsWith("@")) {
          // Scoped packages: @scope/name
          const scopeDir = path.join(WIDGETS_CACHE_DIR, entry.name);
          const pkgs = fs.readdirSync(scopeDir, { withFileTypes: true });
          for (const pkg of pkgs) {
            if (!pkg.isDirectory()) continue;
            const pkgPath = path.join(scopeDir, pkg.name);
            const pkgId = `${entry.name}/${pkg.name}`;
            if (!registeredPaths.has(pkgPath) && !this.widgets.has(pkgId)) {
              this._reregisterOrphan(pkgId, pkgPath);
              reconciled = true;
            }
          }
        } else if (entry.name !== "registry.json") {
          // Bare-name packages
          const pkgPath = path.join(WIDGETS_CACHE_DIR, entry.name);
          if (!registeredPaths.has(pkgPath) && !this.widgets.has(entry.name)) {
            this._reregisterOrphan(entry.name, pkgPath);
            reconciled = true;
          }
        }
      }

      if (reconciled) {
        this.saveRegistry();
        console.log("[WidgetRegistry] Disk reconciliation complete");
      }

      // Back-fill componentNames / widgets metadata for any entries
      // that still look stale (e.g. packages written by older install
      // flows before metadata was tracked). Needed for the "Edit with
      // AI" reverse lookup to find which package owns a component.
      this.backfillMetadataFromDisk();
    } catch (err) {
      console.warn("[WidgetRegistry] Reconciliation error:", err.message);
    }
  }

  /**
   * Re-register an orphaned widget package found on disk. Reads the
   * package's dash.json if present so the registry entry carries the
   * full component list — without this, downstream flows that look up
   * "which package contains component X?" (e.g. Edit with AI) hit an
   * empty `componentNames` array and silently fail.
   */
  _reregisterOrphan(pkgId, pkgPath) {
    console.log(`[WidgetRegistry] Re-registering orphaned widget: ${pkgId}`);
    const { scope } = parsePackageId(pkgId);
    const entry = {
      name: pkgId,
      packageId: pkgId,
      scope: scope || null,
      path: pkgPath,
      version: null,
      orphaned: true,
    };
    enrichEntryFromDisk(entry, pkgPath);
    this.widgets.set(pkgId, entry);
  }

  /**
   * One-time pass over existing registry entries to back-fill missing
   * component metadata from each package's dash.json / widgets folder.
   * Needed for entries that were written by an older version of the
   * install flow before componentNames was tracked — without this,
   * "Edit with AI" and other reverse-lookups ("which package owns
   * component X?") can't resolve the package.
   */
  backfillMetadataFromDisk() {
    let changed = false;
    for (const [pkgId, entry] of this.widgets.entries()) {
      if (!entry.path || !fs.existsSync(entry.path)) continue;
      // Always re-enrich from disk — don't gate on whether the cache
      // looks populated. A package's `dash.json` can gain new widgets
      // between sessions (author edits, AI-builder adds, etc.), and
      // skipping enrichment here is exactly how publish ends up
      // attributing a shared component to the wrong package:
      // `@scope/bundle` appears to not provide it (stale cache),
      // so a singleton `@scope/name` wins by elimination.
      // `enrichEntryFromDisk` already guards against shrinking the
      // list, so re-running it on every entry is idempotent.
      const before = {
        cn: (entry.componentNames || []).length,
        w: (entry.widgets || []).length,
      };
      enrichEntryFromDisk(entry, entry.path);
      const after = {
        cn: (entry.componentNames || []).length,
        w: (entry.widgets || []).length,
      };
      if (after.cn !== before.cn || after.w !== before.w) {
        console.log(
          `[WidgetRegistry] Refreshed metadata for ${pkgId}: ` +
            `componentNames ${before.cn} → ${after.cn}, widgets ${before.w} → ${after.w}`,
        );
        changed = true;
      }
    }
    if (changed) this.saveRegistry();
  }

  /**
   * Save registry to disk
   */
  saveRegistry() {
    try {
      const registryData = {
        lastUpdated: new Date().toISOString(),
        widgets: Array.from(this.widgets.entries()),
      };
      fs.writeFileSync(
        REGISTRY_CONFIG_FILE,
        JSON.stringify(registryData, null, 2),
      );
    } catch (error) {
      console.error("[WidgetRegistry] Error saving registry:", error);
    }
  }

  /**
   * Resolve download URL from partial template or full URL
   * Supports placeholders: {version}, {name}
   *
   * Examples:
   * - Full URL: "https://github.com/user/widget/releases/download/v1.0.0/widget.zip"
   * - Template: "https://github.com/user/weather-widget/releases/download/v{version}/weather-widget.zip"
   * - Partial: "https://github.com/user/weather-widget/releases/download/" (auto-generates v{version}/{name}.zip)
   *
   * @param {string} urlTemplate - URL template or partial URL
   * @param {string} version - Widget version (e.g., "1.0.0")
   * @param {string} name - Widget name (e.g., "weather-widget")
   * @returns {string} Resolved download URL
   */
  resolveDownloadUrl(urlTemplate, version, name) {
    if (!urlTemplate) return null;

    if (urlTemplate.endsWith("/")) {
      return `${urlTemplate}v${version}/${name}.zip`;
    }

    let url = urlTemplate;
    url = url.replace("{version}", version);
    url = url.replace("{name}", name);
    return url;
  }

  /**
   * Determine if the input points to a local path (file:// or filesystem path)
   * @param {string} input - URL or path
   * @returns {boolean}
   */
  isLocalSource(input) {
    if (!input) return false;
    if (input.startsWith("file://")) return true;
    if (input.startsWith("http://") || input.startsWith("https://"))
      return false;
    const resolvedPath = this.resolveLocalPath(input);
    return fs.existsSync(resolvedPath);
  }

  /**
   * Normalize a local path (supports file:// and ~)
   * @param {string} input - Local path or file:// URL
   * @returns {string}
   */
  resolveLocalPath(input) {
    if (input.startsWith("file://")) {
      return fileURLToPath(input);
    }
    if (input.startsWith("~")) {
      return path.join(os.homedir(), input.slice(1));
    }
    return path.resolve(input);
  }

  /**
   * Install a widget from a local ZIP file or folder path
   * @param {string} widgetName - Name of the widget
   * @param {string} localPath - Path to ZIP file or widget folder
   * @param {boolean} autoRegister - Automatically register with ComponentManager
   * @param {string} dashConfigPath - Optional: path to dash.json metadata file
   * @returns {Promise<Object>} Widget configuration
   */
  async installFromLocalPath(
    widgetName,
    localPath,
    autoRegister = true,
    dashConfigPath = null,
  ) {
    try {
      const resolvedPath = this.resolveLocalPath(localPath);

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Local path not found: ${resolvedPath}`);
      }

      // Scoped names (e.g. "@trops/slack") get nested dirs: widgets/@trops/slack/
      const widgetPath = path.join(WIDGETS_CACHE_DIR, ...widgetName.split("/"));

      if (fs.existsSync(widgetPath)) {
        fs.rmSync(widgetPath, { recursive: true });
      }

      const isDirectory = fs.statSync(resolvedPath).isDirectory();
      if (isDirectory) {
        fs.cpSync(resolvedPath, widgetPath, { recursive: true });
      } else if (resolvedPath.endsWith(".zip")) {
        const zip = new AdmZip(resolvedPath);
        validateZipEntries(zip, widgetPath);
        zip.extractAllTo(widgetPath, true);
      } else {
        throw new Error(`Unsupported local source type: ${resolvedPath}`);
      }

      // Slice 13a: scan the freshly-installed widget for MCP usage and
      // update the package.json's `dash.permissions.mcp` block. Always
      // runs (even when a manifest already exists) — catches author
      // forgetfulness and version updates that introduced new tools.
      // Merge is additive; hand-authored entries are preserved.
      try {
        const {
          applyScanToPackageJson,
        } = require("./utils/scanWidgetPackagePermissions");
        applyScanToPackageJson(widgetPath);
      } catch (e) {
        console.warn(
          `[WidgetRegistry] Permission scan failed for ${widgetName}: ${e.message}`,
        );
        // Non-fatal — the gate's runtime JIT still backs us up.
      }

      let config = await this.loadWidgetConfig(widgetName, widgetPath);

      if (dashConfigPath) {
        const configPath = this.resolveLocalPath(dashConfigPath);
        if (fs.existsSync(configPath)) {
          const dashConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
          config = { ...config, ...dashConfig };
        }
      }

      this.registerWidget(widgetName, config, widgetPath, false);

      if (autoRegister) {
        await this.loadWidgetComponents(widgetName, widgetPath);
      }

      return config;
    } catch (error) {
      console.error(
        `[WidgetRegistry] Error installing local widget ${widgetName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Check if a directory looks like a valid widget folder.
   * A directory is a widget if it has:
   * - package.json or dash.json at its root, OR
   * - A widgets/ subdirectory containing at least one .dash.js file
   * @param {string} dirPath - Path to the directory
   * @returns {boolean}
   */
  isWidgetFolder(dirPath) {
    if (fs.existsSync(path.join(dirPath, "package.json"))) return true;
    if (fs.existsSync(path.join(dirPath, "dash.json"))) return true;

    const widgetsDir = path.join(dirPath, "widgets");
    if (fs.existsSync(widgetsDir) && fs.statSync(widgetsDir).isDirectory()) {
      const files = fs.readdirSync(widgetsDir);
      if (files.some((f) => f.endsWith(".dash.js"))) return true;
    }

    return false;
  }

  /**
   * Register all widgets found in a local folder.
   *
   * Smart detection:
   * 1. If the selected folder itself is a widget, install it directly.
   * 2. Otherwise iterate subdirectories, skipping non-widget dirs.
   *
   * @param {string} folderPath - Path containing widget folders (or a single widget folder)
   * @param {boolean} autoRegister - Automatically register with ComponentManager
   * @returns {Promise<Array>} Registered widgets (with optional `mode` and `skipped` metadata)
   */
  async registerWidgetsFromFolder(folderPath, autoRegister = true) {
    const SKIP_DIRS = new Set(["node_modules", "dist", "__MACOSX", ".git"]);

    try {
      const resolvedPath = this.resolveLocalPath(folderPath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Folder not found: ${resolvedPath}`);
      }
      if (!fs.statSync(resolvedPath).isDirectory()) {
        throw new Error(`Path is not a directory: ${resolvedPath}`);
      }

      // 1. Check if the selected folder itself is a widget
      if (this.isWidgetFolder(resolvedPath)) {
        const widgetName = path.basename(resolvedPath);
        const config = await this.installFromLocalPath(
          widgetName,
          resolvedPath,
          autoRegister,
        );
        return [
          {
            name: widgetName,
            path: resolvedPath,
            ...config,
            mode: "single",
          },
        ];
      }

      // 2. Iterate subdirectories with filtering
      const entries = fs.readdirSync(resolvedPath, {
        withFileTypes: true,
      });
      const results = [];
      let skipped = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Skip hidden dirs and known non-widget dirs
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) {
          skipped++;
          continue;
        }

        const widgetPath = path.join(resolvedPath, entry.name);

        if (!this.isWidgetFolder(widgetPath)) {
          skipped++;
          continue;
        }

        const config = await this.loadWidgetConfig(entry.name, widgetPath);
        this.registerWidget(entry.name, config, widgetPath, false);

        if (autoRegister) {
          await this.loadWidgetComponents(entry.name, widgetPath);
        }

        results.push({
          name: entry.name,
          path: widgetPath,
          ...config,
        });
      }

      // Attach skipped count as metadata on the array
      results.skipped = skipped;
      return results;
    } catch (error) {
      console.error(
        "[WidgetRegistry] Error registering widgets from folder:",
        error,
      );
      throw error;
    }
  }

  /**
   * Download widget from URL (ZIP file)
   * @param {string} widgetName - Name of the widget
   * @param {string} downloadUrl - URL to download ZIP file from (supports templates and partial URLs)
   * @param {string} dashConfigUrl - Optional: URL to dash.json metadata file
   * @param {boolean} autoRegister - Automatically register with ComponentManager
   * @returns {Promise<Object>} Widget configuration
   */
  async downloadWidget(
    widgetName,
    downloadUrl,
    dashConfigUrl = null,
    autoRegister = true,
  ) {
    try {
      if (this.isLocalSource(downloadUrl)) {
        return this.installFromLocalPath(
          widgetName,
          downloadUrl,
          autoRegister,
          dashConfigUrl,
        );
      }
      // Enforce HTTPS to prevent MITM attacks on widget downloads
      const parsedUrl = new URL(downloadUrl);
      if (parsedUrl.protocol !== "https:") {
        throw new Error(
          `Widget downloads must use HTTPS. Refusing to fetch: ${downloadUrl}`,
        );
      }

      console.log(
        `[WidgetRegistry] Downloading widget: ${widgetName} from ${downloadUrl}`,
      );

      // Add auth header for registry API download endpoints
      const fetchOpts = {};
      const registryBase =
        process.env.DASH_REGISTRY_API_URL ||
        "https://main.d919rwhuzp7rj.amplifyapp.com";
      if (
        downloadUrl.includes(registryBase) ||
        downloadUrl.includes("/api/packages/")
      ) {
        const auth = getStoredToken();
        if (auth?.token) {
          fetchOpts.headers = { Authorization: `Bearer ${auth.token}` };
        }
      }

      let response;
      try {
        response = await fetch(downloadUrl, fetchOpts);
      } catch (fetchErr) {
        throw new Error(
          "Could not reach the download server. Check your connection and try again.",
        );
      }
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Authentication required to download this widget");
        }
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      let buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.length === 0) {
        throw new Error("Download failed: registry returned an empty response");
      }

      if (contentType.includes("text/html")) {
        throw new Error(
          "Download failed: registry returned an HTML page instead of package data",
        );
      }

      // Registry download endpoints return JSON with a pre-signed S3 URL
      if (contentType.includes("application/json")) {
        let jsonData;
        try {
          jsonData = JSON.parse(buffer.toString("utf-8"));
        } catch (parseErr) {
          throw new Error(
            `Download failed: invalid JSON (${parseErr.message})`,
          );
        }
        if (jsonData.error) {
          throw new Error(`Download failed: ${jsonData.error}`);
        }
        if (jsonData.downloadUrl) {
          const zipResponse = await fetch(jsonData.downloadUrl);
          if (!zipResponse.ok) {
            throw new Error(
              `Download failed: storage returned ${zipResponse.status} ${zipResponse.statusText}`,
            );
          }
          buffer = Buffer.from(await zipResponse.arrayBuffer());
          if (buffer.length === 0) {
            throw new Error(
              "Download failed: storage returned an empty ZIP file",
            );
          }
        }
      }

      const zip = new AdmZip(buffer);

      // Scoped names (e.g. "@trops/slack") get nested dirs: widgets/@trops/slack/
      const widgetPath = path.join(WIDGETS_CACHE_DIR, ...widgetName.split("/"));

      if (fs.existsSync(widgetPath)) {
        fs.rmSync(widgetPath, { recursive: true });
      }

      validateZipEntries(zip, widgetPath);
      zip.extractAllTo(widgetPath, true);
      console.log(`[WidgetRegistry] Extracted widget to: ${widgetPath}`);

      let config = await this.loadWidgetConfig(widgetName, widgetPath);

      if (dashConfigUrl) {
        const dashConfig = await this.fetchJSON(dashConfigUrl);
        config = { ...config, ...dashConfig };
      }

      this.registerWidget(widgetName, config, widgetPath, false);

      if (autoRegister) {
        await this.loadWidgetComponents(widgetName, widgetPath);
      }

      return config;
    } catch (error) {
      console.error(
        `[WidgetRegistry] Error downloading widget ${widgetName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Load widget configuration from local path
   * @param {string} widgetName - Name of the widget
   * @param {string} widgetPath - Path to widget directory
   * @returns {Promise<Object>} Widget configuration
   */
  async loadWidgetConfig(widgetName, widgetPath) {
    try {
      const dashJsonPath = path.join(widgetPath, "dash.json");
      if (fs.existsSync(dashJsonPath)) {
        const data = fs.readFileSync(dashJsonPath, "utf8");
        return JSON.parse(data);
      }

      const packageJsonPath = path.join(widgetPath, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf8"),
        );
        return {
          name: packageJson.name || widgetName,
          version: packageJson.version,
          description: packageJson.description,
          author: packageJson.author,
          repository: packageJson.repository,
        };
      }

      return {
        name: widgetName,
        version: "1.0.0",
      };
    } catch (error) {
      console.error(
        `[WidgetRegistry] Error loading config for ${widgetName}:`,
        error,
      );
      return { name: widgetName };
    }
  }

  /**
   * Register a widget in the registry
   * @param {string} widgetName - Name of the widget
   * @param {Object} config - Widget configuration
   * @param {string} widgetPath - Path to widget directory
   * @param {boolean} autoRegister - Automatically register with ComponentManager
   */
  registerWidget(widgetName, config, widgetPath, autoRegister = true) {
    const widgetEntry = {
      ...config,
      name: widgetName,
      path: widgetPath,
      registeredAt: new Date().toISOString(),
    };

    // Persist scope from manifest/config if available
    if (config.scope) {
      widgetEntry.scope = config.scope;
    }

    // Store canonical package ID for update matching
    widgetEntry.packageId = widgetName;

    // Derive displayName from authoritative sources instead of trusting dash.json
    if (config.widgets?.length > 0) {
      const pkgNames = [
        ...new Set(config.widgets.map((w) => w.package).filter(Boolean)),
      ];
      if (pkgNames.length === 1) {
        widgetEntry.displayName = pkgNames[0];
      }
    }
    if (!widgetEntry.displayName || widgetEntry.displayName === config.name) {
      const bare = widgetName.replace(/^@[^/]+\//, "");
      widgetEntry.displayName = bare
        .split("-")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
    }

    this.widgets.set(widgetName, widgetEntry);
    this.saveRegistry();
    console.log(`[WidgetRegistry] Registered widget: ${widgetName}`);
  }

  /**
   * Load all components for a widget and register them with ComponentManager
   * @param {string} widgetName - Name of the widget
   * @param {string} widgetPath - Path to widget directory
   */
  async loadWidgetComponents(widgetName, widgetPath) {
    try {
      // Auto-compile widget source to CJS bundle if none exists
      if (!findBundlePath(widgetPath)) {
        try {
          await compileWidget(widgetPath);
          console.log(`[WidgetRegistry] Auto-compiled ${widgetName}`);
        } catch (compileError) {
          console.warn(
            `[WidgetRegistry] Could not compile ${widgetName}:`,
            compileError,
          );
        }
      }

      if (this.componentManager) {
        dynamicWidgetLoader.setComponentManager(this.componentManager);
      }

      const components = dynamicWidgetLoader.discoverWidgets(widgetPath);
      console.log(
        `[WidgetRegistry] Found ${components.length} components in ${widgetName}`,
      );

      const existingEntry = this.widgets.get(widgetName);
      let registryUpdated = false;

      // Store component names as displayName on the registry entry
      // so settings UI shows "WeatherWidget" instead of "weather-widget"
      if (components.length > 0 && existingEntry) {
        if (!existingEntry.displayName) {
          existingEntry.displayName = components.join(", ");
        }
        existingEntry.componentNames = components;
        registryUpdated = true;
      }

      for (const componentName of components) {
        try {
          const result = await dynamicWidgetLoader.loadWidget(
            widgetName,
            widgetPath,
            componentName,
            true,
          );
          console.log(`[WidgetRegistry] ✓ Loaded ${componentName}`);

          // Enrich registry entry with .dash.js config fields
          // (icon, providers, workspace, etc.) so the settings UI
          // has full display data without needing ComponentManager.
          if (result?.config && existingEntry) {
            const cfg = result.config;
            if (cfg.scope && !existingEntry.scope)
              existingEntry.scope = cfg.scope;
            if (cfg.icon && !existingEntry.icon) existingEntry.icon = cfg.icon;
            if (cfg.providers?.length && !existingEntry.providers?.length)
              existingEntry.providers = cfg.providers;
            if (cfg.workspace && !existingEntry.workspace)
              existingEntry.workspace = cfg.workspace;
            if (cfg.events?.length && !existingEntry.events?.length)
              existingEntry.events = cfg.events;
            if (
              cfg.eventHandlers?.length &&
              !existingEntry.eventHandlers?.length
            )
              existingEntry.eventHandlers = cfg.eventHandlers;
            registryUpdated = true;
          }
        } catch (error) {
          console.error(
            `[WidgetRegistry] Error loading component ${componentName}:`,
            error,
          );
        }
      }

      if (registryUpdated && existingEntry) {
        this.widgets.set(widgetName, existingEntry);
        this.saveRegistry();
      }
    } catch (error) {
      console.error("[WidgetRegistry] Error loading widget components:", error);
    }
  }

  /**
   * Get all registered widgets
   * @returns {Array} List of widget configurations
   */
  getWidgets() {
    return Array.from(this.widgets.values());
  }

  /**
   * Get widget by name
   * @param {string} widgetName - Name of the widget
   * @returns {Object|null} Widget configuration or null
   */
  getWidget(widgetName) {
    return this.widgets.get(widgetName) || null;
  }

  /**
   * Uninstall a widget
   * @param {string} widgetName - Name of the widget to remove
   */
  uninstallWidget(widgetName) {
    let widget = this.widgets.get(widgetName);

    // Fallback: widget not in registry but might exist on disk
    if (!widget) {
      const candidatePath = path.join(
        WIDGETS_CACHE_DIR,
        ...widgetName.split("/"),
      );
      if (fs.existsSync(candidatePath)) {
        widget = { path: candidatePath };
        console.log(
          `[WidgetRegistry] Widget ${widgetName} not in registry, removing from disk`,
        );
      } else {
        console.warn(`[WidgetRegistry] Widget not found: ${widgetName}`);
        return false;
      }
    }

    try {
      if (fs.existsSync(widget.path)) {
        fs.rmSync(widget.path, { recursive: true });
      }

      // Clean up empty scope directory (e.g. widgets/@trops/ after removing @trops/slack)
      const { scope } = parsePackageId(widgetName);
      if (scope) {
        const scopeDir = path.join(WIDGETS_CACHE_DIR, `@${scope}`);
        if (fs.existsSync(scopeDir) && fs.readdirSync(scopeDir).length === 0) {
          fs.rmdirSync(scopeDir);
        }
      }

      this.widgets.delete(widgetName);
      this.saveRegistry();
      console.log(`[WidgetRegistry] Uninstalled widget: ${widgetName}`);
      return true;
    } catch (error) {
      console.error(
        `[WidgetRegistry] Error uninstalling ${widgetName}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Helper: Fetch JSON from URL
   */
  async fetchJSON(url) {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Failed to fetch: ${response.statusText}`);
    return response.json();
  }

  /**
   * Get cache directory path
   */
  getCachePath() {
    return WIDGETS_CACHE_DIR;
  }

  /**
   * Get the storage directory (parent of widgets directory)
   * @returns {string} Full path to storage directory
   */
  getStoragePath() {
    return path.dirname(WIDGETS_CACHE_DIR);
  }
}

// Lazy initialization to avoid accessing app.getPath before app is ready
let widgetRegistry = null;

function getWidgetRegistry() {
  if (!widgetRegistry) {
    widgetRegistry = new WidgetRegistry();
  }
  return widgetRegistry;
}

/**
 * Look for a CJS bundle file in a widget directory.
 * Checks multiple candidate paths in priority order because
 * packageZip.js may extract dist/ contents to the widget root.
 *
 * @param {string} widgetPath - Path to the widget directory
 * @returns {string|null} Absolute path to the bundle, or null if not found
 */
function findBundlePath(widgetPath) {
  const candidates = [
    path.join(widgetPath, "dist", "index.cjs.js"),
    path.join(widgetPath, "index.cjs.js"),
    path.join(widgetPath, "dist", "index.js"),
    path.join(widgetPath, "index.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      // Skip ESM files — the eval pipeline requires CJS
      if (candidate.endsWith(".js") && !candidate.endsWith(".cjs.js")) {
        try {
          const head = fs.readFileSync(candidate, "utf8").slice(0, 256);
          if (/^\s*(import\s|export\s)/m.test(head)) {
            console.log(`[WidgetRegistry] Skipping ESM bundle: ${candidate}`);
            continue;
          }
        } catch (_) {
          // Non-fatal — allow fallthrough
        }
      }
      return candidate;
    }
  }

  return null;
}

/**
 * If a freshly-installed widget declares dash.permissions.mcp, ping the
 * renderer so the consent modal can pop up. The renderer subscribes via
 * `widget:mcp-consent-required` and either calls widget-mcp:set-grant
 * with the user's selections (Slice 2) or quietly drops the message
 * (older renderer pre-Slice-2 — the gate still fail-closes).
 *
 * Fallback: if there's no manifest, run the literal-only scanner on the
 * installed source. If the scan finds any literal MCP usage, emit the
 * same event with `discovered: true` and a synthetic declared blob —
 * the consent modal renders this with amber framing so the user knows
 * they're approving a guess, not the developer's declaration. If the
 * scan finds nothing, no event fires; the widget appears in
 * Settings → Privacy & Security with a "Grant manually" button.
 *
 * Cache invalidation: widgetPermissions caches per-process, so an upgrade
 * over a stale cached entry would otherwise keep the old manifest. Drop
 * the whole cache here — cheap, infrequent.
 */
function maybeEmitMcpConsentRequired(widgetName) {
  try {
    clearWidgetPermsCache();
    const declared = getWidgetMcpPermissions(widgetName);
    if (declared) {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("widget:mcp-consent-required", {
          widgetId: widgetName,
          declared,
        });
      });
      return;
    }

    // No manifest — try a scan of the installed source.
    if (!WIDGETS_CACHE_DIR) return;
    const widgetPath = path.join(WIDGETS_CACHE_DIR, ...widgetName.split("/"));
    if (!fs.existsSync(widgetPath)) return;
    const scanResult = scanForMcpUsage({ dir: widgetPath });
    const detectedServers = Object.keys(scanResult.servers);
    if (detectedServers.length === 0) return; // nothing actionable to prompt about

    // Build a synthetic declared blob in the same shape parseManifestPermissions
    // produces so the consent modal can render it identically (modulo the
    // amber "discovered" framing).
    const syntheticServers = {};
    for (const [name, entry] of Object.entries(scanResult.servers)) {
      syntheticServers[name] = {
        tools: entry.tools,
        readPaths: [],
        writePaths: [],
      };
    }
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("widget:mcp-consent-required", {
        widgetId: widgetName,
        declared: { servers: syntheticServers },
        discovered: true,
        warnings: scanResult.warnings,
      });
    });
  } catch (e) {
    console.warn(
      "[widgetRegistry] mcp consent emit failed for " +
        widgetName +
        ": " +
        e.message,
    );
  }
}

/**
 * Setup IPC handlers for widget management (use in main.js)
 */
function setupWidgetRegistryHandlers() {
  ipcMain.handle("widget:list", () => getWidgetRegistry().getWidgets());

  ipcMain.handle("widget:get", (event, widgetName) => {
    return getWidgetRegistry().getWidget(widgetName);
  });

  ipcMain.handle(
    "widget:install",
    async (event, widgetName, downloadUrl, dashConfigUrl) => {
      const config = await getWidgetRegistry().downloadWidget(
        widgetName,
        downloadUrl,
        dashConfigUrl,
      );

      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("widget:installed", {
          widgetName,
          config,
        });
      });

      maybeEmitMcpConsentRequired(widgetName);

      return config;
    },
  );

  ipcMain.handle(
    "widget:install-local",
    async (event, widgetName, localPath, dashConfigPath) => {
      const config = await getWidgetRegistry().installFromLocalPath(
        widgetName,
        localPath,
        true,
        dashConfigPath,
      );

      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("widget:installed", {
          widgetName,
          config,
        });
      });

      maybeEmitMcpConsentRequired(widgetName);

      return config;
    },
  );

  ipcMain.handle("widget:load-folder", async (event, folderPath) => {
    const results = await getWidgetRegistry().registerWidgetsFromFolder(
      folderPath,
      true,
    );

    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("widgets:loaded", {
        count: results.length,
        widgets: results,
      });
    });

    return results;
  });

  ipcMain.handle("widget:uninstall", (event, widgetName) => {
    const schedulerController = require("./controller/schedulerController");
    schedulerController.cleanupWidget(widgetName);
    const success = getWidgetRegistry().uninstallWidget(widgetName);
    if (success) {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("widget:uninstalled", { widgetName });
      });
    }
    return success;
  });

  ipcMain.handle("widget:cache-path", () => getWidgetRegistry().getCachePath());

  ipcMain.handle("widget:storage-path", () =>
    getWidgetRegistry().getStoragePath(),
  );

  ipcMain.handle("widget:get-component-configs", async () => {
    try {
      const registry = getWidgetRegistry();
      const installedWidgets = registry.getWidgets();
      const configs = [];

      for (const widget of installedWidgets) {
        const widgetPath = widget.path;
        if (!widgetPath || !fs.existsSync(widgetPath)) continue;

        const componentNames = dynamicWidgetLoader.discoverWidgets(widgetPath);
        const widgetsDir = findWidgetsDir(widgetPath);
        for (const componentName of componentNames) {
          try {
            const configPath = path.join(
              widgetsDir || path.join(widgetPath, "widgets"),
              `${componentName}.dash.js`,
            );
            const config = await dynamicWidgetLoader.loadConfigFile(configPath);
            configs.push({
              componentName,
              widgetPackage: widget.name,
              // Include scoped id if present in the config
              id: config.id || null,
              config,
            });
          } catch (err) {
            console.error(
              `[WidgetRegistry] Error loading config for ${componentName}:`,
              err,
            );
          }
        }
      }

      return configs;
    } catch (error) {
      console.error("[WidgetRegistry] Error getting component configs:", error);
      return [];
    }
  });

  ipcMain.handle("widget:read-bundle", async (event, widgetName) => {
    try {
      const registry = getWidgetRegistry();
      const widget = registry.getWidget(widgetName);
      if (!widget || !widget.path) {
        return {
          success: false,
          error: `Widget not found: ${widgetName}`,
        };
      }

      let bundlePath = findBundlePath(widget.path);

      // Auto-compile if no bundle exists (registry installs ship the
      // bundle pre-compiled, so this fallback only fires for older
      // packages or local installs).
      let compileError = null;
      if (!bundlePath) {
        try {
          const compiled = await compileWidget(widget.path);
          if (compiled) {
            bundlePath = compiled;
          }
        } catch (err) {
          compileError = err;
          // dash-core's electron build strips console.* — surface
          // the actual cause through the IPC return so the renderer
          // can show it to the user.
        }
      }

      if (!bundlePath) {
        const detail = compileError
          ? ` (auto-compile failed: ${compileError.message})`
          : "";
        return {
          success: false,
          error: `No bundle found in: ${widget.path}${detail}`,
        };
      }

      const source = fs.readFileSync(bundlePath, "utf8");
      return { success: true, source, widgetName };
    } catch (error) {
      console.error(
        `[WidgetRegistry] Error reading bundle for ${widgetName}:`,
        error,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "widget:read-sources",
    async (event, { widgetName, componentName }) => {
      try {
        const registry = getWidgetRegistry();
        const widget = registry.getWidget(widgetName);
        if (!widget || !widget.path) {
          return {
            success: false,
            error: `Widget not found: ${widgetName}`,
          };
        }

        const widgetsDir = findWidgetsDir(widget.path);
        if (!widgetsDir) {
          return {
            success: false,
            error: `No source files found for: ${widgetName}`,
          };
        }

        // Find target component (use componentName or first .dash.js file).
        // Strip scope prefix from scoped IDs like "trops.algolia.AlgoliaSearchWidget"
        // since the file on disk is just "AlgoliaSearchWidget.js".
        const files = fs.readdirSync(widgetsDir);
        let target = componentName;
        if (target && target.includes(".")) {
          const bare = target.split(".").pop();
          if (
            files.some((f) => f === `${bare}.js` || f === `${bare}.dash.js`)
          ) {
            target = bare;
          }
        }
        if (!target) {
          target = files
            .find((f) => f.endsWith(".dash.js"))
            ?.replace(".dash.js", "");
        }

        if (!target) {
          return {
            success: false,
            error: `No widget component found in: ${widgetsDir}`,
          };
        }

        const componentPath = path.join(widgetsDir, `${target}.js`);
        const configPath = path.join(widgetsDir, `${target}.dash.js`);

        if (!fs.existsSync(componentPath)) {
          return {
            success: false,
            error: `Component source not found: ${target}.js`,
          };
        }

        const componentCode = fs.readFileSync(componentPath, "utf8");
        const configCode = fs.existsSync(configPath)
          ? fs.readFileSync(configPath, "utf8")
          : "";

        // Read manifest
        const manifestPath = path.join(widget.path, "dash.json");
        let manifest = null;
        if (fs.existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          } catch (_) {
            /* ignore parse errors */
          }
        }

        return {
          success: true,
          componentCode,
          configCode,
          manifest,
          widgetName,
          componentName: target,
        };
      } catch (error) {
        console.error(
          `[WidgetRegistry] Error reading sources for ${widgetName}:`,
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("widget:read-all-bundles", async () => {
    try {
      const registry = getWidgetRegistry();
      const installedWidgets = registry.getWidgets();
      const results = [];

      for (const widget of installedWidgets) {
        const widgetPath = widget.path;
        if (!widgetPath || !fs.existsSync(widgetPath)) continue;

        let bundlePath = findBundlePath(widgetPath);

        // Auto-compile if no bundle exists
        if (!bundlePath) {
          try {
            const compiled = await compileWidget(widgetPath);
            if (compiled) {
              bundlePath = compiled;
            }
          } catch (compileError) {
            console.warn(
              `[WidgetRegistry] Could not compile ${widget.name}:`,
              compileError,
            );
          }
        }

        if (!bundlePath) {
          console.log(
            `[WidgetRegistry] No CJS bundle for ${widget.name}, skipping (will use config fallback)`,
          );
          continue;
        }

        try {
          const source = fs.readFileSync(bundlePath, "utf8");
          results.push({
            widgetName: widget.name,
            source,
          });
        } catch (readError) {
          console.error(
            `[WidgetRegistry] Error reading bundle for ${widget.name}:`,
            readError,
          );
        }
      }

      return results;
    } catch (error) {
      console.error("[WidgetRegistry] Error reading all bundles:", error);
      return [];
    }
  });

  ipcMain.handle("widget:set-storage-path", (event, customPath) => {
    try {
      WidgetRegistry.initialize(customPath);
      console.log(`[WidgetRegistry] Storage path changed to: ${customPath}`);
      return { success: true, path: customPath };
    } catch (error) {
      console.error("[WidgetRegistry] Error setting storage path:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = WidgetRegistry;
module.exports.getWidgetRegistry = getWidgetRegistry;
// For backward compatibility, provide widgetRegistry as a getter
Object.defineProperty(module.exports, "widgetRegistry", {
  get: getWidgetRegistry,
});
module.exports.setupWidgetRegistryHandlers = setupWidgetRegistryHandlers;
module.exports.validateZipEntries = validateZipEntries;
