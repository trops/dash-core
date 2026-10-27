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
const {
  registryDownloadFetch,
  downloadRefusal,
} = require("./registryDownload");
const {
  getWidgetMcpPermissions,
  clearCache: clearWidgetPermsCache,
} = require("./mcp/widgetPermissions");
const { scanForMcpUsage } = require("./utils/manifestScanner");
const {
  loadWidgetManifest,
  walkSourceContainment,
} = require("./utils/widgetManifest");

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

// The app's install gate: async (stagedDir, { widgetName }) →
// { ok, problems: [string] }. Every install runs it on the staged package
// before the installed one is touched (consolidation Phase 1a). null = no
// gate (tests, hosts without checks).
let installGate = null;
function setInstallGate(gate) {
  installGate = typeof gate === "function" ? gate : null;
}

function checksFailed(widgetName, problems, done = "installed") {
  const list = problems.map((p) => `- ${p}`).join("\n");
  const err = new Error(
    `${widgetName} wasn't ${done} — it didn't pass its checks:\n${list}`,
  );
  err.code = "WIDGET_CHECKS_FAILED";
  err.problems = problems;
  return err;
}

/**
 * Widgets may not start bots directly — only by events the user wires a
 * bot to (TD-005). The whole package is scanned, bundle included.
 * → [problem] or null.
 */
function botCallProblems(dir) {
  const { scanWidgetBotCalls } = require("./utils/scanWidgetBotCalls");
  // Dash's build of a folder loaded in place is the code that runs too.
  const built = buildDirFor(dir);
  const files = [dir, ...(built && fs.existsSync(built) ? [built] : [])]
    .map((d) => scanWidgetBotCalls(d))
    .flatMap((res) => (res.ok ? [] : res.files));
  if (!files.length) return null;
  return [
    `It starts your bots directly (${files.slice(0, 3).join(", ")}). Widgets may only send events that you wire a bot to, under the bot's "Run on events".`,
  ];
}

/**
 * The app's gate → { problems (null when it passes, or there's no gate),
 * sourceChecked (false when it found no source to check; undefined
 * without a gate) }.
 */
async function runGate(widgetName, dir) {
  if (!installGate) return { problems: null, sourceChecked: undefined };
  const verdict = (await installGate(dir, { widgetName })) || {};
  // No source beside a shipped build: Dash couldn't check its code.
  const sourceChecked =
    verdict.sourceFiles === 0 && findBundlePath(dir) ? false : true;
  if (verdict.ok) return { problems: null, sourceChecked };
  return {
    problems:
      Array.isArray(verdict.problems) && verdict.problems.length
        ? verdict.problems.map(String)
        : ["The checks couldn't run."],
    sourceChecked,
  };
}

/**
 * Where Dash builds a package. In its own widgets folder: the package's
 * dist/. A folder the user loaded in place: Dash's widget-builds/ (one
 * folder per path) — never a dist/ written into the user's folder.
 * → the build folder, or null for the package's own dist/.
 */
function buildDirFor(dir) {
  if (!WIDGETS_CACHE_DIR || !dir || isInsideWidgetsDir(dir)) return null;
  const key = require("crypto")
    .createHash("sha256")
    .update(path.resolve(dir))
    .digest("hex")
    .slice(0, 16);
  return path.join(path.dirname(WIDGETS_CACHE_DIR), "widget-builds", key);
}

// Marks a build Dash made (.dash-build beside it): it's rebuilt from the
// current source each time, unlike a developer's own build. An older Dash
// built in-place folders into their dist/ — that one counts too.
const DASH_BUILD_MARK = ".dash-build";

/** The developer's own build in the package folder (unmarked), or null. */
function developerBundle(dir) {
  const bundle = folderBundle(dir);
  if (!bundle) return null;
  return fs.existsSync(path.join(dir, "dist", DASH_BUILD_MARK)) ? null : bundle;
}

function builtByDash(dir) {
  // A build the developer made since wins: it's kept, not rebuilt.
  if (developerBundle(dir)) return false;
  // Everything in widget-builds/ is Dash's.
  const built = buildDirFor(dir);
  return (
    (built &&
      (fs.existsSync(path.join(built, "index.cjs.js")) ||
        fs.existsSync(path.join(built, DASH_BUILD_MARK)))) ||
    fs.existsSync(path.join(dir, "dist", DASH_BUILD_MARK))
  );
}

/**
 * A fingerprint of a package's files — every path with its size and date,
 * nothing read (package.json and dash.json aside: the app writes to them).
 * The startup check re-checks a package only when this changes.
 */
const NOT_FINGERPRINTED = new Set(["package.json", "dash.json"]);
function codeFingerprint(dir) {
  const hash = require("crypto").createHash("sha256");
  const add = (abs, rel) => {
    let names;
    try {
      names = fs.readdirSync(abs, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        add(path.join(abs, e.name), childRel);
      } else if (!(rel === "" && NOT_FINGERPRINTED.has(e.name))) {
        try {
          const st = fs.statSync(path.join(abs, e.name));
          hash.update(`${childRel}|${st.size}|${st.mtimeMs}\n`);
        } catch (_e) {
          // vanished mid-walk — the next start sees the change
        }
      }
    }
  };
  add(dir, "");
  return hash.digest("hex").slice(0, 32);
}

/** What an install records: who built the code that runs, and its checks. */
function checkRecord(dir, { build, sourceChecked, rebuildError }) {
  const checks = {
    ok: true,
    problems: [],
    checkedAt: new Date().toISOString(),
    fingerprint: codeFingerprint(dir),
  };
  if (sourceChecked !== undefined) checks.sourceChecked = sourceChecked;
  if (rebuildError) checks.rebuildError = rebuildError;
  return { build, checks };
}

/**
 * A package's checks, run where it sits: no direct bot calls, it builds
 * when it ships no bundle (the build is kept), and it passes the app's
 * gate. Throws a plain-language error when it doesn't. Returns who built
 * the code that runs: "dash" when it was built here from the checked
 * source, "developer" when the package ships its own build (Dash checked
 * its source, not its build — consolidation Phase 1a-2).
 *
 * rebuild (registry installs, Phase 1a-3): a package that ships its own
 * build is built here too, from the checked source with its own listed
 * libraries; if that fails its developer's build is kept and the reason
 * returned as rebuildError.
 */
async function checkPackage(
  widgetName,
  dir,
  done = "installed",
  { rebuild = false } = {},
) {
  const botCalls = botCallProblems(dir);
  if (botCalls) throw checksFailed(widgetName, botCalls, done);

  // A package that ships no build is built here, and so is one whose
  // build Dash made (a folder loaded again after its source changed) — a
  // developer's own build is kept (it may bundle its own libraries).
  let build = "developer";
  let rebuildError = null;
  const markDashBuild = () => {
    try {
      const out = buildDirFor(dir) || path.join(dir, "dist");
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, DASH_BUILD_MARK), "");
    } catch (_e) {
      // unmarked: it's kept like a developer's build next time
    }
  };
  if (!findBundlePath(dir) || builtByDash(dir)) {
    let compiled;
    try {
      compiled = await compileWidget(dir, { outDir: buildDirFor(dir) });
    } catch (e) {
      throw checksFailed(
        widgetName,
        [(e && e.message) || "The widget didn't build."],
        done,
      );
    }
    if (compiled) markDashBuild();
    build = "dash";
  } else if (rebuild) {
    // Only with the libraries it lists, never the app's copies: a
    // package that uses libraries without listing them keeps its
    // developer's build until it's republished.
    const { listedLibraries } = require("./widgetLibraries");
    const { findLibraryImports } = require("./utils/libraryImports");
    const imports = listedLibraries(dir) ? [] : findLibraryImports(dir);
    if (imports.length) {
      rebuildError = `It doesn't list the libraries it uses (${imports.join(", ")}).`;
    } else {
      try {
        if (
          await compileWidget(dir, {
            ownLibrariesOnly: true,
            outDir: buildDirFor(dir),
          })
        ) {
          markDashBuild();
          build = "dash";
        }
      } catch (e) {
        rebuildError = (e && e.message) || "It didn't build here.";
      }
    }
  }

  const { problems, sourceChecked } = await runGate(widgetName, dir);
  if (problems) throw checksFailed(widgetName, problems, done);
  return rebuildError
    ? { build, sourceChecked, rebuildError }
    : { build, sourceChecked };
}

/**
 * The startup check of an installed package: the same checks, nothing
 * built or thrown → { ok, problems }.
 */
async function reviewPackage(widgetName, dir) {
  const botCalls = botCallProblems(dir);
  if (botCalls) return { ok: false, problems: botCalls };
  try {
    const { problems, sourceChecked } = await runGate(widgetName, dir);
    const result = problems
      ? { ok: false, problems }
      : { ok: true, problems: [] };
    if (sourceChecked !== undefined) result.sourceChecked = sourceChecked;
    return result;
  } catch (e) {
    return {
      ok: false,
      problems: [`The checks couldn't run: ${(e && e.message) || e}`],
    };
  }
}

/**
 * Put a package in place only after it passes: `fill(dir)` writes it into
 * a staging folder, where checkPackage runs. Only then does it replace the
 * installed folder — a refusal leaves the installed version as it was. The
 * old folder is moved aside first and put back if the new one can't be
 * moved in, so a failure never leaves nothing installed.
 * → what the install records (checkRecord).
 */
async function stageInstall(widgetName, widgetPath, fill, options = {}) {
  const stagingRoot = path.join(WIDGETS_CACHE_DIR, ".staging");
  fs.mkdirSync(stagingRoot, { recursive: true });
  const staged = fs.mkdtempSync(path.join(stagingRoot, "pkg-"));
  const aside = `${staged}-old`;
  try {
    await fill(staged);
    const record = checkRecord(
      staged,
      await checkPackage(widgetName, staged, "installed", options),
    );

    fs.mkdirSync(path.dirname(widgetPath), { recursive: true });
    const hadOld = fs.existsSync(widgetPath);
    if (hadOld) fs.renameSync(widgetPath, aside);
    try {
      fs.renameSync(staged, widgetPath);
    } catch (e) {
      if (hadOld) fs.renameSync(aside, widgetPath);
      throw e;
    }
    return record;
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(aside, { recursive: true, force: true });
  }
}

/** A widget draft (Widget Builder) — not an installed widget. */
function isDraftFolder(pkgPath) {
  if (/[\\/]@ai-built[\\/]draft-[^\\/]+$/.test(pkgPath)) return true;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pkgPath, "package.json"), "utf8"),
    );
    return !!(pkg && pkg.dash && pkg.dash.draft);
  } catch (_e) {
    return false;
  }
}

/**
 * The names a package gives itself, most specific first: dash.json's
 * scope + name, package.json's name (what publishing uses), then
 * dash.json's name. Reads a folder's files or a ZIP's.
 */
function packageOwnNames(resolvedPath) {
  let read;
  if (resolvedPath.endsWith(".zip")) {
    const zip = new AdmZip(resolvedPath);
    read = (file) => {
      try {
        const entry = zip.getEntry(file);
        return entry ? JSON.parse(entry.getData().toString("utf8")) : null;
      } catch (_e) {
        return null;
      }
    };
  } else {
    read = (file) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(resolvedPath, file), "utf8"),
        );
      } catch (_e) {
        return null;
      }
    };
  }
  const dash = read("dash.json") || {};
  const pkg = read("package.json") || {};
  const names = [];
  if (dash.scope && dash.name && !String(dash.name).startsWith("@")) {
    names.push(`@${String(dash.scope).replace(/^@/, "")}/${dash.name}`);
  }
  names.push(pkg.name, dash.name);
  return names.filter((n) => typeof n === "string" && n.trim());
}

const NAME_PART = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * The id a local package installs under (QA 2026-10-22: a folder's name made
 * an unscoped id that could never be placed on a dashboard). A scoped name
 * stays; an unscoped one goes under the signed-in user's registry name, or
 * @local when signed out. A file can't claim the AI-built scope (the user's
 * own, never checked as drafts): its name goes under the user's scope too.
 * Null for a name that isn't one (dots, spaces).
 */
function scopedLocalId(name, username = null) {
  const m = String(name || "")
    .trim()
    .toLowerCase()
    .match(/^(?:@([^/]+)\/)?([^/]+)$/);
  if (!m || !NAME_PART.test(m[2])) return null;
  const [, scope, bare] = m;
  if (scope && scope !== "ai-built" && NAME_PART.test(scope)) {
    return `@${scope}/${bare}`;
  }
  const user =
    typeof username === "string"
      ? username.trim().toLowerCase().replace(/^@/, "")
      : "";
  return `@${NAME_PART.test(user) ? user : "local"}/${bare}`;
}

/**
 * The id a local package installs under when none is given: its own name
 * (packageOwnNames), else the file's or folder's name — scoped either way
 * (scopedLocalId).
 */
function localPackageName(resolvedPath, username = null) {
  const base = path.basename(resolvedPath).replace(/\.zip$/i, "");
  const names = [...packageOwnNames(resolvedPath), base];
  // A real scope the package gives itself anywhere (dash.json or
  // package.json) wins over an unscoped name. One that isn't a name
  // ("@My Org/x", "@../x") doesn't count: the user's scope applies.
  for (const name of names) {
    const m = String(name)
      .trim()
      .toLowerCase()
      .match(/^@([^/]+)\/[^/]+$/);
    if (m && m[1] !== "ai-built" && NAME_PART.test(m[1])) {
      const id = scopedLocalId(name);
      if (id) return id;
    }
  }
  for (const name of names) {
    const id = scopedLocalId(name, username);
    if (id) return id;
  }
  throw new Error(`Can't tell what ${path.basename(resolvedPath)} is called.`);
}

// Test-only override of the signed-in username (null = signed out).
let scopeUsernameForTest;

/**
 * The registry username a local package's unscoped name goes under: the
 * one remembered at the last profile read, else a quick profile read when
 * signed in; null when signed out or the registry doesn't answer in time.
 */
async function localScopeUsername() {
  if (scopeUsernameForTest !== undefined) return scopeUsernameForTest;
  try {
    const auth = require("./controller/registryAuthController");
    if (!auth.getStoredToken()) return null;
    const cached = auth.getStoredUsername();
    if (cached) return cached;
    const profile = await Promise.race([
      auth.getRegistryProfile(),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return (profile && profile.username) || null;
  } catch {
    return null;
  }
}

// True only for a path strictly inside the widgets folder, links resolved,
// so a widget loaded from the user's folder (or a link to it) is never
// deleted with it.
function isInsideWidgetsDir(target) {
  try {
    const root = fs.realpathSync(WIDGETS_CACHE_DIR);
    const rel = path.relative(root, fs.realpathSync(target));
    return (
      rel !== "" &&
      rel !== ".." &&
      !rel.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(rel)
    );
  } catch {
    return false;
  }
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

    // Slice 13f: clean up bare-name folders whose package.json declares
    // a scoped name (legacy install artifact). Without this, the
    // `reconcileWithDisk` orphan loop below re-registers them under
    // the bare folder name and ComponentManager later crashes with
    // "missing origin metadata" trying to derive a 3-segment id from
    // a scope-less entry. Runs BEFORE reconcile so the registry's
    // re-register pass sees a canonical layout.
    try {
      const { dedupeWidgetFolders } = require("./utils/dedupeWidgetFolders");
      const dedup = dedupeWidgetFolders(WIDGETS_CACHE_DIR);
      if (dedup.removed.length > 0 || dedup.migrated.length > 0) {
        console.log(
          `[WidgetRegistry] Folder dedupe: removed ${dedup.removed.length}, migrated ${dedup.migrated.length}`,
        );
        // Drop any registry entry that pointed at a now-removed bare
        // folder, so reconcileWithDisk re-registers from the canonical
        // scoped path on its next pass.
        const removedSet = new Set(dedup.removed);
        for (const [key, entry] of Array.from(this.widgets.entries())) {
          if (entry?.path && removedSet.has(entry.path)) {
            this.widgets.delete(key);
          }
        }
      }
      if (dedup.errors.length > 0) {
        console.warn(`[WidgetRegistry] Folder dedupe errors:`, dedup.errors);
      }
    } catch (e) {
      console.warn("[WidgetRegistry] Folder dedupe failed:", e.message);
    }

    // Reconcile: re-register orphaned widget packages found on disk
    this.reconcileWithDisk();

    // Slice 13b: backfill `dash.permissions.mcp` for any registered
    // widget that was installed before the publish/install scanner
    // hooks existed (or that has since updated tools without
    // re-publishing). Additive merge — idempotent across boots.
    try {
      const {
        backfillPackagePermissions,
      } = require("./utils/scanWidgetPackagePermissions");
      const paths = Array.from(this.widgets.values())
        .map((w) => w.path)
        .filter(Boolean);
      const summary = backfillPackagePermissions(paths);
      if (summary.modified > 0) {
        console.log(
          `[WidgetRegistry] Backfilled MCP permissions for ${summary.modified}/${summary.scanned} widget(s)`,
        );
      }
      if (summary.errors.length) {
        console.warn(`[WidgetRegistry] MCP backfill errors:`, summary.errors);
      }
    } catch (e) {
      console.warn(
        "[WidgetRegistry] MCP permissions backfill failed:",
        e.message,
      );
    }
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
        } else if (
          entry.name !== "registry.json" &&
          !entry.name.startsWith(".")
        ) {
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
    // A package found on disk is registered only after it passes its
    // checks (checkInstalled, consolidation Phase 1a-2). Drafts aren't
    // installed widgets: they're registered as before and never checked.
    if (!isDraftFolder(pkgPath)) {
      this.pendingOrphans = this.pendingOrphans || new Map();
      this.pendingOrphans.set(pkgId, pkgPath);
      return;
    }
    this._registerOrphanEntry(pkgId, pkgPath);
  }

  _registerOrphanEntry(pkgId, pkgPath, extra = {}) {
    console.log(`[WidgetRegistry] Re-registering orphaned widget: ${pkgId}`);
    const { scope } = parsePackageId(pkgId);
    const entry = {
      name: pkgId,
      packageId: pkgId,
      scope: scope || null,
      path: pkgPath,
      version: null,
      orphaned: true,
      ...extra,
    };
    enrichEntryFromDisk(entry, pkgPath);
    this.widgets.set(pkgId, entry);
  }

  /**
   * Check every installed package once, and again whenever its code
   * changes (consolidation Phase 1a-2). A package that fails is flagged
   * with its reasons (entry.checks) and keeps working; a package found on
   * disk that isn't registered is registered only if it passes. Drafts
   * aren't checked. The host MUST call this after setInstallGate:
   * packages found on disk are registered only here. Returns the names
   * it registered, so the host can tell the screen.
   * → { checked, failed, registered, refused }
   */
  async checkInstalled() {
    const summary = { checked: [], failed: [], registered: [], refused: [] };
    let changed = false;
    for (const [name, entry] of Array.from(this.widgets.entries())) {
      if (!entry || !entry.path || !fs.existsSync(entry.path)) continue;
      if (isDraftFolder(entry.path)) continue;
      const fingerprint = codeFingerprint(entry.path);
      if (!entry.build) {
        // Recorded before builds were: AI-built packages are built here;
        // a package with no build (a dashboard package) has none.
        entry.build = !findBundlePath(entry.path)
          ? "none"
          : name.startsWith("@ai-built/")
            ? "dash"
            : "developer";
        changed = true;
      }
      if (entry.checks && entry.checks.fingerprint === fingerprint) continue;
      const result = await reviewPackage(name, entry.path);
      entry.checks = {
        ...result,
        checkedAt: new Date().toISOString(),
        fingerprint,
      };
      changed = true;
      summary.checked.push(name);
      if (!result.ok) {
        summary.failed.push(name);
        console.warn(
          `[WidgetRegistry] ${name} didn't pass its checks (it still works):\n${result.problems
            .map((p) => `- ${p}`)
            .join("\n")}`,
        );
      }
    }
    for (const [pkgId, pkgPath] of Array.from(
      (this.pendingOrphans || new Map()).entries(),
    )) {
      this.pendingOrphans.delete(pkgId);
      if (this.widgets.has(pkgId) || !fs.existsSync(pkgPath)) continue;
      const result = await reviewPackage(pkgId, pkgPath);
      if (!result.ok) {
        summary.refused.push(pkgId);
        console.warn(
          `[WidgetRegistry] ${pkgId} was found in the widgets folder but wasn't loaded — it didn't pass its checks:\n${result.problems
            .map((p) => `- ${p}`)
            .join("\n")}`,
        );
        continue;
      }
      this._registerOrphanEntry(pkgId, pkgPath, {
        build: pkgId.startsWith("@ai-built/") ? "dash" : "developer",
        checks: {
          ...result,
          checkedAt: new Date().toISOString(),
          fingerprint: codeFingerprint(pkgPath),
        },
      });
      summary.registered.push(pkgId);
      changed = true;
    }
    if (changed) this.saveRegistry();
    return summary;
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
   * What a local ZIP or folder would be installed as, and whether a
   * package by that name is installed already — the screen asks before
   * replacing one (consolidation Phase 1a-2).
   * @returns {{ name: string, installed: boolean }}
   */
  async inspectLocalPath(localPath) {
    const resolvedPath = this.resolveLocalPath(localPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Local path not found: ${resolvedPath}`);
    }
    const name = localPackageName(resolvedPath, await localScopeUsername());
    return { name, installed: this.widgets.has(name) };
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

      // No name given (Install a widget from file, Load a widget folder):
      // the package's own, then the file's, scoped (scopedLocalId).
      if (!widgetName) {
        widgetName = localPackageName(resolvedPath, await localScopeUsername());
      }

      // Scoped names (e.g. "@trops/slack") get nested dirs: widgets/@trops/slack/
      const widgetPath = path.join(WIDGETS_CACHE_DIR, ...widgetName.split("/"));

      const isDirectory = fs.statSync(resolvedPath).isDirectory();
      if (!isDirectory && !resolvedPath.endsWith(".zip")) {
        throw new Error(`Unsupported local source type: ${resolvedPath}`);
      }
      if (isDirectory) {
        // Phase 5B (P1 #11): require a structured manifest + reject
        // symlink-escape sources. The ZIP path is already covered by
        // validateZipEntries below. The lax env switch is for devs
        // pointing at half-built widget folders during local testing.
        const lax = process.env.DASH_LOCAL_INSTALL_LAX === "true";
        if (!lax) {
          walkSourceContainment(resolvedPath);
          const m = loadWidgetManifest(resolvedPath);
          if (!m.ok) {
            throw new Error(
              `Widget folder rejected: ${m.error}. Set DASH_LOCAL_INSTALL_LAX=true to bypass for local dev (not for production).`,
            );
          }
          for (const w of m.warnings) {
            console.warn(w);
          }
        }
      }
      const record = await stageInstall(widgetName, widgetPath, (staged) => {
        if (isDirectory) {
          fs.cpSync(resolvedPath, staged, { recursive: true });
        } else {
          const zip = new AdmZip(resolvedPath);
          validateZipEntries(zip, staged);
          zip.extractAllTo(staged, true);
        }
      });

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

      this.registerWidget(
        widgetName,
        // A copy of the user's folder: Uninstall says the folder stays.
        {
          ...config,
          ...record,
          // Where the code came from — a profile save checks whether the
          // registry has this exact code (dash-profiles PR 4).
          installSource: "local",
          ...(isDirectory ? { copiedFromFolder: true } : {}),
        },
        widgetPath,
        false,
      );

      if (autoRegister) {
        await this.loadWidgetComponents(widgetName, widgetPath);
      }

      return { ...config, installedAs: widgetName };
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

      // 1. Check if the selected folder itself is a widget: installed (a
      //    copy) under the package's own, scoped name — not the folder's.
      if (this.isWidgetFolder(resolvedPath)) {
        const config = await this.installFromLocalPath(
          null,
          resolvedPath,
          autoRegister,
        );
        const widgetName = config.installedAs;
        // An older version installed it under the folder's bare name, which
        // could never be placed on a dashboard: that copy goes (Dash's own
        // copy only — uninstallWidget never deletes outside its folder).
        const oldName = path.basename(resolvedPath);
        if (
          oldName !== widgetName &&
          !oldName.includes("/") &&
          this.widgets.has(oldName)
        ) {
          this.uninstallWidget(oldName);
        }
        return [
          {
            path: resolvedPath,
            ...config,
            name: widgetName,
            mode: "single",
          },
        ];
      }

      const username = await localScopeUsername();
      // id → the folder that took it, in this load.
      const seenIds = new Map();

      // 2. Iterate subdirectories with filtering
      const entries = fs.readdirSync(resolvedPath, {
        withFileTypes: true,
      });
      const results = [];
      let skipped = 0;
      const refused = [];
      const refusedReasons = {};

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

        // Its id: the package's own name, scoped — not the folder's name.
        let id;
        try {
          id = localPackageName(widgetPath, username);
        } catch (e) {
          refused.push(entry.name);
          refusedReasons[entry.name] = e.message;
          skipped++;
          continue;
        }
        if (seenIds.has(id)) {
          refused.push(entry.name);
          refusedReasons[entry.name] =
            `${entry.name} wasn't loaded — its package is named ${id}, like ${seenIds.get(id)}. Give it its own name in dash.json.`;
          skipped++;
          continue;
        }
        seenIds.set(id, entry.name);

        // Loaded in place, so checked in place: bot calls (TD-005), the
        // build, the app's gate. A refusal is listed with its reason, under
        // the folder's name (the one the user picked from).
        let record;
        try {
          record = checkRecord(
            widgetPath,
            await checkPackage(entry.name, widgetPath, "loaded"),
          );
        } catch (e) {
          console.warn(`[WidgetRegistry] ${e.message}`);
          refused.push(entry.name);
          refusedReasons[entry.name] = e.message;
          skipped++;
          continue;
        }

        // An older version registered this folder under its bare name (it
        // could never be placed): forget that entry — nothing on disk, the
        // folder is the user's. Scoped entries stay (dashboards use them).
        for (const [key, w] of this.widgets) {
          if (
            key !== id &&
            !key.includes("/") &&
            w &&
            w.path &&
            path.resolve(w.path) === path.resolve(widgetPath)
          ) {
            this.widgets.delete(key);
          }
        }

        const config = await this.loadWidgetConfig(id, widgetPath);
        this.registerWidget(id, { ...config, ...record }, widgetPath, false);

        if (autoRegister) {
          await this.loadWidgetComponents(id, widgetPath);
        }

        results.push({
          path: widgetPath,
          ...config,
          name: id,
          installedAs: id,
        });
      }

      // Attach skipped count as metadata on the array
      results.skipped = skipped;
      results.refused = refused;
      results.refusedReasons = refusedReasons;
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

      // Registry download endpoints: signed in or not (public packages
      // download signed out), with this install's anonymous ID.
      const registryBase =
        process.env.DASH_REGISTRY_API_URL ||
        "https://main.d919rwhuzp7rj.amplifyapp.com";
      const fromRegistry =
        downloadUrl.includes(registryBase) ||
        downloadUrl.includes("/api/packages/");

      let response;
      let expired = false;
      try {
        if (fromRegistry) {
          ({ response, expired } = await registryDownloadFetch(downloadUrl));
        } else {
          response = await fetch(downloadUrl);
        }
      } catch (fetchErr) {
        throw new Error(
          "Could not reach the download server. Check your connection and try again.",
        );
      }
      if (!response.ok) {
        const refusal = fromRegistry
          ? downloadRefusal(response, { expired })
          : null;
        if (refusal) throw new Error(refusal.error);
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

      // Registry download endpoints return JSON with a pre-signed
      // S3 URL plus, since Phase 1A, signing metadata: zipSignature,
      // publisherCert, publisherKeyId, publisherFingerprint.
      let signingMeta = null;
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

        // Phase 5D (P1 #24): verify the manifest signature BEFORE
        // trusting any field in this response. A MITM that swapped
        // downloadUrl or any signing-metadata field gets caught here
        // because the signature won't verify against the bundled
        // registry root key. Mode is shared with the existing
        // zip+cert verifier — DASH_REGISTRY_VERIFY_SIGNED_INSTALL.
        const {
          verifyDownloadManifest,
        } = require("./security/verifyRegistryInstall");
        const manifestVerify = await verifyDownloadManifest({
          responseBody: jsonData,
        });
        if (!manifestVerify.verified && manifestVerify.mode === "warn") {
          console.warn(
            `[widgetRegistry] Installing with unverified download manifest ` +
              `for "${widgetName}" — reason: ${manifestVerify.reason}. Set ` +
              `DASH_REGISTRY_VERIFY_SIGNED_INSTALL=strict to refuse.`,
          );
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
        signingMeta = {
          zipSignature: jsonData.zipSignature || null,
          publisherCert: jsonData.publisherCert || null,
          publisherKeyId: jsonData.publisherKeyId || null,
          publisherFingerprint: jsonData.publisherFingerprint || null,
        };
      }

      // Phase 1C: verify signature + cert + revocation before
      // touching the ZIP. In `off` mode this is a no-op; in `warn`
      // (default during rollout) failures log + proceed; in `strict`
      // failures throw and the package never reaches AdmZip.
      const {
        verifyDownloadedPackage,
      } = require("./security/verifyRegistryInstall");
      const verifyResult = await verifyDownloadedPackage({
        zipBuffer: buffer,
        zipSignature: signingMeta ? signingMeta.zipSignature : null,
        publisherCert: signingMeta ? signingMeta.publisherCert : null,
        publisherKeyId: signingMeta ? signingMeta.publisherKeyId : null,
        publisherFingerprint: signingMeta
          ? signingMeta.publisherFingerprint
          : null,
      });
      if (!verifyResult.verified && verifyResult.mode === "warn") {
        console.warn(
          `[widgetRegistry] Installing unverified package "${widgetName}" — ` +
            `reason: ${verifyResult.reason}. Set ` +
            `DASH_REGISTRY_VERIFY_SIGNED_INSTALL=strict to refuse.`,
        );
      }

      const zip = new AdmZip(buffer);

      // Scoped names (e.g. "@trops/slack") get nested dirs: widgets/@trops/slack/
      const widgetPath = path.join(WIDGETS_CACHE_DIR, ...widgetName.split("/"));

      // A registry package is built here from its checked source, with
      // its own listed libraries (consolidation Phase 1a-3).
      const record = await stageInstall(
        widgetName,
        widgetPath,
        (staged) => {
          validateZipEntries(zip, staged);
          zip.extractAllTo(staged, true);
        },
        { rebuild: true },
      );
      console.log(`[WidgetRegistry] Extracted widget to: ${widgetPath}`);

      // Same scan as installFromLocalPath: record which MCP tools the
      // package calls in its package.json (dash.permissions.mcp). Without
      // it a registry install has no declared permissions until the next
      // app start (boot backfill), so the consent prompt and the
      // permission dialog's wildcard offer have nothing to go on.
      try {
        const {
          applyScanToPackageJson,
        } = require("./utils/scanWidgetPackagePermissions");
        applyScanToPackageJson(widgetPath);
      } catch (e) {
        console.warn(
          `[WidgetRegistry] Permission scan failed for ${widgetName}: ${e.message}`,
        );
      }

      let config = await this.loadWidgetConfig(widgetName, widgetPath);

      if (dashConfigUrl) {
        const dashConfig = await this.fetchJSON(dashConfigUrl);
        config = { ...config, ...dashConfig };
      }

      this.registerWidget(
        widgetName,
        {
          ...config,
          ...record,
          installSource: fromRegistry ? "registry" : "url",
        },
        widgetPath,
        false,
      );

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
          await compileWidget(widgetPath, {
            outDir: buildDirFor(widgetPath),
          });
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
   * The widgets for the app's lists: each marked `loadedInPlace` when it
   * runs from the user's own folder (a folder of widgets loads in place),
   * so Uninstall can say the folder stays.
   * @returns {Array}
   */
  listWidgets() {
    return this.getWidgets().map((w) => ({
      ...w,
      loadedInPlace:
        !!(w && w.path) && fs.existsSync(w.path) && !isInsideWidgetsDir(w.path),
    }));
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
   * Record where an installed widget's code now comes from — "registry"
   * once this exact code has been published (dash-profiles PR 4b), so a
   * profile save references it instead of copying it into the file.
   */
  markInstallSource(widgetName, installSource, version = null) {
    const w = this.widgets.get(widgetName);
    if (!w) return false;
    this.widgets.set(widgetName, {
      ...w,
      installSource,
      ...(version ? { version } : {}),
    });
    this.saveRegistry();
    return true;
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
      // Dash's build of a folder loaded in place (worked out while the
      // path is still there to check).
      const built = widget.path ? buildDirFor(widget.path) : null;
      // A folder of widgets loads in place, so its path is the user's own
      // folder: forget the widget, never delete files outside Dash's own.
      if (fs.existsSync(widget.path) && isInsideWidgetsDir(widget.path)) {
        fs.rmSync(widget.path, { recursive: true });
      }
      // Its build goes; the folder stays.
      if (built && fs.existsSync(built)) {
        fs.rmSync(built, { recursive: true, force: true });
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

/**
 * An installed widget's sources: component code, .dash.js config and
 * manifest. Used by the renderer (widget:read-sources) and by the Dash
 * team's read_widget tool (create-entry CRE-011).
 * @returns {Promise<{ success, componentCode?, configCode?, manifest?,
 *   widgetName?, componentName?, error? }>}
 */
// A package's own source files, for the Dash team to read (a change to a
// widget, consolidation Phase 3): code, styles and data — never what it
// installed (node_modules) or built (dist).
const SOURCE_FILE = /\.(js|jsx|ts|tsx|css|json|md)$/i;
const NOT_SOURCE = new Set(["node_modules", "dist", ".git"]);
const MAX_PACKAGE_FILES = 60;

/** Its source files, relative to the package ("widgets/Inbox.js"). */
function packageFiles(root) {
  const out = [];
  const walk = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_PACKAGE_FILES) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!NOT_SOURCE.has(e.name)) walk(path.join(dir, e.name), r);
      } else if (e.isFile() && SOURCE_FILE.test(e.name)) {
        out.push(r);
      }
    }
  };
  walk(root, "");
  return out;
}

/**
 * One source file of an installed package — only one packageFiles lists
 * (never outside the package). → { success, file, content } | { error }
 */
async function readWidgetFile({ widgetName, file } = {}) {
  try {
    const widget = getWidgetRegistry().getWidget(widgetName);
    if (!widget || !widget.path) {
      return { success: false, error: `Widget not found: ${widgetName}` };
    }
    const want = String(file || "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");
    if (!packageFiles(widget.path).includes(want)) {
      return {
        success: false,
        error: `${widgetName} has no source file "${file}".`,
      };
    }
    return {
      success: true,
      file: want,
      content: fs.readFileSync(path.join(widget.path, want), "utf8"),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function readWidgetSources({ widgetName, componentName } = {}) {
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
      if (files.some((f) => f === `${bare}.js` || f === `${bare}.dash.js`)) {
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
      // The package's other source files, by path (Phase 3).
      files: packageFiles(widget.path),
    };
  } catch (error) {
    console.error(
      `[WidgetRegistry] Error reading sources for ${widgetName}:`,
      error,
    );
    return { success: false, error: error.message };
  }
}

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
  // The developer's own build first; then Dash's build of a folder loaded
  // in place; then a build an older Dash left in the folder's dist/.
  const own = developerBundle(widgetPath);
  if (own) return own;
  const built = buildDirFor(widgetPath);
  if (built && fs.existsSync(path.join(built, "index.cjs.js"))) {
    return path.join(built, "index.cjs.js");
  }
  return folderBundle(widgetPath);
}

/** A bundle in the package folder itself (dist/ or its root), or null. */
function folderBundle(widgetPath) {
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
  ipcMain.handle("widget:list", () => getWidgetRegistry().listWidgets());

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

  ipcMain.handle("widget:inspect-local", (event, localPath) =>
    getWidgetRegistry().inspectLocalPath(localPath),
  );

  ipcMain.handle(
    "widget:install-local",
    async (event, requestedName, localPath, dashConfigPath) => {
      const config = await getWidgetRegistry().installFromLocalPath(
        requestedName,
        localPath,
        true,
        dashConfigPath,
      );
      const widgetName = config.installedAs || requestedName;

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
        widgets: [...results],
      });
    });

    // A plain object: IPC copies an array without its extra properties,
    // so the skipped count and the refusals (with why) wouldn't arrive.
    return {
      widgets: [...results],
      skipped: results.skipped || 0,
      refused: results.refused || [],
      refusedReasons: results.refusedReasons || {},
    };
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
          const compiled = await compileWidget(widget.path, {
            outDir: buildDirFor(widget.path),
          });
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

  ipcMain.handle("widget:read-sources", async (event, args) =>
    readWidgetSources(args || {}),
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
            const compiled = await compileWidget(widgetPath, {
              outDir: buildDirFor(widgetPath),
            });
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
module.exports.readWidgetSources = readWidgetSources;
module.exports.readWidgetFile = readWidgetFile;
module.exports.packageFiles = packageFiles;
// For backward compatibility, provide widgetRegistry as a getter
Object.defineProperty(module.exports, "widgetRegistry", {
  get: getWidgetRegistry,
});
module.exports.setupWidgetRegistryHandlers = setupWidgetRegistryHandlers;
module.exports.validateZipEntries = validateZipEntries;
module.exports.setInstallGate = setInstallGate;
module.exports.checkPackage = checkPackage;
module.exports.findBundlePath = findBundlePath;
module.exports.isInsideWidgetsDir = isInsideWidgetsDir;
module.exports.scopedLocalId = scopedLocalId;
module.exports.localPackageName = localPackageName;
// Test-only: the signed-in username local packages go under (null = signed
// out; undefined = back to the registry's).
module.exports._setScopeUsernameForTest = (name) => {
  scopeUsernameForTest = name;
};
