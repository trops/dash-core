/**
 * widgetCompiler.test.js — a widget package built outside the app folder
 * (the Widget Builder's temp build folder) finds npm libraries in the
 * app's own libraries; a missing library or file is named plainly.
 * (Widget Builder edit fixes — whole-package rebuilds.)
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  compileWidget,
  hostLibraryPaths,
  libraryPaths,
  mirrorLibrary,
  friendlyCompileError,
} = require("./widgetCompiler");

function makePackage(componentCode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-compile-"));
  fs.mkdirSync(path.join(dir, "widgets"));
  fs.writeFileSync(
    path.join(dir, "widgets", "Hello.js"),
    componentCode,
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "widgets", "Hello.dash.js"),
    'export default { component: "Hello", type: "widget" };',
    "utf8",
  );
  return dir;
}

describe("compileWidget — libraries from the app", () => {
  it("a package outside the app folder finds a library the app has", async () => {
    const dir = makePackage(
      'import semver from "semver";\nimport React from "react";\nexport default function Hello() { return semver.valid("1.2.3"); }\n',
    );
    try {
      const out = await compileWidget(dir);
      assert.ok(out && fs.existsSync(out));
      const code = fs.readFileSync(out, "utf8");
      // semver is bundled in; react stays the host's.
      assert.match(code, /SEMVER_SPEC_VERSION|semver/);
      assert.match(code, /require\("react"\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a library the app doesn't have, and a missing file, are named plainly", async () => {
    const dir = makePackage(
      'import x from "zz-not-a-real-lib";\nimport cfg from "./missingConfig";\nexport default function Hello() { return x + cfg; }\n',
    );
    try {
      await assert.rejects(compileWidget(dir), (err) => {
        assert.match(
          err.message,
          /needs the library "zz-not-a-real-lib", which this app doesn't include/,
        );
        assert.match(
          err.message,
          /Hello\.js imports "\.\/missingConfig", which isn't in the package/,
        );
        return true;
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("hostLibraryPaths", () => {
  it("lists every node_modules above a folder, nearest first", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zz-paths-"));
    try {
      const deep = path.join(
        root,
        "app",
        "node_modules",
        "@trops",
        "core",
        "dist",
      );
      fs.mkdirSync(deep, { recursive: true });
      fs.mkdirSync(path.join(root, "node_modules"));
      const paths = hostLibraryPaths(deep);
      assert.deepEqual(paths, [
        path.join(root, "app", "node_modules"),
        path.join(root, "node_modules"),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("mirrorLibrary — a packaged app's libraries esbuild can read", () => {
  it("copies a library (and a scoped one) into the cache once", () => {
    const from = fs.mkdtempSync(path.join(os.tmpdir(), "zz-from-"));
    const to = fs.mkdtempSync(path.join(os.tmpdir(), "zz-to-"));
    try {
      fs.mkdirSync(path.join(from, "mustache"));
      fs.writeFileSync(path.join(from, "mustache", "package.json"), "{}");
      fs.mkdirSync(path.join(from, "@algolia", "client"), { recursive: true });
      fs.writeFileSync(path.join(from, "@algolia", "client", "index.js"), "1");
      assert.equal(mirrorLibrary("mustache", [from], to), true);
      assert.equal(mirrorLibrary("@algolia/client/lite", [from], to), true);
      assert.ok(fs.existsSync(path.join(to, "mustache", "package.json")));
      assert.ok(fs.existsSync(path.join(to, "@algolia", "client", "index.js")));
      // Already there: not copied again.
      fs.writeFileSync(path.join(to, "mustache", "marker"), "x");
      assert.equal(mirrorLibrary("mustache", [from], to), true);
      assert.ok(fs.existsSync(path.join(to, "mustache", "marker")));
      assert.equal(mirrorLibrary("zz-nope", [from], to), false);
    } finally {
      fs.rmSync(from, { recursive: true, force: true });
      fs.rmSync(to, { recursive: true, force: true });
    }
  });
});

describe("friendlyCompileError", () => {
  it("turns esbuild's resolve errors into plain sentences; others pass through", () => {
    const msg = friendlyCompileError({
      message: "Build failed with 3 errors",
      errors: [
        {
          text: 'Could not resolve "mustache"',
          location: { file: "widgets/A.js" },
        },
        {
          text: 'Could not resolve "./algoliaProviderConfig"',
          location: { file: "widgets/A.dash.js" },
        },
        {
          text: "Unexpected token",
          location: { file: "widgets/B.js", line: 3 },
        },
      ],
    });
    assert.match(
      msg,
      /needs the library "mustache", which this app doesn't include/,
    );
    assert.match(
      msg,
      /A\.dash\.js imports "\.\/algoliaProviderConfig", which isn't in the package/,
    );
    assert.match(msg, /widgets\/B\.js:3: Unexpected token/);
  });
});

describe("libraryPaths — the app's own libraries always count", () => {
  it("adds the app folder's node_modules after the ones above, once", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zz-app-"));
    try {
      const core = path.join(root, "core", "dist");
      fs.mkdirSync(core, { recursive: true });
      fs.mkdirSync(path.join(root, "core", "node_modules"));
      const app = path.join(root, "app");
      fs.mkdirSync(path.join(app, "node_modules"), { recursive: true });
      assert.deepEqual(libraryPaths(core, app), [
        path.join(root, "core", "node_modules"),
        path.join(app, "node_modules"),
      ]);
      // Started from a subfolder (public/electron.js): the libraries above it count.
      const pub = path.join(app, "public");
      fs.mkdirSync(pub);
      assert.deepEqual(libraryPaths(core, pub), [
        path.join(root, "core", "node_modules"),
        path.join(app, "node_modules"),
      ]);
      // An app folder already listed, or none: no duplicate, no extra.
      assert.deepEqual(libraryPaths(core, null), [
        path.join(root, "core", "node_modules"),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
