/**
 * widgetRegistryController.test.js
 *
 * Regression pin for the widget-publish version-divergence bug.
 *
 * When a widget is republished in-app, the version must be written to BOTH
 * package.json AND dash.json. The registry manifest version is generated from
 * package.json, but the installed/on-disk version is read back from dash.json
 * (widgetRegistry.js `enrichEntryFromDisk`). The old code bumped only one of
 * the two (an `else if`), leaving dash.json stale — so the installed version
 * never advanced, the registry update check prompted forever, and the
 * post-install verify failed with "on-disk version is X (expected Y)".
 *
 * `writeWidgetMetadataVersion` is the single helper used by both the bump and
 * the failure-revert paths. These tests exercise it against a real temp dir.
 *
 * Uses node:test (no jest) — same pattern as the rest of the electron/ tests.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// widgetRegistryController.js requires "electron" (and adm-zip) at module load,
// but electron isn't installed in dash-core (it's runtime-provided by
// dash-electron). So we extract just `writeWidgetMetadataVersion` — which only
// depends on `fs` — and re-evaluate it in isolation. Same pattern as
// mcpController.test.js.
const controllerSource = fs.readFileSync(
  path.join(__dirname, "widgetRegistryController.js"),
  "utf8",
);
const fnStart = controllerSource.indexOf(
  "function writeWidgetMetadataVersion(",
);
const fnEnd = controllerSource.indexOf("// ─── Orchestration", fnStart);
const fnSource = controllerSource.substring(fnStart, fnEnd);
const {
  writeWidgetMetadataVersion,
  packageJsonFromDashJson,
  fillFromDashJson,
} = new Function(
  "require",
  `const fs = require("fs"); ${fnSource} return { writeWidgetMetadataVersion, packageJsonFromDashJson, fillFromDashJson };`,
)(require);

test("a package.json with only the permissions block gets name and version from dash.json", () => {
  // The publish permission scan writes package.json where there was none;
  // the registry then refused it: "name" is required; "displayName" is required.
  const dash = {
    name: "@ai-built/filelistwidget",
    displayName: "File List Widget",
    version: "1.0.0",
    description: "AI-generated widget: FileListWidget",
    author: "John Giatropoulos",
  };
  const permissions = { dash: { permissions: { mcp: {} } } };
  const pkg = fillFromDashJson(
    permissions,
    dash,
    "trops",
    "@ai-built/filelistwidget",
  );
  assert.strictEqual(pkg.name, "@trops/filelistwidget");
  assert.strictEqual(pkg.displayName, "File List Widget");
  assert.strictEqual(pkg.version, "1.0.0");
  assert.strictEqual(pkg.author, "John Giatropoulos");
  assert.deepStrictEqual(pkg.dash, permissions.dash);
  // What package.json has is kept.
  const own = fillFromDashJson(
    { name: "@trops/mine", version: "2.0.0" },
    dash,
    "trops",
    "@trops/mine",
  );
  assert.strictEqual(own.name, "@trops/mine");
  assert.strictEqual(own.version, "2.0.0");
  assert.strictEqual(own.displayName, "File List Widget");
  // No dash.json: unchanged.
  assert.deepStrictEqual(
    fillFromDashJson(permissions, null, "trops", "x"),
    permissions,
  );
});

test("dash.json-only widget: a scoped name publishes under the user's scope once", () => {
  // Widget Builder widgets keep `@ai-built/x` in dash.json; the registry
  // rejected `@trops/@ai-built/x` ("name must be kebab-case").
  const pkg = packageJsonFromDashJson(
    {
      name: "@ai-built/calculatorwidget",
      version: "1.2.0",
      author: "AI Assistant",
    },
    "trops",
    "@ai-built/calculatorwidget",
    "John",
  );
  assert.strictEqual(pkg.name, "@trops/calculatorwidget");
  assert.strictEqual(pkg.version, "1.2.0");
  assert.strictEqual(pkg.author, "AI Assistant");
  // A bare name gets the scope added; no name falls back to the package id.
  assert.strictEqual(
    packageJsonFromDashJson({ name: "clock" }, "trops", "clock").name,
    "@trops/clock",
  );
  assert.strictEqual(
    packageJsonFromDashJson({}, "trops", "@trops/x", "John").name,
    "@trops/x",
  );
  assert.strictEqual(
    packageJsonFromDashJson({}, "trops", "x", "John").author,
    "John",
  );
});

function makeTmpPkgDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dash-widget-ver-"));
}

test("writes the version to BOTH package.json and dash.json", () => {
  const dir = makeTmpPkgDir();
  const pkgPath = path.join(dir, "package.json");
  const dashPath = path.join(dir, "dash.json");
  fs.writeFileSync(
    pkgPath,
    JSON.stringify({ name: "@trops/pipeline", version: "1.0.0" }, null, 2),
  );
  fs.writeFileSync(
    dashPath,
    JSON.stringify({ name: "Automation Hub", version: "1.0.0" }, null, 2),
  );

  writeWidgetMetadataVersion(pkgPath, dashPath, "1.0.8");

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const dash = JSON.parse(fs.readFileSync(dashPath, "utf8"));
  assert.strictEqual(pkg.version, "1.0.8", "package.json must be bumped");
  assert.strictEqual(
    dash.version,
    "1.0.8",
    "dash.json must be bumped too — this is the bug being fixed",
  );
  // Other fields untouched.
  assert.strictEqual(pkg.name, "@trops/pipeline");
  assert.strictEqual(dash.name, "Automation Hub");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("revert path round-trips both files back to the previous version", () => {
  const dir = makeTmpPkgDir();
  const pkgPath = path.join(dir, "package.json");
  const dashPath = path.join(dir, "dash.json");
  fs.writeFileSync(pkgPath, JSON.stringify({ version: "1.0.0" }, null, 2));
  fs.writeFileSync(dashPath, JSON.stringify({ version: "1.0.0" }, null, 2));

  writeWidgetMetadataVersion(pkgPath, dashPath, "1.0.8"); // bump
  writeWidgetMetadataVersion(pkgPath, dashPath, "1.0.0"); // revert on failure

  assert.strictEqual(
    JSON.parse(fs.readFileSync(pkgPath, "utf8")).version,
    "1.0.0",
  );
  assert.strictEqual(
    JSON.parse(fs.readFileSync(dashPath, "utf8")).version,
    "1.0.0",
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test("only package.json present — dash.json absent is a no-op, no throw", () => {
  const dir = makeTmpPkgDir();
  const pkgPath = path.join(dir, "package.json");
  const dashPath = path.join(dir, "dash.json"); // never created
  fs.writeFileSync(pkgPath, JSON.stringify({ version: "1.0.0" }, null, 2));

  assert.doesNotThrow(() =>
    writeWidgetMetadataVersion(pkgPath, dashPath, "2.0.0"),
  );
  assert.strictEqual(
    JSON.parse(fs.readFileSync(pkgPath, "utf8")).version,
    "2.0.0",
  );
  assert.strictEqual(fs.existsSync(dashPath), false, "dash.json not created");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("only dash.json present — package.json absent is a no-op, no throw", () => {
  const dir = makeTmpPkgDir();
  const pkgPath = path.join(dir, "package.json"); // never created
  const dashPath = path.join(dir, "dash.json");
  fs.writeFileSync(dashPath, JSON.stringify({ version: "1.0.0" }, null, 2));

  assert.doesNotThrow(() =>
    writeWidgetMetadataVersion(pkgPath, dashPath, "2.0.0"),
  );
  assert.strictEqual(
    JSON.parse(fs.readFileSync(dashPath, "utf8")).version,
    "2.0.0",
  );
  assert.strictEqual(fs.existsSync(pkgPath), false, "package.json not created");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("malformed dash.json is skipped best-effort; package.json still bumps", () => {
  const dir = makeTmpPkgDir();
  const pkgPath = path.join(dir, "package.json");
  const dashPath = path.join(dir, "dash.json");
  fs.writeFileSync(pkgPath, JSON.stringify({ version: "1.0.0" }, null, 2));
  fs.writeFileSync(dashPath, "{ this is not valid json");

  assert.doesNotThrow(() =>
    writeWidgetMetadataVersion(pkgPath, dashPath, "1.0.8"),
  );
  assert.strictEqual(
    JSON.parse(fs.readFileSync(pkgPath, "utf8")).version,
    "1.0.8",
  );
  // Malformed file is left as-is (surfaces later during manifest generation).
  assert.strictEqual(
    fs.readFileSync(dashPath, "utf8"),
    "{ this is not valid json",
  );

  fs.rmSync(dir, { recursive: true, force: true });
});
