#!/usr/bin/env node

/**
 * Widget Registry Integration Test
 *
 * End-to-end check of the widget loader and registry against real widget
 * packages on disk: discovery, loading, caching, config parsing, a ZIP
 * extract, ZIP installs through WidgetRegistry, loading a folder of widgets,
 * and a folder → ZIP → install round trip.
 *
 * Moved here from dash-electron (where it went stale when the modules moved
 * into dash-core). Every fixture is written to a temp folder at start and
 * the folder is removed at the end — nothing touches real app data.
 *
 * Usage:
 *   node scripts/testWidgetIntegration.cjs
 * Exits non-zero when any test fails.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const Module = require("module");
const AdmZip = require("adm-zip");

// Everything this run writes lives under one temp folder.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dash-widget-integration-"));
const STUB_USER_DATA = path.join(ROOT, "user-data");
fs.mkdirSync(STUB_USER_DATA, { recursive: true });

// Mock electron for WidgetRegistry tests (widgetRegistry.js requires electron
// at top level). Outside Electron, require("electron") is either missing
// (dash-core doesn't depend on it) or returns the binary path string, so we
// resolve it to a stub whose app paths point into the temp folder.
const ELECTRON_STUB_ID = "__dash_widget_integration_electron_stub__";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return ELECTRON_STUB_ID;
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache[ELECTRON_STUB_ID] = {
  id: ELECTRON_STUB_ID,
  filename: ELECTRON_STUB_ID,
  loaded: true,
  exports: {
    app: {
      getPath: () => STUB_USER_DATA,
      getAppPath: () => STUB_USER_DATA,
      getVersion: () => "0.0.0-test",
      isPackaged: false,
    },
    ipcMain: { handle: () => {}, on: () => {} },
    BrowserWindow: { getAllWindows: () => [] },
  },
};

const { dynamicWidgetLoader } = require("../electron/dynamicWidgetLoader.js");
const WidgetRegistry = require("../electron/widgetRegistry.js");

// The signed-in registry username local packages go under. Always set
// explicitly, so the run never reads the real user's sign-in.
WidgetRegistry._setScopeUsernameForTest(null);

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[36m";

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function log(message, color = RESET) {
  console.log(`${color}${message}${RESET}`);
}

// Awaits async tests, so a failing async assertion counts as a failure.
async function test(name, fn) {
  testsRun++;
  try {
    await fn();
    testsPassed++;
    log(`  ✓ ${name}`, GREEN);
  } catch (error) {
    testsFailed++;
    log(`  ✗ ${name}`, RED);
    log(`    Error: ${error.message}`, RED);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message || "Values differ"} (expected ${expected}, got ${actual})`,
    );
  }
}

function assertTrue(condition, message) {
  assert(condition, message || "Expected true");
}

// A test that depends on an earlier one fails (never silently passes) when
// that one didn't produce what it needs.
function requires(value, what) {
  if (!value) throw new Error(`Requires ${what} (an earlier test failed)`);
}

/**
 * Write a widget package: package.json, widgets/<Component>.js (importing a
 * nested sub-component, React and dash-react, like a real widget) and
 * widgets/<Component>.dash.js.
 */
function writeWidgetPackage(dir, { pkgName, componentName, displayName }) {
  fs.mkdirSync(path.join(dir, "widgets", "components"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: pkgName,
        version: "1.0.0",
        description: `${displayName} widget (integration test fixture)`,
        author: "Dash Team",
        main: `widgets/${componentName}.js`,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "widgets", "components", "Card.js"),
    [
      'import React from "react";',
      "export const Card = ({ title }) => <div>{title}</div>;",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "widgets", `${componentName}.js`),
    [
      'import React from "react";',
      'import { Panel } from "@trops/dash-react";',
      'import { Card } from "./components/Card";',
      `const ${componentName} = ({ title = "${displayName}", ...rest }) => (`,
      "  <Panel {...rest}>",
      "    <Card title={title} />",
      "  </Panel>",
      ");",
      `export default ${componentName};`,
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "widgets", `${componentName}.dash.js`),
    [
      `import ${componentName} from "./${componentName}";`,
      "export default {",
      `  name: "${componentName}",`,
      `  displayName: "${displayName}",`,
      `  description: "Shows ${displayName.toLowerCase()} (test fixture).",`,
      '  version: "1.0.0",',
      '  icon: "cloud-sun",',
      `  component: ${componentName},`,
      "  canHaveChildren: false,",
      '  type: "widget",',
      `  downloadUrl: "https://example.com/${pkgName}.zip",`,
      "  userConfig: {",
      "    title: {",
      '      type: "text",',
      `      defaultValue: "${displayName}",`,
      '      displayName: "Title",',
      "      required: false,",
      "    },",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  return dir;
}

function zipFolder(srcDir, zipPath) {
  const zip = new AdmZip();
  zip.addLocalFolder(srcDir);
  zip.writeZip(zipPath);
  return zipPath;
}

async function runTests() {
  log("\n╔════════════════════════════════════════════════════════════╗", BLUE);
  log("║       Widget Registry Integration Test Suite               ║", BLUE);
  log("╚════════════════════════════════════════════════════════════╝\n", BLUE);

  // Fixtures: two widget packages, and a ZIP of the weather one.
  const fixturesDir = path.join(ROOT, "fixtures");
  const weatherSrc = writeWidgetPackage(
    path.join(fixturesDir, "weather-widget"),
    {
      pkgName: "weather-widget",
      componentName: "WeatherWidget",
      displayName: "Weather",
    },
  );
  const notesSrc = writeWidgetPackage(path.join(fixturesDir, "notes-widget"), {
    pkgName: "notes-widget",
    componentName: "NotesWidget",
    displayName: "Notes",
  });
  const weatherZip = zipFolder(
    weatherSrc,
    path.join(fixturesDir, "weather-widget.zip"),
  );

  // Test 1: Widget Discovery
  log("Test Suite 1: Widget Discovery", YELLOW);
  await test("Should discover widgets in a widget package", () => {
    const discovered = dynamicWidgetLoader.discoverWidgets(weatherSrc);

    assertTrue(Array.isArray(discovered), "Should return an array");
    assertTrue(discovered.length > 0, "Should find at least one widget");
    assertTrue(
      discovered.includes("WeatherWidget"),
      "Should discover WeatherWidget",
    );
  });

  await test("Should return empty array for non-existent directory", () => {
    const discovered = dynamicWidgetLoader.discoverWidgets(
      path.join(ROOT, "non", "existent", "path"),
    );
    assertEquals(discovered.length, 0, "Should return empty array");
  });

  // Test 2: Widget Loading
  log("\nTest Suite 2: Widget Loading", YELLOW);

  let loadedWidget = null;

  await test("Should load the widget's configuration", async () => {
    const discovered = dynamicWidgetLoader.discoverWidgets(weatherSrc);

    assertTrue(discovered.length > 0, "Should discover at least one widget");

    const result = await dynamicWidgetLoader.loadWidget(
      "Weather",
      weatherSrc,
      discovered[0],
      false,
    );

    loadedWidget = result;

    assertTrue(result, "Should return result object");
    assertTrue(result.component, "Should have component");
    assertTrue(result.config, "Should have config");
    assertEquals(
      result.config.name,
      "WeatherWidget",
      "Config should have its name",
    );
    assertEquals(result.registered, false, "Should not auto-register");
  });

  await test("Should reject a missing component", async () => {
    let error = null;
    try {
      await dynamicWidgetLoader.loadWidget(
        "Weather",
        weatherSrc,
        "NoSuchWidget",
        false,
      );
    } catch (e) {
      error = e;
    }
    assertTrue(error, "Should throw");
    assertTrue(
      /Component file not found/.test(error.message),
      `Should say the component file is missing (got: ${error.message})`,
    );
  });

  // Test 3: Cache Testing
  log("\nTest Suite 3: Caching", YELLOW);

  await test("Should cache loaded widgets", async () => {
    requires(loadedWidget, "a loaded widget");

    // Load again (should come from cache)
    const result = await dynamicWidgetLoader.loadWidget(
      "Weather",
      weatherSrc,
      "WeatherWidget",
      false,
    );

    assertEquals(result, loadedWidget, "Should return same object from cache");
  });

  await test("Should clear cache", () => {
    dynamicWidgetLoader.clearCache();
    assertEquals(
      dynamicWidgetLoader.loadedWidgets.size,
      0,
      "Cache should be empty",
    );
  });

  // Test 4: Configuration Validation
  log("\nTest Suite 4: Configuration Validation", YELLOW);

  await test("Should have valid widget configuration", () => {
    requires(loadedWidget, "a loaded widget");

    const config = loadedWidget.config;
    const requiredFields = ["name", "component", "canHaveChildren"];

    requiredFields.forEach((field) => {
      assertTrue(field in config, `Config should have ${field} property`);
    });
    assertEquals(config.canHaveChildren, false, "canHaveChildren is false");
    assertEquals(
      config.userConfig && config.userConfig.title.defaultValue,
      "Weather",
      "userConfig should be parsed",
    );
  });

  // Test 5: File System Operations
  log("\nTest Suite 5: File System Operations", YELLOW);

  await test("Component file should exist", () => {
    requires(loadedWidget, "a loaded widget");

    const componentPath = loadedWidget.component.path;
    assertTrue(
      fs.existsSync(componentPath),
      `Component file should exist at ${componentPath}`,
    );
  });

  await test("Should have valid file paths", () => {
    requires(loadedWidget, "a loaded widget");

    const componentPath = loadedWidget.component.path;
    assertTrue(
      path.isAbsolute(componentPath),
      "Component path should be absolute",
    );
    assertEquals(
      componentPath,
      path.join(weatherSrc, "widgets", "WeatherWidget.js"),
      "Component path should be in the widgets directory",
    );
  });

  // Test 6: Widget Installation from ZIP
  log("\nTest Suite 6: Widget Installation (Hot Reload)", YELLOW);

  let testCacheDir = null;
  let installedWidgetPath = null;

  await test("Should create test installation directory", () => {
    testCacheDir = path.join(ROOT, "suite6-cache");
    fs.mkdirSync(testCacheDir, { recursive: true });

    assertTrue(
      fs.existsSync(testCacheDir),
      "Test cache directory should exist",
    );
  });

  await test("Should install widget from ZIP file", () => {
    requires(testCacheDir, "the test cache dir");
    assertTrue(fs.existsSync(weatherZip), "Weather widget ZIP should exist");

    // Extract the ZIP the way WidgetRegistry does (checked entries first)
    installedWidgetPath = path.join(testCacheDir, "Weather");

    const zip = new AdmZip(weatherZip);
    WidgetRegistry.validateZipEntries(zip, installedWidgetPath);
    zip.extractAllTo(installedWidgetPath, true);

    assertTrue(
      fs.existsSync(installedWidgetPath),
      "Widget should be extracted from ZIP",
    );
  });

  await test("Should have correct widget file structure", () => {
    requires(installedWidgetPath, "an installed widget");

    const packageJson = path.join(installedWidgetPath, "package.json");
    assertTrue(fs.existsSync(packageJson), "package.json should exist");

    const widgetsDir = path.join(installedWidgetPath, "widgets");
    assertTrue(fs.existsSync(widgetsDir), "widgets/ directory should exist");

    const component = path.join(widgetsDir, "WeatherWidget.js");
    assertTrue(fs.existsSync(component), "Component file should exist");

    const dashConfig = path.join(widgetsDir, "WeatherWidget.dash.js");
    assertTrue(fs.existsSync(dashConfig), "Config file should exist");

    const subComponent = path.join(widgetsDir, "components", "Card.js");
    assertTrue(fs.existsSync(subComponent), "Nested files should be kept");
  });

  await test("Should parse package.json correctly", () => {
    requires(installedWidgetPath, "an installed widget");

    const packageJson = path.join(installedWidgetPath, "package.json");
    const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));

    assertEquals(
      pkg.name,
      "weather-widget",
      "Should have correct package name",
    );
    assertEquals(pkg.version, "1.0.0", "Should have correct version");
    assertTrue(pkg.description, "Should have description");
  });

  await test("Should discover components in installed widget", () => {
    requires(installedWidgetPath, "an installed widget");

    const components = dynamicWidgetLoader.discoverWidgets(installedWidgetPath);

    assertTrue(components.length > 0, "Should discover components");
    assertTrue(
      components.includes("WeatherWidget"),
      "Should discover WeatherWidget component",
    );
  });

  await test("Should load installed widget component", async () => {
    requires(installedWidgetPath, "an installed widget");

    const result = await dynamicWidgetLoader.loadWidget(
      "Weather",
      installedWidgetPath,
      "WeatherWidget",
      false,
    );

    assertTrue(result, "Should load widget");
    assertTrue(result.component, "Should have component");
    assertEquals(
      result.component.path,
      path.join(installedWidgetPath, "widgets", "WeatherWidget.js"),
      "Should load the installed copy",
    );
    assertTrue(result.config, "Should have config");
    assertEquals(
      result.config.displayName,
      "Weather",
      "Should have correct display name",
    );
    assertEquals(result.config.version, "1.0.0", "Should have correct version");
    assertTrue(result.config.downloadUrl, "Should have downloadUrl in config");
  });

  await test("Should validate widget configuration structure", async () => {
    requires(installedWidgetPath, "an installed widget");

    const result = await dynamicWidgetLoader.loadWidget(
      "Weather",
      installedWidgetPath,
      "WeatherWidget",
      false,
    );

    const config = result.config;
    const expectedFields = [
      "name",
      "displayName",
      "description",
      "version",
      "icon",
    ];

    expectedFields.forEach((field) => {
      assertTrue(field in config, `Config should have ${field} property`);
    });
  });

  await test("Should refuse a ZIP entry that escapes its folder", () => {
    // adm-zip cleans names it writes itself, but a hostile ZIP can carry a
    // raw "../" entry name — which is all validateZipEntries reads.
    const evil = { getEntries: () => [{ entryName: "../escape.txt" }] };
    let error = null;
    try {
      WidgetRegistry.validateZipEntries(evil, path.join(ROOT, "evil-target"));
    } catch (e) {
      error = e;
    }
    assertTrue(error, "Should throw");
    assertTrue(
      /Malicious ZIP entry rejected/.test(error.message),
      `Should reject the entry (got: ${error.message})`,
    );
  });

  await test("ZIP file should be sized for distribution", () => {
    assertTrue(fs.existsSync(weatherZip), "weather-widget.zip should exist");

    const stats = fs.statSync(weatherZip);
    assertTrue(stats.size > 0, "ZIP file should not be empty");
    assertTrue(
      stats.size < 1024 * 1024,
      "ZIP file should be reasonably small (< 1MB)",
    );
  });

  await test("Should clean up test directory", () => {
    if (testCacheDir && fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
    assertTrue(
      !fs.existsSync(testCacheDir),
      "Test directory should be removed",
    );
  });

  // Test 7: Install from ZIP via WidgetRegistry
  // "Install a widget from file" passes no name: the widget installs under
  // its package's own name, scoped — @local when signed out.
  log("\nTest Suite 7: Install from ZIP via WidgetRegistry", YELLOW);

  const suite7TempDir = path.join(ROOT, "suite7");
  fs.mkdirSync(suite7TempDir, { recursive: true });
  WidgetRegistry._setScopeUsernameForTest(null);
  WidgetRegistry.initialize(suite7TempDir);
  const suite7Registry = new WidgetRegistry(null, suite7TempDir);

  let suite7Config = null;
  await test("Should install weather widget from ZIP via WidgetRegistry", async () => {
    suite7Config = await suite7Registry.installFromLocalPath(
      null,
      weatherZip,
      false,
    );
    assertTrue(suite7Config, "Should return config object");
    assertEquals(
      suite7Config.installedAs,
      "@local/weather-widget",
      "Signed out, it installs as @local/<package name>",
    );
    assertEquals(
      suite7Config.name,
      "weather-widget",
      "Config name should be weather-widget",
    );
    assertEquals(
      suite7Config.version,
      "1.0.0",
      "Config version should be 1.0.0",
    );
    assertTrue(suite7Config.description, "Config should have description");
  });

  await test("Should have widget in registry after ZIP install", () => {
    requires(suite7Config, "the ZIP install");
    const widgets = suite7Registry.getWidgets();
    assertEquals(widgets.length, 1, "Should have one widget");

    assertEquals(
      suite7Registry.getWidget("Weather"),
      null,
      "Should not be registered under a bare name",
    );
    const weather = suite7Registry.getWidget("@local/weather-widget");
    assertTrue(weather, "Should find the widget by its scoped name");
    assertEquals(
      weather.path,
      path.join(suite7TempDir, "widgets", "@local", "weather-widget"),
      "Widget entry should have correct path",
    );
    assertEquals(
      weather.packageId,
      "@local/weather-widget",
      "packageId should be the scoped name",
    );
    assertEquals(
      weather.checks && weather.checks.ok,
      true,
      "The install should record passing checks",
    );
  });

  await test("Should have correct files on disk after ZIP install", () => {
    const widgetDir = path.join(
      suite7TempDir,
      "widgets",
      "@local",
      "weather-widget",
    );
    assertTrue(
      fs.existsSync(widgetDir),
      "Widget directory should exist on disk",
    );
    assertTrue(
      fs.existsSync(path.join(widgetDir, "package.json")),
      "package.json should exist",
    );
    assertTrue(
      fs.existsSync(path.join(widgetDir, "widgets", "WeatherWidget.js")),
      "Component file should exist",
    );
    assertTrue(
      fs.existsSync(path.join(widgetDir, "widgets", "WeatherWidget.dash.js")),
      "Config file should exist",
    );
    assertTrue(
      fs.existsSync(path.join(widgetDir, "dist", "index.cjs.js")),
      "The widget should have been built (dist/index.cjs.js)",
    );
    assertTrue(
      fs.existsSync(path.join(suite7TempDir, "widgets", "registry.json")),
      "registry.json should be saved in the temp folder",
    );
  });

  await test("Should clean up Suite 7 test directory", () => {
    fs.rmSync(suite7TempDir, { recursive: true, force: true });
    assertTrue(
      !fs.existsSync(suite7TempDir),
      "Suite 7 test directory should be removed",
    );
  });

  // Test 8: Load from Folder via WidgetRegistry
  // Each widget is named from its package (never its folder), scoped under
  // the signed-in user's registry name — or @local when signed out.
  log("\nTest Suite 8: Load from Folder via WidgetRegistry", YELLOW);

  // Setup: copy both fixtures into a shared folder, under folder names that
  // differ from their package names.
  const suite8TempDir = path.join(ROOT, "suite8");
  const suite8FolderDir = path.join(ROOT, "suite8-folder");
  fs.mkdirSync(suite8TempDir, { recursive: true });
  fs.mkdirSync(suite8FolderDir, { recursive: true });
  fs.cpSync(weatherSrc, path.join(suite8FolderDir, "Weather Copy"), {
    recursive: true,
  });
  fs.cpSync(notesSrc, path.join(suite8FolderDir, "my-notes"), {
    recursive: true,
  });
  // Not widgets: skipped.
  fs.mkdirSync(path.join(suite8FolderDir, "node_modules"));
  fs.mkdirSync(path.join(suite8FolderDir, "docs"));

  WidgetRegistry._setScopeUsernameForTest("Tester");
  WidgetRegistry.initialize(suite8TempDir);
  const suite8Registry = new WidgetRegistry(null, suite8TempDir);

  let suite8Results = null;
  await test("Should load multiple widgets from folder", async () => {
    suite8Results = await suite8Registry.registerWidgetsFromFolder(
      suite8FolderDir,
      false,
    );
    assertTrue(Array.isArray(suite8Results), "Should return an array");
    assertEquals(
      suite8Results.length,
      2,
      "Should register 2 widgets from folder",
    );
    assertEquals(suite8Results.skipped, 2, "Should skip the 2 non-widget dirs");
    assertEquals(suite8Results.refused.length, 0, "Should refuse none");
  });

  await test("Should have both widgets in registry after folder load", () => {
    requires(suite8Results, "the folder load");
    const widgets = suite8Registry.getWidgets();
    assertEquals(widgets.length, 2, "Registry should have 2 widgets");
  });

  await test("Should name folder-loaded widgets from their packages, scoped to the signed-in user", () => {
    requires(suite8Results, "the folder load");
    const names = suite8Results.map((r) => r.name).sort();
    assertEquals(
      names[0],
      "@tester/notes-widget",
      "First widget should be @tester/notes-widget",
    );
    assertEquals(
      names[1],
      "@tester/weather-widget",
      "Second widget should be @tester/weather-widget",
    );
    for (const bare of ["notes-widget", "weather-widget", "my-notes"]) {
      assertEquals(
        suite8Registry.getWidget(bare),
        null,
        `Nothing should be registered under the bare name ${bare}`,
      );
    }
  });

  await test("Should load folder widgets in place", () => {
    requires(suite8Results, "the folder load");
    const notes = suite8Registry.getWidget("@tester/notes-widget");
    assertTrue(notes, "Should find @tester/notes-widget");
    assertEquals(
      notes.path,
      path.join(suite8FolderDir, "my-notes"),
      "Should point at the user's folder",
    );
    const listed = suite8Registry
      .listWidgets()
      .find((w) => w.name === "@tester/notes-widget");
    assertEquals(
      listed && listed.loadedInPlace,
      true,
      "Should be listed as loaded in place",
    );
  });

  await test("Should install a single widget folder (a copy) named from its package", async () => {
    WidgetRegistry._setScopeUsernameForTest(null);
    const single = await suite8Registry.registerWidgetsFromFolder(
      path.join(suite8FolderDir, "Weather Copy"),
      false,
    );
    assertEquals(single.length, 1, "Should install one widget");
    assertEquals(single[0].mode, "single", "Should be a single-folder install");
    assertEquals(
      single[0].name,
      "@local/weather-widget",
      "Signed out, it installs as @local/<package name>",
    );
    const entry = suite8Registry.getWidget("@local/weather-widget");
    assertTrue(entry, "Should be in the registry");
    assertEquals(
      entry.path,
      path.join(suite8TempDir, "widgets", "@local", "weather-widget"),
      "Should be copied into the widgets folder",
    );
    assertEquals(
      suite8Registry.getWidget("Weather Copy"),
      null,
      "Should not be registered under the folder's name",
    );
  });

  await test("Should clean up Suite 8 test directories", () => {
    fs.rmSync(suite8FolderDir, { recursive: true, force: true });
    fs.rmSync(suite8TempDir, { recursive: true, force: true });
    assertTrue(
      !fs.existsSync(suite8TempDir),
      "Suite 8 temp dir should be removed",
    );
    assertTrue(
      !fs.existsSync(suite8FolderDir),
      "Suite 8 folder dir should be removed",
    );
  });

  // Test 9: ZIP Round-trip (create ZIP from folder, install from ZIP)
  log("\nTest Suite 9: ZIP Round-trip", YELLOW);

  const suite9ZipPath = path.join(ROOT, "notes-widget-roundtrip.zip");
  zipFolder(notesSrc, suite9ZipPath);

  await test("Should create ZIP from notes-widget fixture", () => {
    assertTrue(fs.existsSync(suite9ZipPath), "Generated ZIP should exist");
    const stats = fs.statSync(suite9ZipPath);
    assertTrue(stats.size > 0, "Generated ZIP should not be empty");
  });

  // Install from the generated ZIP, signed in.
  const suite9TempDir = path.join(ROOT, "suite9");
  fs.mkdirSync(suite9TempDir, { recursive: true });
  WidgetRegistry._setScopeUsernameForTest("tester");
  WidgetRegistry.initialize(suite9TempDir);
  const suite9Registry = new WidgetRegistry(null, suite9TempDir);

  let suite9Config = null;
  await test("Should install notes widget from generated ZIP", async () => {
    suite9Config = await suite9Registry.installFromLocalPath(
      null,
      suite9ZipPath,
      false,
    );
    assertTrue(suite9Config, "Should return config object");
    assertEquals(
      suite9Config.installedAs,
      "@tester/notes-widget",
      "Signed in, it installs as @<username>/<package name>",
    );
    assertEquals(
      suite9Config.name,
      "notes-widget",
      "Config name should be notes-widget",
    );
    assertEquals(
      suite9Config.version,
      "1.0.0",
      "Config version should be 1.0.0",
    );
    assertTrue(
      suite9Registry.getWidget("@tester/notes-widget"),
      "Should be in the registry under its scoped name",
    );
  });

  await test("Should have correct files on disk after ZIP round-trip", () => {
    requires(suite9Config, "the ZIP install");
    const widgetDir = path.join(
      suite9TempDir,
      "widgets",
      "@tester",
      "notes-widget",
    );
    assertTrue(
      fs.existsSync(widgetDir),
      "Widget directory should exist on disk",
    );
    assertTrue(
      fs.existsSync(path.join(widgetDir, "package.json")),
      "package.json should exist",
    );
    assertTrue(
      fs.existsSync(path.join(widgetDir, "widgets", "NotesWidget.js")),
      "Component file should exist",
    );
    assertTrue(
      fs.existsSync(path.join(widgetDir, "widgets", "NotesWidget.dash.js")),
      "Config file should exist",
    );
  });

  await test("Should clean up Suite 9 test artifacts", () => {
    fs.unlinkSync(suite9ZipPath);
    fs.rmSync(suite9TempDir, { recursive: true, force: true });
    assertTrue(
      !fs.existsSync(suite9ZipPath),
      "Generated ZIP should be removed",
    );
    assertTrue(
      !fs.existsSync(suite9TempDir),
      "Suite 9 temp dir should be removed",
    );
  });

  // Print Summary
  log("\n╔════════════════════════════════════════════════════════════╗", BLUE);
  log("║                      Test Summary                           ║", BLUE);
  log("╚════════════════════════════════════════════════════════════╝\n", BLUE);

  log(`Total Tests Run: ${testsRun}`);
  log(`Passed: ${testsPassed}`, GREEN);
  log(`Failed: ${testsFailed}`, testsFailed > 0 ? RED : GREEN);

  if (testsFailed === 0) {
    log("\n✓ All tests passed!", GREEN);
    return 0;
  }
  log(`\n✗ ${testsFailed} test(s) failed`, RED);
  return 1;
}

function cleanUp() {
  fs.rmSync(ROOT, { recursive: true, force: true });
}

// Run tests with async support
runTests()
  .then((code) => {
    cleanUp();
    process.exit(code);
  })
  .catch((error) => {
    log(`\nFatal Error: ${error.message}`, RED);
    log(error.stack, RED);
    cleanUp();
    process.exit(1);
  });
