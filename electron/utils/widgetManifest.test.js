/**
 * widgetManifest.test.js
 *
 * Pins the manifest contract for locally-installed widgets (Phase 5B,
 * P1 #11). Covers:
 *   - dash.json as primary carrier
 *   - package.json + `dash` block as fallback
 *   - required-field rejection (name, version)
 *   - entry path-traversal rejection
 *   - declaredProviders deprecation warning when missing
 *   - walkSourceContainment rejects symlink-escape
 *
 * Note: walkSourceContainment uses safePath.js which depends on
 * `electron` for app.getPath. Tests that exercise walkSourceContainment
 * stub the electron module via require.cache.
 *
 * Run: `node --test electron/utils/widgetManifest.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Stub the electron module before safePath transitively requires it.
// safePath only touches `app.getPath` inside `getAllowedRoots()` —
// we never call that from this test, but the top-level
// `require("electron")` still needs to resolve. Pattern lifted from
// safePath.test.js for consistency.
const Module = require("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_widgetmanifest__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_widgetmanifest__"] = {
  id: "__stub_electron_widgetmanifest__",
  filename: "__stub_electron_widgetmanifest__",
  loaded: true,
  exports: {
    app: {
      getPath: () => os.tmpdir(),
    },
  },
};

const {
  loadWidgetManifest,
  walkSourceContainment,
} = require("./widgetManifest");

function mkTmpFolder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "widget-manifest-test-"));
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

test("loadWidgetManifest: rejects missing folder", () => {
  const r = loadWidgetManifest("/nonexistent/folder/path/x");
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /does not exist/);
});

test("loadWidgetManifest: rejects folder with neither dash.json nor package.json", () => {
  const dir = mkTmpFolder();
  try {
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /dash\.json or package\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadWidgetManifest: accepts dash.json with required fields", () => {
  const dir = mkTmpFolder();
  try {
    writeJson(path.join(dir, "dash.json"), {
      name: "@ai-built/foo",
      version: "1.0.0",
      declaredProviders: ["slack"],
    });
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.source, "dash.json");
    assert.strictEqual(r.manifest.name, "@ai-built/foo");
    assert.strictEqual(r.manifest.version, "1.0.0");
    assert.deepStrictEqual(r.manifest.declaredProviders, ["slack"]);
    assert.strictEqual(r.manifest.entry, "widgets"); // default
    assert.deepStrictEqual(r.warnings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadWidgetManifest: falls back to package.json with dash block", () => {
  const dir = mkTmpFolder();
  try {
    writeJson(path.join(dir, "package.json"), {
      name: "@trops/test-widget",
      version: "0.2.1",
      dash: { declaredProviders: ["github"] },
    });
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.source, "package.json");
    assert.strictEqual(r.manifest.name, "@trops/test-widget");
    assert.deepStrictEqual(r.manifest.declaredProviders, ["github"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadWidgetManifest: rejects invalid name", () => {
  const dir = mkTmpFolder();
  try {
    writeJson(path.join(dir, "dash.json"), {
      name: "Invalid Name With Spaces",
      version: "1.0.0",
    });
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /name/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadWidgetManifest: rejects missing version", () => {
  const dir = mkTmpFolder();
  try {
    writeJson(path.join(dir, "dash.json"), { name: "@ai-built/foo" });
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /version/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadWidgetManifest: rejects invalid semver", () => {
  const dir = mkTmpFolder();
  try {
    writeJson(path.join(dir, "dash.json"), {
      name: "@ai-built/foo",
      version: "not-a-version",
    });
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /semver/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadWidgetManifest: rejects entry with .. traversal", () => {
  const dir = mkTmpFolder();
  try {
    writeJson(path.join(dir, "dash.json"), {
      name: "@ai-built/foo",
      version: "1.0.0",
      entry: "../../etc/passwd",
    });
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /entry/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadWidgetManifest: rejects absolute entry", () => {
  const dir = mkTmpFolder();
  try {
    writeJson(path.join(dir, "dash.json"), {
      name: "@ai-built/foo",
      version: "1.0.0",
      entry: "/etc/passwd",
    });
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /entry/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadWidgetManifest: missing declaredProviders emits deprecation warning", () => {
  const dir = mkTmpFolder();
  try {
    writeJson(path.join(dir, "dash.json"), {
      name: "@ai-built/foo",
      version: "1.0.0",
    });
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.manifest.declaredProviders, null);
    assert.strictEqual(r.warnings.length, 1);
    assert.match(r.warnings[0], /declaredProviders/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadWidgetManifest: rejects declaredProviders that isn't a string array", () => {
  const dir = mkTmpFolder();
  try {
    writeJson(path.join(dir, "dash.json"), {
      name: "@ai-built/foo",
      version: "1.0.0",
      declaredProviders: [{ type: "slack" }],
    });
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /declaredProviders/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadWidgetManifest: empty declaredProviders array is accepted", () => {
  const dir = mkTmpFolder();
  try {
    writeJson(path.join(dir, "dash.json"), {
      name: "@ai-built/foo",
      version: "1.0.0",
      declaredProviders: [],
    });
    const r = loadWidgetManifest(dir);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.manifest.declaredProviders, []);
    assert.deepStrictEqual(r.warnings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("walkSourceContainment: passes for a clean folder tree", () => {
  const dir = mkTmpFolder();
  try {
    fs.mkdirSync(path.join(dir, "widgets"));
    fs.writeFileSync(path.join(dir, "widgets", "x.js"), "// ok");
    fs.writeFileSync(path.join(dir, "dash.json"), "{}");
    assert.doesNotThrow(() => walkSourceContainment(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("walkSourceContainment: rejects symlink escaping the source root", () => {
  const dir = mkTmpFolder();
  const escapeTarget = mkTmpFolder();
  try {
    // Symlink pointing outside the source root.
    fs.symlinkSync(escapeTarget, path.join(dir, "leak"));
    assert.throws(() => walkSourceContainment(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(escapeTarget, { recursive: true, force: true });
  }
});

test("walkSourceContainment: allows symlinks pointing inside the source root", () => {
  const dir = mkTmpFolder();
  try {
    fs.mkdirSync(path.join(dir, "real"));
    fs.writeFileSync(path.join(dir, "real", "file.txt"), "x");
    fs.symlinkSync(path.join(dir, "real"), path.join(dir, "link"));
    assert.doesNotThrow(() => walkSourceContainment(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
