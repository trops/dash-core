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
const { findWidgetsDir, compileWidget } = require("../widgetCompiler");
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
 * Dedup duplicate `{type: "..."}` entries inside a `providers: [...]`
 * array literal in a .dash.js source string. Mirrors the regex used at
 * AI-build write time in dash-electron's WidgetBuilderModal so old
 * AI-generated widgets get healed before publish (the runtime parse
 * dedup keeps consumers correct, but the raw .dash.js text on disk
 * stays dirty unless we rewrite it).
 *
 * Conservative: only handles a single-level array of object literals.
 * More exotic forms fall through unchanged and the runtime dedup picks
 * up the slack.
 *
 * @param {string} source
 * @returns {{ source: string, dropped: number }}
 */
function dedupProvidersInDashSource(source) {
  if (!source) return { source, dropped: 0 };
  let totalDropped = 0;
  const cleaned = source.replace(
    /(providers\s*:\s*\[)([^[\]]*?)(\])/,
    (match, head, body, tail) => {
      const chunks = body
        .split(/(\{[^{}]*\})/)
        .filter((s) => s && /\S/.test(s));
      const seenTypes = new Set();
      const kept = [];
      let dropped = 0;
      for (const chunk of chunks) {
        if (!chunk.startsWith("{")) continue;
        const typeMatch = chunk.match(/type\s*:\s*["']([^"']+)["']/);
        if (!typeMatch) {
          kept.push(chunk.trim());
          continue;
        }
        const t = typeMatch[1];
        if (seenTypes.has(t)) {
          dropped++;
          continue;
        }
        seenTypes.add(t);
        kept.push(chunk.trim());
      }
      if (dropped === 0) return match;
      totalDropped += dropped;
      return `${head}${kept.join(", ")}${tail}`;
    },
  );
  return { source: cleaned, dropped: totalDropped };
}

/**
 * Walk a widget package's `.dash.js` files and rewrite any with
 * duplicate provider-type entries. Returns counts so the publish
 * caller can log what was healed. Errors are non-fatal — a single
 * unparseable .dash.js shouldn't block the whole publish.
 */
function cleanupProvidersInWidgetPackage(widgetPath) {
  const summary = { filesScanned: 0, filesRewritten: 0, totalDropped: 0 };
  try {
    const widgetsDir =
      findWidgetsDir(widgetPath) || path.join(widgetPath, "widgets");
    if (!fs.existsSync(widgetsDir)) return summary;
    for (const file of fs.readdirSync(widgetsDir)) {
      if (!file.endsWith(".dash.js")) continue;
      const filePath = path.join(widgetsDir, file);
      try {
        const original = fs.readFileSync(filePath, "utf8");
        summary.filesScanned++;
        const { source: deduped, dropped } =
          dedupProvidersInDashSource(original);
        if (dropped > 0 && deduped !== original) {
          fs.writeFileSync(filePath, deduped, "utf8");
          summary.filesRewritten++;
          summary.totalDropped += dropped;
          console.log(
            `[widgetRegistry] Cleaned ${dropped} duplicate provider(s) from ${file}`,
          );
        }
      } catch (err) {
        console.warn(
          `[widgetRegistry] cleanupProviders skip ${file}: ${err.message}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[widgetRegistry] cleanupProvidersInWidgetPackage failed:",
      err.message,
    );
  }
  return summary;
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

// ─── Publish-time defaults scan + staged rewrite ─────────────────────────────

/**
 * Scan a widget package's `.dash.js` files and return every non-empty
 * `userConfig[field].defaultValue` as a structured ref. Powers the
 * publish modal's "Verify defaults" step — surfaces values the
 * developer set during testing (regional paths, test tokens, etc.)
 * so the publisher can keep, blank, or edit each one before the ZIP
 * ships.
 *
 * @param {string} packageId e.g. "@ai-built/pipeline"
 * @returns {Promise<{success: boolean, defaults: Array, error?: string}>}
 */
async function scanWidgetDefaults(packageId) {
  try {
    const registry = widgetRegistryModule.getWidgetRegistry();
    const widget = findWidget(registry, packageId);
    if (!widget || !widget.path) {
      return {
        success: false,
        error: `Widget package not found locally: ${packageId}`,
      };
    }

    const configs = await scanWidgetConfigs(widget.path);
    const defaults = [];
    for (const cfg of configs) {
      const widgetName = cfg.component || cfg.name;
      if (!widgetName) continue;
      const userConfig = cfg.userConfig;
      if (!userConfig || typeof userConfig !== "object") continue;
      for (const [field, spec] of Object.entries(userConfig)) {
        if (!spec || typeof spec !== "object") continue;
        const value = spec.defaultValue;
        // "non-empty" = not nullish, not empty-string. `false` and `0`
        // are legitimate defaults (checkbox-off, numeric zero) so we
        // keep them. Arrays/objects only surface if non-empty.
        const isEmpty =
          value === null ||
          value === undefined ||
          value === "" ||
          (Array.isArray(value) && value.length === 0) ||
          (typeof value === "object" &&
            !Array.isArray(value) &&
            Object.keys(value).length === 0);
        if (isEmpty) continue;
        defaults.push({
          widgetName,
          field,
          currentDefault: value,
          displayName: spec.displayName || field,
          type: spec.type || "text",
          instructions: spec.instructions || "",
        });
      }
    }
    return { success: true, defaults };
  } catch (error) {
    console.error("[widgetRegistry] scanWidgetDefaults failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Return the exported-default object from a `.dash.js` serialized as
 * pretty-printed JS. We use JSON.stringify (plus a couple of minor
 * touch-ups) because dash configs are pure data — no functions, no
 * imports, no regex literals. The source file shape we emit matches
 * the scaffolded template so dynamicWidgetLoader reads it back
 * unchanged.
 */
function serializeDashConfig(config) {
  const json = JSON.stringify(config, null, 4);
  return `export default ${json};\n`;
}

/**
 * Copy a source widget directory into `dstDir`, then rewrite the
 * `userConfig[field].defaultValue` for every entry in `overrides`.
 * `overrides` shape: `{ [widgetName]: { [field]: newValue } }`.
 *
 * Returns the list of files that were actually rewritten (useful for
 * the UI / logs). Pure file-system side effect; does NOT touch the
 * original source directory.
 */
async function stageOverrides(srcDir, dstDir, overrides) {
  // Copy the whole package tree into dstDir.
  fs.cpSync(srcDir, dstDir, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (ZIP_EXCLUDE_DIRS.has(base)) return false;
      if (base.startsWith(".")) return false;
      return true;
    },
  });

  if (!overrides || Object.keys(overrides).length === 0) return [];

  const widgetsDir = findWidgetsDir(dstDir) || path.join(dstDir, "widgets");
  if (!fs.existsSync(widgetsDir)) return [];

  const rewritten = [];
  const files = fs.readdirSync(widgetsDir);
  for (const file of files) {
    if (!file.endsWith(".dash.js")) continue;
    const filePath = path.join(widgetsDir, file);
    let cfg;
    try {
      // eslint-disable-next-line no-await-in-loop
      cfg = await dynamicWidgetLoader.loadConfigFile(filePath);
    } catch (err) {
      console.warn(
        `[widgetRegistry] Could not load ${file} for override: ${err.message}`,
      );
      continue;
    }
    if (!cfg || typeof cfg !== "object") continue;
    const widgetName = cfg.component || cfg.name;
    if (!widgetName || !overrides[widgetName]) continue;
    const fieldOverrides = overrides[widgetName];

    if (!cfg.userConfig || typeof cfg.userConfig !== "object") continue;
    let changed = false;
    for (const [field, newValue] of Object.entries(fieldOverrides)) {
      if (!cfg.userConfig[field] || typeof cfg.userConfig[field] !== "object") {
        continue;
      }
      // Undefined = "no change" from the UI side. Explicit null / ""
      // = user wants to blank it out.
      if (newValue === undefined) continue;
      cfg.userConfig[field] = {
        ...cfg.userConfig[field],
        defaultValue: newValue,
      };
      changed = true;
    }
    if (!changed) continue;

    fs.writeFileSync(filePath, serializeDashConfig(cfg));
    rewritten.push(file);
  }
  return rewritten;
}

// ─── ZIP builder ─────────────────────────────────────────────────────────────

// `dist` is intentionally NOT excluded — the publish flow runs
// `compileWidget` against the staged package right before zipping so
// the installer doesn't have to recompile (and fail silently because
// `console.*` is stripped from dash-core's electron build, masking
// any esbuild error). Shipping the bundle makes install zero-config.
const ZIP_EXCLUDE_DIRS = new Set([
  "node_modules",
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

    // 5. Normalize dash.json's author field. The AI Widget Builder
    //    scaffolds new @ai-built/* widgets with `author: "AI Assistant"`
    //    as the placeholder, which ships unchanged to the registry and
    //    is what installers see under the package's author — regardless
    //    of who actually published it. If dash.json exists and its
    //    author is blank or that placeholder, rewrite with the
    //    publisher's registry display name (or username) before we zip
    //    the package. Any other user-set author is preserved.
    const authorOverride =
      (options.authorName && options.authorName.trim()) ||
      profile?.displayName ||
      profile?.username ||
      "";
    if (authorOverride && fs.existsSync(dashJsonPath)) {
      try {
        const dashJson = JSON.parse(fs.readFileSync(dashJsonPath, "utf8"));
        const current = (dashJson.author || "").trim();
        const isPlaceholder = !current || current === "AI Assistant";
        if (isPlaceholder && dashJson.author !== authorOverride) {
          dashJson.author = authorOverride;
          fs.writeFileSync(
            dashJsonPath,
            JSON.stringify(dashJson, null, 2) + "\n",
          );
        }
      } catch {
        // Best-effort only — a malformed dash.json will surface later
        // during manifest generation with a clearer error.
      }
    }

    // 5b. Heal `.dash.js` source files that have duplicate
    //     provider-type entries before we read configs / build the
    //     manifest / zip. AI-generated configs occasionally double a
    //     `{type:"..."}` entry; the runtime dedup makes it invisible
    //     on the publisher's machine, but we don't want the dirty raw
    //     text shipping to the registry. Mirrors the write-time dedup
    //     in dash-electron's WidgetBuilderModal so older widgets
    //     authored before that fix landed get cleaned at publish.
    const providerCleanupSummary = cleanupProvidersInWidgetPackage(widget.path);
    if (providerCleanupSummary.filesRewritten > 0) {
      console.log(
        `[widgetRegistry] Provider cleanup: rewrote ${providerCleanupSummary.filesRewritten} file(s), removed ${providerCleanupSummary.totalDropped} duplicate(s)`,
      );
    }

    // 6. Build manifest using the widget's component configs. The
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
      // Prefer the caller-supplied authorName; otherwise fall back to
      // the publisher's registry profile so the manifest author matches
      // the (now-rewritten) dash.json we just zipped.
      authorName: options.authorName || authorOverride || undefined,
      appOrigin: appId,
    });

    // 7. Zip the widget directory to a temp file. When the caller
    //    supplied `defaultsOverride`, stage a copy of the package
    //    under os.tmpdir() and rewrite the targeted
    //    `userConfig[field].defaultValue` entries there before
    //    zipping — source files on the publisher's machine stay
    //    untouched.
    const zipName = `widget-${manifest.scope}-${manifest.name}-v${manifest.version}.zip`;
    const zipPath = path.join(app.getPath("temp"), zipName);
    const hasOverrides =
      options.defaultsOverride &&
      typeof options.defaultsOverride === "object" &&
      Object.keys(options.defaultsOverride).length > 0;
    const stagedDir = hasOverrides
      ? fs.mkdtempSync(path.join(app.getPath("temp"), `dash-publish-stage-`))
      : null;
    let registryResult;
    try {
      let sourceDir = widget.path;
      if (stagedDir) {
        await stageOverrides(widget.path, stagedDir, options.defaultsOverride);
        sourceDir = stagedDir;
      }

      // Compile the widget into `dist/index.cjs.js` before zipping.
      // The installer also runs compileWidget at first-load, but
      // dash-core strips `console.*` from its electron bundle, so any
      // esbuild error during install-time compile vanishes silently
      // and the user just sees `No bundle found`. Compiling at
      // publish time (where errors WILL surface to the publisher who
      // can fix them) and shipping the bundle in the ZIP makes
      // install zero-config.
      try {
        await compileWidget(sourceDir);
      } catch (compileErr) {
        return {
          success: false,
          error: `Widget compilation failed: ${compileErr.message}. Fix the source error and republish; otherwise installers won't be able to load the widget.`,
          manifest,
        };
      }

      const zip = new AdmZip();
      addDirToZip(zip, sourceDir);
      zip.writeZip(zipPath);

      // 8. Publish to registry
      registryResult = await registryApiController.publishToRegistry(
        zipPath,
        manifest,
      );

      // 9. On failure: revert package.json (if we bumped) and surface details
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

      // Clean up the temp zip on success.
      try {
        fs.unlinkSync(zipPath);
      } catch {
        /* ignore */
      }
    } finally {
      if (stagedDir) {
        try {
          fs.rmSync(stagedDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
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
  scanWidgetDefaults,
};
