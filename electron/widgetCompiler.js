/**
 * Widget Compiler
 *
 * Compiles raw widget source files (.js + .dash.js) into a single CJS bundle
 * using esbuild. The output bundle is consumable by the existing
 * widgetBundleLoader.js eval pipeline (new Function() + require shim).
 *
 * Runs in the Electron main process at widget install time.
 */

const fs = require("fs");
const path = require("path");

// Provided by the host app via MODULE_MAP in widgetBundleLoader.js — never
// bundled (utils/libraryImports.js).
const {
  HOST_PROVIDED,
  isHostProvided,
  packageNameOf,
} = require("./utils/libraryImports");

/**
 * Every node_modules folder above `dir`, nearest first — where Node would
 * look from a file there. A package built in a temp folder (the Widget
 * Builder's) has none of its own; these are the app's libraries, so a
 * registry package's npm imports (algoliasearch, mustache, …) still
 * resolve when it is rebuilt.
 */
function hostLibraryPaths(dir = __dirname) {
  const out = [];
  let at = path.resolve(dir);
  for (;;) {
    if (path.basename(at) !== "node_modules") {
      const candidate = path.join(at, "node_modules");
      if (fs.existsSync(candidate)) out.push(candidate);
    }
    const up = path.dirname(at);
    if (up === at) break;
    at = up;
  }
  return out;
}

/** Copy a folder with plain reads and writes (works out of an asar). */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dest);
    else fs.writeFileSync(dest, fs.readFileSync(src));
  }
}

/**
 * A packaged app's libraries sit inside app.asar, which Electron can read
 * and esbuild (a native binary) can't. Copy the library an import names
 * into `toDir` (once) so esbuild finds it there. → whether it's there.
 */
function mirrorLibrary(spec, fromPaths, toDir) {
  const name = packageNameOf(spec);
  const dest = path.join(toDir, ...name.split("/"));
  if (fs.existsSync(dest)) return true;
  for (const from of fromPaths) {
    const src = path.join(from, ...name.split("/"));
    if (fs.existsSync(src)) {
      copyDir(src, dest);
      return true;
    }
  }
  return false;
}

/**
 * Where to look for npm libraries: every node_modules above `dir`, then
 * the app's own (`appPath`/node_modules) — dash-core may be linked from
 * elsewhere in development, so its location alone isn't enough.
 */
function libraryPaths(dir = __dirname, appPath = appFolder()) {
  const paths = hostLibraryPaths(dir);
  // At and above the app folder (Electron may be started from a
  // subfolder, e.g. public/electron.js).
  for (const own of appPath ? hostLibraryPaths(appPath) : []) {
    if (!paths.includes(own)) paths.push(own);
  }
  return paths;
}

/** The running app's folder (app.asar when packaged), or null. */
function appFolder() {
  try {
    return require("electron").app.getAppPath() || null;
  } catch (_e) {
    return null;
  }
}

/**
 * Where esbuild looks for npm libraries, and the esbuild plugin that
 * mirrors them out of an asar when the app is packaged.
 */
function libraryResolution(dir = __dirname) {
  const paths = libraryPaths(dir);
  const inAsar = paths.filter((p) => p.includes(`.asar${path.sep}`));
  if (!inAsar.length) return { nodePaths: paths, plugins: [] };
  let cache;
  try {
    const { app } = require("electron");
    cache = path.join(
      app.getPath("userData"),
      "widget-build-libraries",
      app.getVersion(),
      "node_modules",
    );
  } catch (_e) {
    cache = path.join(
      require("os").tmpdir(),
      "dash-widget-build-libraries",
      "node_modules",
    );
  }
  fs.mkdirSync(cache, { recursive: true });
  return {
    nodePaths: [cache, ...paths.filter((p) => !inAsar.includes(p))],
    plugins: [
      {
        name: "dash-app-libraries",
        setup(build) {
          build.onResolve({ filter: /^[^./]/ }, (args) => {
            if (!isHostProvided(args.path)) {
              mirrorLibrary(args.path, inAsar, cache);
            }
            return undefined; // esbuild resolves it, now from the cache
          });
        },
      },
    ],
  };
}

/** A file in esbuild's error, short: "widgets/A.js", else its name. */
function shortFile(file) {
  const f = String(file || "")
    .split(path.sep)
    .join("/");
  return f.includes("/widgets/")
    ? `widgets/${f.split("/widgets/").pop()}`
    : f.startsWith("widgets/")
      ? f
      : path.basename(f);
}

/**
 * esbuild's errors as sentences: a library the app doesn't have, a file
 * the package doesn't have, else "file:line: message".
 */
function friendlyCompileError(error) {
  const errors = Array.isArray(error && error.errors) ? error.errors : [];
  if (!errors.length) return (error && error.message) || String(error);
  const lines = errors.map((e) => {
    const loc = e.location || {};
    const missing = /^Could not resolve "(.+)"/.exec(e.text || "");
    if (missing && /^[./]/.test(missing[1])) {
      return `${path.basename(String(loc.file || "a file"))} imports "${missing[1]}", which isn't in the package.`;
    }
    if (missing) {
      return `This widget needs the library "${packageNameOf(missing[1])}", which this app doesn't include.`;
    }
    const where = loc.file
      ? `${shortFile(loc.file)}${loc.line ? `:${loc.line}` : ""}: `
      : "";
    return `${where}${e.text}`;
  });
  const unique = lines.filter((l, i) => lines.indexOf(l) === i);
  return `The widget didn't build:\n${unique.map((l) => `- ${l}`).join("\n")}`;
}

/**
 * Structured error thrown by compileWidget() when the underlying
 * esbuild spawn fails (typically ENOENT — the native helper binary is
 * missing on this arch in a packaged build). The renderer surfaces
 * `.code` + `.diagnostics` to give the user something actionable
 * instead of a raw "spawn ENOENT".
 */
class WidgetCompileError extends Error {
  constructor(message, code, diagnostics) {
    super(message);
    this.name = "WidgetCompileError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

/**
 * Probe the on-disk state of esbuild + its arch-specific native helper.
 * Returns a flat object suitable for logging/UI display. Never throws.
 */
function getEsbuildDiagnostics() {
  const diagnostics = {
    platform: process.platform,
    arch: process.arch,
    esbuildVersion: null,
    esbuildPackageDir: null,
    archPackage: `@esbuild/${process.platform}-${process.arch}`,
    nativeBinaryPath: null,
    nativeBinaryExists: false,
  };

  try {
    const pkgJsonPath = require.resolve("esbuild/package.json");
    diagnostics.esbuildPackageDir = path.dirname(pkgJsonPath);
    diagnostics.esbuildVersion = require(pkgJsonPath).version;
  } catch (err) {
    diagnostics.esbuildResolveError = err.message;
  }

  try {
    const archPkgJson = require.resolve(
      `${diagnostics.archPackage}/package.json`,
    );
    const archDir = path.dirname(archPkgJson);
    // esbuild's native binary on macOS/Linux is bin/esbuild;
    // on Windows it's esbuild.exe at the package root.
    const candidate =
      process.platform === "win32"
        ? path.join(archDir, "esbuild.exe")
        : path.join(archDir, "bin", "esbuild");
    diagnostics.nativeBinaryPath = candidate;
    diagnostics.nativeBinaryExists = fs.existsSync(candidate);
  } catch (err) {
    diagnostics.archResolveError = err.message;
  }

  return diagnostics;
}

/**
 * Quick liveness probe for the widget compiler. Runs a no-op
 * `esbuild.transform("")` so any missing-native-binary failure surfaces
 * before the user tries to compile a real widget. Returns
 * `{ ok, error?, code?, diagnostics }` — never throws.
 */
async function healthCheck() {
  const diagnostics = getEsbuildDiagnostics();
  try {
    const esbuild = require("esbuild");
    await esbuild.transform("", { loader: "js" });
    return { ok: true, diagnostics };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      code:
        err.code === "ENOENT" || /spawn|ENOENT/i.test(err.message || "")
          ? "ESBUILD_SPAWN_FAILED"
          : "ESBUILD_UNAVAILABLE",
      diagnostics,
    };
  }
}

/**
 * Find the widgets/ directory, handling nested ZIP extraction.
 *
 * ZIP extraction can create a nested structure like:
 *   Weather/weather-widget/widgets/  instead of  Weather/widgets/
 *
 * If widgets/ doesn't exist at root, check one level deeper for a
 * single subdirectory that contains widgets/.
 *
 * @param {string} widgetPath - Absolute path to the widget directory
 * @returns {string|null} Path to the widgets/ directory, or null
 */
function findWidgetsDir(widgetPath) {
  const direct = path.join(widgetPath, "widgets");
  if (fs.existsSync(direct)) {
    return direct;
  }

  // Check configs/widgets/ (packageZip.js nests .dash.js files here)
  const configsWidgets = path.join(widgetPath, "configs", "widgets");
  if (fs.existsSync(configsWidgets)) {
    return configsWidgets;
  }

  // Check configs/ directory (used by packageZip.js for distributed widgets)
  const configs = path.join(widgetPath, "configs");
  if (fs.existsSync(configs)) {
    return configs;
  }

  // Check one level deeper for nested ZIP extraction
  try {
    const entries = fs.readdirSync(widgetPath, { withFileTypes: true });
    const subdirs = entries.filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        e.name !== "dist" &&
        e.name !== "node_modules",
    );

    for (const subdir of subdirs) {
      const nested = path.join(widgetPath, subdir.name, "widgets");
      if (fs.existsSync(nested)) {
        console.log(`[WidgetCompiler] Found nested widgets/ at ${nested}`);
        return nested;
      }
    }
  } catch (err) {
    // Non-fatal — fall through to null
  }

  return null;
}

/**
 * Compile widget source files into a CJS bundle at dist/index.cjs.js.
 *
 * For each {Name}.dash.js found in the widgets/ directory, a synthetic
 * entry point is generated that imports the component + config and
 * re-exports them as `{ ...config, component }` — matching what
 * extractWidgetConfigs() in widgetBundleLoader.js expects.
 *
 * @param {string} widgetPath - Absolute path to the widget directory
 * @param {{ ownLibrariesOnly?: boolean }} [options] - build only with the
 *   package's listed libraries, never the app's (registry rebuilds)
 * @returns {Promise<string|null>} Path to the compiled bundle, or null if nothing to compile
 */
/**
 * outDir: where the build goes (default <widgetPath>/dist). A folder the
 * user loaded in place is built into Dash's own folder instead, so nothing
 * is written into theirs — the build's entry file goes there too.
 */
async function compileWidget(
  widgetPath,
  { ownLibrariesOnly = false, outDir = null } = {},
) {
  const widgetsDir = findWidgetsDir(widgetPath);

  if (!widgetsDir) {
    console.log(
      `[WidgetCompiler] No widgets/ directory in ${widgetPath}, skipping`,
    );
    return null;
  }

  // Discover .dash.js config files
  const files = fs.readdirSync(widgetsDir);
  const dashFiles = files.filter((f) => f.endsWith(".dash.js"));

  if (dashFiles.length === 0) {
    console.log(
      `[WidgetCompiler] No .dash.js files found in ${widgetsDir}, skipping`,
    );
    return null;
  }

  // Build a synthetic entry point that pairs each component with its config.
  // Compute relative path from the entry file (in widgetPath) to widgetsDir,
  // since widgetsDir may be nested (e.g., ./weather-widget/widgets/).
  // Built elsewhere (outDir), the entry imports the sources by full path.
  const relWidgetsDir = outDir
    ? path.resolve(widgetsDir).split(path.sep).join("/")
    : "./" + path.relative(widgetPath, widgetsDir).split(path.sep).join("/");
  const imports = [];
  const exportParts = [];

  for (const dashFile of dashFiles) {
    const componentName = dashFile.replace(".dash.js", "");
    const componentFile = `${componentName}.js`;
    const componentFilePath = path.join(widgetsDir, componentFile);
    const hasComponent = fs.existsSync(componentFilePath);

    // Import the config (always)
    imports.push(
      `import ${componentName}Config from ${JSON.stringify(`${relWidgetsDir}/${dashFile}`)};`,
    );

    if (hasComponent) {
      // Import the component and merge with config.
      // Use namespace import so both default and named exports work:
      //   export default function Foo → _Mod.default
      //   export const Foo = ...      → _Mod.Foo
      imports.push(
        `import * as ${componentName}_Mod from ${JSON.stringify(`${relWidgetsDir}/${componentFile}`)};`,
      );
      imports.push(
        `const ${componentName}Comp = ${componentName}_Mod.default || ${componentName}_Mod.${componentName} || Object.values(${componentName}_Mod).find(v => typeof v === 'function');`,
      );
      exportParts.push(
        `export const ${componentName} = { ...${componentName}Config, component: ${componentName}Comp };`,
      );
    } else {
      // Config-only (no component source file)
      exportParts.push(
        `export const ${componentName} = ${componentName}Config;`,
      );
    }
  }

  const entryContent = [...imports, "", ...exportParts, ""].join("\n");

  // Write temporary entry file in the widget root (or beside the build)
  const distDir = outDir || path.join(widgetPath, "dist");
  const entryPath = path.join(outDir || widgetPath, "__compile_entry.js");
  const outPath = path.join(distDir, "index.cjs.js");
  // The package's own libraries (package.json dependencies), downloaded
  // into a temp folder for this build (consolidation Phase 1a-3).
  let own = null;

  try {
    // Ensure dist/ directory exists
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    fs.writeFileSync(entryPath, entryContent, "utf8");

    console.log(
      `[WidgetCompiler] Compiling ${dashFiles.length} component(s) from ${widgetPath}`,
    );

    // Lazy-require esbuild so the module doesn't fail to load if
    // esbuild is not yet installed (e.g., during first npm install)
    const esbuild = require("esbuild");
    // npm libraries the package imports come from the app's own
    // libraries when the package has none of its own (a temp build).
    const libraries = libraryResolution();
    const { installLibraries, listedLibraries } = require("./widgetLibraries");
    const listed = listedLibraries(widgetPath);
    if (listed) own = await installLibraries(listed);

    await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: "cjs",
      outfile: outPath,
      // These modules are provided by the host app via MODULE_MAP
      // in widgetBundleLoader.js — do NOT bundle them
      external: HOST_PROVIDED,
      // The package's own libraries first, then the app's — or only its
      // own (ownLibrariesOnly: a registry rebuild, where another version
      // of a library could behave differently from the developer's build).
      nodePaths: own
        ? ownLibrariesOnly
          ? [own.nodeModules]
          : [own.nodeModules, ...libraries.nodePaths]
        : libraries.nodePaths,
      plugins: own && ownLibrariesOnly ? [] : libraries.plugins,
      // Treat .js files as JSX (widget sources use JSX in .js files)
      loader: { ".js": "jsx" },
      // Use automatic JSX runtime (React 17+) so sources don't need
      // explicit `import React from "react"`.
      jsx: "automatic",
      logLevel: "warning",
    });

    console.log(`[WidgetCompiler] Compiled successfully → ${outPath}`);
    return outPath;
  } catch (error) {
    console.error(
      `[WidgetCompiler] Compilation failed for ${widgetPath}:`,
      error,
    );
    // ENOENT on the esbuild path means the native helper binary
    // wasn't found — usually a packaging issue (wrong arch in the
    // universal asar, asar-unpacked glob missing the arch package,
    // dev install never ran for the runtime arch). Wrap with
    // diagnostics so the UI can show something useful.
    if (error.code === "ENOENT" || /spawn|ENOENT/i.test(error.message || "")) {
      throw new WidgetCompileError(
        `Widget compiler unavailable: ${error.message}`,
        "ESBUILD_SPAWN_FAILED",
        getEsbuildDiagnostics(),
      );
    }
    // Missing libraries and files named plainly (esbuild's own text
    // otherwise).
    if (Array.isArray(error && error.errors) && error.errors.length) {
      error.message = friendlyCompileError(error);
    }
    throw error;
  } finally {
    if (own) own.cleanup();
    // Clean up temporary entry file
    try {
      if (fs.existsSync(entryPath)) {
        fs.unlinkSync(entryPath);
      }
    } catch (cleanupError) {
      // Non-fatal
      console.warn(
        `[WidgetCompiler] Could not remove temp entry file:`,
        cleanupError,
      );
    }
  }
}

module.exports = {
  compileWidget,
  findWidgetsDir,
  healthCheck,
  getEsbuildDiagnostics,
  WidgetCompileError,
  hostLibraryPaths,
  libraryPaths,
  mirrorLibrary,
  friendlyCompileError,
};
