/**
 * safePath.test.js
 *
 * Pins path-traversal containment behavior. Each test exercises one
 * pattern from public-research path-traversal techniques. If any of
 * these tests stops passing, the dataApi/algoliaApi handlers that rely
 * on safePath are no longer protecting against the corresponding
 * attack — and we MUST hear about it.
 *
 * Run with `node --test electron/utils/safePath.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { tempDir } = require("../testUtils/tempDir");

// safePath.js calls require("electron") for app.getPath. We mock that
// before requiring the module so the test runs without an Electron host.
const Module = require("node:module");
const tmpRoot = tempDir("safe-path-test-");
const fakeElectron = {
  app: {
    getPath: (key) => {
      if (key === "userData") return path.join(tmpRoot, "userData");
      if (key === "downloads") return path.join(tmpRoot, "Downloads");
      throw new Error("unknown path key: " + key);
    },
  },
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_safepath__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_safepath__"] = {
  id: "__stub_electron_safepath__",
  filename: "__stub_electron_safepath__",
  loaded: true,
  exports: fakeElectron,
};

const { safePath, getAllowedRoots } = require("./safePath");

// Set up canonical roots used across the tests.
const dataRoot = path.join(tmpRoot, "userData", "Dashboard", "data");
fs.mkdirSync(dataRoot, { recursive: true });

test("happy: path strictly inside allowed root resolves cleanly", () => {
  const inside = path.join(dataRoot, "ok.json");
  fs.writeFileSync(inside, "{}");
  const result = safePath(inside, [dataRoot]);
  // realpath may resolve through /private on macOS; just check it's
  // inside the canonical root.
  assert.ok(
    result === fs.realpathSync(inside),
    "expected realpath of inside file: " + result,
  );
});

test("happy: path equal to root resolves to root", () => {
  const result = safePath(dataRoot, [dataRoot]);
  assert.strictEqual(result, fs.realpathSync(dataRoot));
});

test("traversal: ../../ segments are rejected", () => {
  const evil = path.join(dataRoot, "..", "..", "..", "etc", "passwd");
  assert.throws(
    () => safePath(evil, [dataRoot]),
    /not within any allowed root/i,
  );
});

test("traversal: absolute path outside root is rejected", () => {
  assert.throws(
    () => safePath("/etc/passwd", [dataRoot]),
    /not within any allowed root/i,
  );
});

test("traversal: prefix-overlap path is rejected (not /data-evil/ matches /data/)", () => {
  // Sibling directory whose name starts with the same prefix as the
  // root. A naive `result.startsWith(root)` check would incorrectly
  // allow this.
  const sibling = path.join(tmpRoot, "userData", "Dashboard", "data-evil");
  fs.mkdirSync(sibling, { recursive: true });
  const evilFile = path.join(sibling, "x.json");
  fs.writeFileSync(evilFile, "{}");
  assert.throws(
    () => safePath(evilFile, [dataRoot]),
    /not within any allowed root/i,
  );
});

test("symlink: link inside root pointing outside is rejected", () => {
  const linkPath = path.join(dataRoot, "link-out.json");
  const target = path.join(tmpRoot, "outside.json");
  fs.writeFileSync(target, "{}");
  try {
    fs.symlinkSync(target, linkPath);
  } catch (e) {
    if (e.code === "EEXIST") {
      // pre-existing from a previous run — ignore
    } else {
      throw e;
    }
  }
  // Even though linkPath is INSIDE dataRoot, realpath resolves to
  // tmpRoot/outside.json which is OUTSIDE.
  assert.throws(
    () => safePath(linkPath, [dataRoot]),
    /not within any allowed root/i,
  );
});

test("non-existing file: parent realpath is used (lets create operations through inside root)", () => {
  const newPath = path.join(dataRoot, "future-file.json");
  // File doesn't exist yet; safePath should still validate based on
  // the parent's realpath.
  const result = safePath(newPath, [dataRoot]);
  assert.ok(
    result.endsWith("future-file.json"),
    "expected future-file path: " + result,
  );
});

test("input validation: empty/non-string requested rejected", () => {
  assert.throws(() => safePath("", [dataRoot]), /non-empty string/i);
  assert.throws(() => safePath(null, [dataRoot]), /non-empty string/i);
  assert.throws(() => safePath(undefined, [dataRoot]), /non-empty string/i);
  assert.throws(() => safePath(123, [dataRoot]), /non-empty string/i);
});

test("input validation: empty allowedRoots rejected", () => {
  assert.throws(
    () => safePath(path.join(dataRoot, "x.json"), []),
    /non-empty array/i,
  );
  assert.throws(
    () => safePath(path.join(dataRoot, "x.json"), null),
    /non-empty array/i,
  );
});

test("multiple roots: path matches second root", () => {
  const altRoot = path.join(tmpRoot, "alt");
  fs.mkdirSync(altRoot, { recursive: true });
  const inside = path.join(altRoot, "ok.json");
  fs.writeFileSync(inside, "{}");
  const result = safePath(inside, [dataRoot, altRoot]);
  assert.strictEqual(result, fs.realpathSync(inside));
});

test("getAllowedRoots: data category returns Dashboard/data path", () => {
  const roots = getAllowedRoots("data");
  assert.ok(Array.isArray(roots) && roots.length >= 1);
  assert.ok(
    roots[0].endsWith(path.join("Dashboard", "data")),
    "expected default data path, got: " + roots[0],
  );
});

test("getAllowedRoots: unknown category throws", () => {
  assert.throws(() => getAllowedRoots("nonsense"), /unknown.+category/i);
});

// ── Paths on an MCP server (a notes vault), not this computer ──────────
const { withinServerRoots, checkToolPath } = require("./safePath");

test("server roots: inside the folder passes, however it's written", () => {
  const roots = ["Life/Modules/shopping"];
  for (const p of [
    "Life/Modules/shopping/state.md",
    "/Life/Modules/shopping/state.md",
    "./Life/Modules/shopping/state.md",
    "Life\\Modules\\shopping\\state.md",
  ]) {
    assert.strictEqual(withinServerRoots(p, roots), true, p);
    assert.strictEqual(checkToolPath(p, roots).ok, true, p);
  }
});

test("server roots: outside, or climbing out with .., fails", () => {
  const roots = ["Life/Modules/shopping"];
  for (const p of [
    "Life/Modules/home/state.md",
    "Life/Modules/shopping/../home/state.md",
    "../etc/passwd",
    "/etc/passwd",
    "Life/Modules/shoppingextra/x.md",
  ]) {
    assert.strictEqual(withinServerRoots(p, roots), false, p);
    assert.strictEqual(checkToolPath(p, roots).ok, false, p);
  }
});

test('server roots: "/Life/" is the same as "Life"', () => {
  for (const root of ["/Life/", "Life"]) {
    assert.strictEqual(checkToolPath("Life/Modules/x.md", [root]).ok, true);
    assert.strictEqual(checkToolPath("/Life/Modules/x.md", [root]).ok, true);
    assert.strictEqual(checkToolPath("Work/x.md", [root]).ok, false);
  }
});

test("server roots: a single-file root allows that file only", () => {
  const roots = ["Life/Modules/shopping/state.md"];
  assert.strictEqual(
    checkToolPath("Life/Modules/shopping/state.md", roots).ok,
    true,
  );
  assert.strictEqual(
    checkToolPath("Life/Modules/shopping/log.md", roots).ok,
    false,
  );
});

test("the reason shows both sides as server paths", () => {
  const r = checkToolPath("/Life/Modules/home/x.md", ["Life/Modules/shopping"]);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /as a server path: Life\/Modules\/home\/x\.md/);
  assert.match(r.reason, /Life\/Modules\/shopping \(Life\/Modules\/shopping\)/);
});

test("local roots keep the on-disk check", () => {
  const inside = path.join(dataRoot, "local.json");
  fs.writeFileSync(inside, "{}");
  assert.strictEqual(checkToolPath(inside, [dataRoot]).ok, true);
  assert.strictEqual(checkToolPath("/etc/passwd", [dataRoot]).ok, false);
  assert.strictEqual(
    checkToolPath(path.join(dataRoot, "..", "escape.json"), [dataRoot]).ok,
    false,
  );
});

// DASH-46: the gate asks for a folder only on "not-in-root".
test("checkToolPath refusals carry a code", () => {
  const roots = ["Woodworking"];
  assert.strictEqual(
    checkToolPath("Dash/Specs/x.md", roots).code,
    "not-in-root",
  );
  assert.strictEqual(
    checkToolPath("../../etc/passwd", roots).code,
    "traversal",
  );
  assert.strictEqual(
    checkToolPath("Woodworking/../Dash/x.md", roots).code,
    "traversal",
  );
  assert.strictEqual(checkToolPath("", roots).code, "invalid");
  assert.strictEqual(checkToolPath(null, roots).code, "invalid");
  assert.strictEqual(checkToolPath("Woodworking/x.md", roots).code, undefined);
});
