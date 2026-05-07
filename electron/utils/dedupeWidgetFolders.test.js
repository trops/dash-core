/**
 * dedupeWidgetFolders.test.js
 *
 * Pin for the helper that cleans up bare-name widget folders whose
 * `package.json` actually declares a scoped name. These are stale
 * artifacts from older install paths — they coexist with the
 * canonical `widgets/@scope/name/` folder, register under their
 * folder name in widgetRegistry, then crash ComponentManager with
 * "missing origin metadata" because the bare-name registry entry
 * has no scope to derive a 3-segment id from.
 *
 * Two outcomes:
 *   - Scoped twin exists → bare folder is removed (truly redundant)
 *   - Scoped twin missing → bare folder is moved to the canonical
 *     scoped path
 *
 * Run: `node --test electron/utils/dedupeWidgetFolders.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { dedupeWidgetFolders } = require("./dedupeWidgetFolders");

function makeWidgetsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dedupe-folders-test-"));
}

function writePackage(dir, pkgName, version = "1.0.0") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: pkgName, version }, null, 2),
    "utf8",
  );
  // Sentinel file so we can detect whether the directory was preserved
  // or moved.
  fs.writeFileSync(path.join(dir, "marker.txt"), pkgName + "@" + version);
}

test("dedupeWidgetFolders: removes bare folder when scoped twin exists", () => {
  const widgetsDir = makeWidgetsDir();
  const bareDir = path.join(widgetsDir, "pipeline");
  const scopedDir = path.join(widgetsDir, "@ai-built", "pipeline");
  writePackage(bareDir, "@ai-built/pipeline");
  writePackage(scopedDir, "@ai-built/pipeline");

  const result = dedupeWidgetFolders(widgetsDir);

  assert.strictEqual(
    fs.existsSync(bareDir),
    false,
    "bare folder should be removed",
  );
  assert.strictEqual(
    fs.existsSync(scopedDir),
    true,
    "scoped folder should be untouched",
  );
  assert.deepStrictEqual(result.removed, [bareDir]);
  assert.deepStrictEqual(result.migrated, []);
  fs.rmSync(widgetsDir, { recursive: true, force: true });
});

test("dedupeWidgetFolders: migrates bare folder when scoped twin missing", () => {
  const widgetsDir = makeWidgetsDir();
  const bareDir = path.join(widgetsDir, "pipeline");
  writePackage(bareDir, "@ai-built/pipeline");
  // No scoped twin.

  const result = dedupeWidgetFolders(widgetsDir);

  const scopedDir = path.join(widgetsDir, "@ai-built", "pipeline");
  assert.strictEqual(
    fs.existsSync(bareDir),
    false,
    "bare folder should be moved",
  );
  assert.strictEqual(
    fs.existsSync(scopedDir),
    true,
    "scoped folder should now exist",
  );
  assert.strictEqual(
    fs.readFileSync(path.join(scopedDir, "marker.txt"), "utf8"),
    "@ai-built/pipeline@1.0.0",
    "content should follow the move",
  );
  assert.deepStrictEqual(result.removed, []);
  assert.deepStrictEqual(result.migrated, [{ from: bareDir, to: scopedDir }]);
  fs.rmSync(widgetsDir, { recursive: true, force: true });
});

test("dedupeWidgetFolders: leaves truly bare-name packages alone", () => {
  const widgetsDir = makeWidgetsDir();
  const bareDir = path.join(widgetsDir, "legacy-pkg");
  writePackage(bareDir, "legacy-pkg"); // unscoped npm name

  const result = dedupeWidgetFolders(widgetsDir);

  assert.strictEqual(
    fs.existsSync(bareDir),
    true,
    "legitimate bare-name package preserved",
  );
  assert.deepStrictEqual(result.removed, []);
  assert.deepStrictEqual(result.migrated, []);
  fs.rmSync(widgetsDir, { recursive: true, force: true });
});

test("dedupeWidgetFolders: skips folders with no package.json", () => {
  const widgetsDir = makeWidgetsDir();
  const orphanDir = path.join(widgetsDir, "stray");
  fs.mkdirSync(orphanDir, { recursive: true });
  fs.writeFileSync(path.join(orphanDir, "some-file.txt"), "no pkg");

  const result = dedupeWidgetFolders(widgetsDir);

  assert.strictEqual(fs.existsSync(orphanDir), true);
  assert.deepStrictEqual(result.removed, []);
  assert.deepStrictEqual(result.migrated, []);
  fs.rmSync(widgetsDir, { recursive: true, force: true });
});

test("dedupeWidgetFolders: skips folders with malformed package.json", () => {
  const widgetsDir = makeWidgetsDir();
  const bareDir = path.join(widgetsDir, "broken");
  fs.mkdirSync(bareDir, { recursive: true });
  fs.writeFileSync(path.join(bareDir, "package.json"), "not-json");

  const result = dedupeWidgetFolders(widgetsDir);

  assert.strictEqual(fs.existsSync(bareDir), true);
  assert.deepStrictEqual(result.removed, []);
  assert.deepStrictEqual(result.migrated, []);
  fs.rmSync(widgetsDir, { recursive: true, force: true });
});

test("dedupeWidgetFolders: handles multiple bare folders independently", () => {
  const widgetsDir = makeWidgetsDir();
  // Case A: bare with scoped twin → remove
  writePackage(path.join(widgetsDir, "pipeline"), "@ai-built/pipeline");
  writePackage(
    path.join(widgetsDir, "@ai-built", "pipeline"),
    "@ai-built/pipeline",
  );
  // Case B: bare alone with scoped name → migrate
  writePackage(path.join(widgetsDir, "lonely"), "@trops/lonely");
  // Case C: legitimate bare-name → leave
  writePackage(path.join(widgetsDir, "real-bare"), "real-bare");

  const result = dedupeWidgetFolders(widgetsDir);

  assert.strictEqual(
    fs.existsSync(path.join(widgetsDir, "pipeline")),
    false,
    "case A: bare removed",
  );
  assert.strictEqual(
    fs.existsSync(path.join(widgetsDir, "@ai-built", "pipeline")),
    true,
    "case A: scoped untouched",
  );
  assert.strictEqual(
    fs.existsSync(path.join(widgetsDir, "lonely")),
    false,
    "case B: bare moved",
  );
  assert.strictEqual(
    fs.existsSync(path.join(widgetsDir, "@trops", "lonely")),
    true,
    "case B: scoped destination created",
  );
  assert.strictEqual(
    fs.existsSync(path.join(widgetsDir, "real-bare")),
    true,
    "case C: legitimate bare-name preserved",
  );
  assert.strictEqual(result.removed.length, 1);
  assert.strictEqual(result.migrated.length, 1);
  fs.rmSync(widgetsDir, { recursive: true, force: true });
});

test("dedupeWidgetFolders: ignores @scope subfolders (only walks top-level bare folders)", () => {
  // @scope/* folders are already canonical. The dedupe pass should
  // not re-traverse into them.
  const widgetsDir = makeWidgetsDir();
  writePackage(path.join(widgetsDir, "@trops", "gmail"), "@trops/gmail");

  const result = dedupeWidgetFolders(widgetsDir);

  assert.strictEqual(
    fs.existsSync(path.join(widgetsDir, "@trops", "gmail")),
    true,
  );
  assert.deepStrictEqual(result.removed, []);
  assert.deepStrictEqual(result.migrated, []);
  fs.rmSync(widgetsDir, { recursive: true, force: true });
});

test("dedupeWidgetFolders: ignores registry.json file at top level", () => {
  const widgetsDir = makeWidgetsDir();
  fs.writeFileSync(path.join(widgetsDir, "registry.json"), "{}");
  writePackage(path.join(widgetsDir, "real-bare"), "real-bare");

  const result = dedupeWidgetFolders(widgetsDir);

  assert.strictEqual(
    fs.existsSync(path.join(widgetsDir, "registry.json")),
    true,
  );
  assert.strictEqual(fs.existsSync(path.join(widgetsDir, "real-bare")), true);
  assert.deepStrictEqual(result.removed, []);
  assert.deepStrictEqual(result.migrated, []);
  fs.rmSync(widgetsDir, { recursive: true, force: true });
});

test("dedupeWidgetFolders: missing widgetsDir returns empty result", () => {
  const result = dedupeWidgetFolders("/no/such/path/yyyyy");
  assert.deepStrictEqual(result, { removed: [], migrated: [], errors: [] });
});
