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
 * @returns {Promise<string|null>} Path to the compiled bundle, or null if nothing to compile
 */
async function compileWidget(widgetPath) {
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
  const relWidgetsDir =
    "./" + path.relative(widgetPath, widgetsDir).split(path.sep).join("/");
  const imports = [];
  const exportParts = [];

  for (const dashFile of dashFiles) {
    const componentName = dashFile.replace(".dash.js", "");
    const componentFile = `${componentName}.js`;
    const componentFilePath = path.join(widgetsDir, componentFile);
    const hasComponent = fs.existsSync(componentFilePath);

    // Import the config (always)
    imports.push(
      `import ${componentName}Config from "${relWidgetsDir}/${dashFile}";`,
    );

    if (hasComponent) {
      // Import the component and merge with config.
      // Use namespace import so both default and named exports work:
      //   export default function Foo → _Mod.default
      //   export const Foo = ...      → _Mod.Foo
      imports.push(
        `import * as ${componentName}_Mod from "${relWidgetsDir}/${componentFile}";`,
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

  // Write temporary entry file in the widget root
  const entryPath = path.join(widgetPath, "__compile_entry.js");
  const distDir = path.join(widgetPath, "dist");
  const outPath = path.join(distDir, "index.cjs.js");

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

    await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: "cjs",
      outfile: outPath,
      // These modules are provided by the host app via MODULE_MAP
      // in widgetBundleLoader.js — do NOT bundle them
      external: [
        "react",
        "react-dom",
        "@trops/dash-react",
        "@trops/dash-core",
        "react/jsx-runtime",
        "prop-types",
      ],
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
    throw error;
  } finally {
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
};
