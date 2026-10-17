/**
 * widgetLibraries.test.js — a widget package's own libraries (consolidation
 * Phase 1a-3): what a package imports is found and recorded at publish,
 * and downloaded at install so the app builds the checked source with
 * them. Runs against a fake npm registry — nothing is downloaded.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const tar = require("tar");

const {
  findLibraryImports,
  installedVersion,
  libraryDependencies,
} = require("./utils/libraryImports");
const {
  installLibraries,
  setLibraryFetch,
  setLibraryCacheDir,
  setLibraryLimits,
} = require("./widgetLibraries");

// ---------- a fake registry ----------
const work = fs.mkdtempSync(path.join(os.tmpdir(), "zz-libs-"));
const REGISTRY = "https://registry.npmjs.org";
const packuments = new Map(); // name → abbreviated packument
const tarballs = new Map(); // url → Buffer
let tarballFetches = 0;

async function publishFake(
  name,
  version,
  {
    dependencies = {},
    peerDependencies = undefined,
    files = {},
    corrupt = false,
    tarballUrl = null,
  } = {},
) {
  const src = fs.mkdtempSync(path.join(work, "src-"));
  const pkgDir = path.join(src, "package");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name,
      version,
      main: "index.js",
      dependencies,
      scripts: {
        postinstall: "node -e \"require('fs').writeFileSync('PWNED','')\"",
      },
    }),
  );
  const all = {
    "index.js": `module.exports = "${name}@${version}";`,
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(pkgDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, rel), content);
  }
  const file = path.join(src, "pkg.tgz");
  await tar.c({ gzip: true, file, cwd: src }, ["package"]);
  const buf = fs.readFileSync(file);
  const url = `${REGISTRY}/${name}/-/${name.replace(/^@[^/]+\//, "")}-${version}.tgz`;
  tarballs.set(url, buf);
  const integrity = `sha512-${crypto
    .createHash("sha512")
    .update(corrupt ? Buffer.from("not the file") : buf)
    .digest("base64")}`;
  const doc = packuments.get(name) || {
    name,
    "dist-tags": {},
    versions: {},
  };
  doc.versions[version] = {
    name,
    version,
    dependencies,
    ...(peerDependencies ? { peerDependencies } : {}),
    dist: { tarball: tarballUrl || url, integrity },
  };
  doc["dist-tags"].latest = version;
  packuments.set(name, doc);
}

let offline = false;
const stalls = new Set(); // urls whose body never arrives
const huge = new Set(); // urls that announce a huge size
async function fakeFetch(url) {
  if (offline) throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
  if (stalls.has(url)) {
    return { ok: true, status: 200, arrayBuffer: () => new Promise(() => {}) };
  }
  if (huge.has(url)) {
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (h === "content-length" ? "999999999999" : null) },
      arrayBuffer: async () => {
        throw new Error("the body shouldn't be read");
      },
    };
  }
  if (tarballs.has(url)) {
    tarballFetches += 1;
    const buf = tarballs.get(url);
    return { ok: true, status: 200, arrayBuffer: async () => buf };
  }
  const name = decodeURIComponent(url.slice(REGISTRY.length + 1));
  if (packuments.has(name)) {
    const doc = packuments.get(name);
    return { ok: true, status: 200, json: async () => doc };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}

before(async () => {
  setLibraryFetch(fakeFetch);
  setLibraryCacheDir(path.join(work, "cache"));
  await publishFake("zz-a", "1.0.0", { dependencies: { "zz-c": "^1.0.0" } });
  await publishFake("zz-b", "1.0.0", { dependencies: { "zz-c": "^2.0.0" } });
  await publishFake("zz-c", "1.0.0");
  await publishFake("zz-c", "1.5.0");
  await publishFake("zz-c", "2.1.0");
  await publishFake("@zz/scoped", "3.0.0", {
    dependencies: { react: "^18.0.0" },
  });
  await publishFake("zz-bad", "1.0.0", { corrupt: true });
  await publishFake("zz-peerer", "1.0.0", {
    peerDependencies: { "zz-c": "^2.0.0", react: "^18.0.0" },
  });
  await publishFake("zz-evil-name", "1.0.0", {
    dependencies: { "../../evil": "1.0.0" },
  });
  await publishFake("zz-elsewhere", "1.0.0", {
    tarballUrl: "https://evil.example.com/zz-elsewhere-1.0.0.tgz",
  });
  await publishFake("zz-stall", "1.0.0");
  stalls.add(`${REGISTRY}/zz-stall/-/zz-stall-1.0.0.tgz`);
  await publishFake("zz-huge", "1.0.0");
  huge.add(`${REGISTRY}/zz-huge/-/zz-huge-1.0.0.tgz`);
  await publishFake("zz-big-unpacked", "1.0.0", {
    files: { "big.txt": "x".repeat(200000) },
  });
});
after(() => {
  setLibraryFetch(null);
  setLibraryCacheDir(null);
  fs.rmSync(work, { recursive: true, force: true });
});

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");

describe("installLibraries — the package's own libraries, from npm", () => {
  it("installs the listed versions and what they depend on", async () => {
    const libs = await installLibraries({ "zz-a": "1.0.0" });
    try {
      assert.match(read(libs.nodeModules, "zz-a/index.js"), /zz-a@1\.0\.0/);
      // ^1.0.0 → the newest 1.x
      assert.match(read(libs.nodeModules, "zz-c/index.js"), /zz-c@1\.5\.0/);
    } finally {
      libs.cleanup();
    }
    assert.equal(fs.existsSync(libs.nodeModules), false, "cleaned up");
  });

  it("two versions of one library: the second is kept beside what needs it", async () => {
    const libs = await installLibraries({ "zz-a": "1.0.0", "zz-b": "1.0.0" });
    try {
      assert.match(read(libs.nodeModules, "zz-c/index.js"), /zz-c@1\.5\.0/);
      assert.match(
        read(libs.nodeModules, "zz-b/node_modules/zz-c/index.js"),
        /zz-c@2\.1\.0/,
      );
    } finally {
      libs.cleanup();
    }
  });

  it("libraries the app provides (React, dash-react) are never downloaded", async () => {
    const libs = await installLibraries({
      "@zz/scoped": "3.0.0",
      react: "18.2.0",
    });
    try {
      assert.ok(
        fs.existsSync(path.join(libs.nodeModules, "@zz", "scoped", "index.js")),
      );
      assert.equal(fs.existsSync(path.join(libs.nodeModules, "react")), false);
    } finally {
      libs.cleanup();
    }
  });

  it("a file that doesn't match npm's fingerprint is refused", async () => {
    await assert.rejects(
      installLibraries({ "zz-bad": "1.0.0" }),
      /zz-bad@1\.0\.0[^]*doesn't match/,
    );
  });

  it("an unknown library or version says which", async () => {
    await assert.rejects(installLibraries({ "zz-nope": "1.0.0" }), /zz-nope/);
    await assert.rejects(installLibraries({ "zz-c": "9.0.0" }), /zz-c@9\.0\.0/);
  });

  it("never runs a library's install scripts", async () => {
    const libs = await installLibraries({ "zz-c": "1.0.0" });
    try {
      assert.equal(
        fs.existsSync(path.join(libs.nodeModules, "zz-c", "PWNED")),
        false,
      );
    } finally {
      libs.cleanup();
    }
    const src = fs.readFileSync(
      path.join(__dirname, "widgetLibraries.js"),
      "utf8",
    );
    assert.doesNotMatch(src, /child_process|\bspawn\(|\bexecSync\(|\bexecFile/);
  });

  it("downloaded files are cached: the next install fetches nothing", async () => {
    (await installLibraries({ "zz-c": "2.1.0" })).cleanup();
    const before = tarballFetches;
    (await installLibraries({ "zz-c": "2.1.0" })).cleanup();
    assert.equal(tarballFetches, before);
  });

  it("only npm versions and ranges — not git, file or URL sources", async () => {
    await assert.rejects(
      installLibraries({ "zz-c": "git+https://example.com/x.git" }),
      /zz-c[^]*can't be downloaded/,
    );
  });
});

// Review fixes (Phase 1a-3).
describe("installLibraries — limits, peers and trust", () => {
  it("a library another one expects beside it (a peer) is installed too — not the app's own", async () => {
    const libs = await installLibraries({ "zz-peerer": "1.0.0" });
    try {
      assert.match(read(libs.nodeModules, "zz-c/index.js"), /zz-c@2\.1\.0/);
      assert.equal(fs.existsSync(path.join(libs.nodeModules, "react")), false);
    } finally {
      libs.cleanup();
    }
  });

  it("a library name that could leave the folder is refused", async () => {
    await assert.rejects(
      installLibraries({ "zz-evil-name": "1.0.0" }),
      /isn't a valid library name/,
    );
  });

  it("files only come from npm's own server", async () => {
    await assert.rejects(
      installLibraries({ "zz-elsewhere": "1.0.0" }),
      /npm's own server/,
    );
  });

  it("a download that stops arriving gives up", async () => {
    setLibraryLimits({ timeoutMs: 200 });
    try {
      await assert.rejects(
        installLibraries({ "zz-stall": "1.0.0" }),
        /took too long/,
      );
    } finally {
      setLibraryLimits(null);
    }
  });

  it("a file that says it's too large isn't downloaded", async () => {
    await assert.rejects(installLibraries({ "zz-huge": "1.0.0" }), /too large/);
  });

  it("libraries too large once unpacked are refused", async () => {
    setLibraryLimits({ maxUnpackedBytes: 100000 });
    try {
      await assert.rejects(
        installLibraries({ "zz-big-unpacked": "1.0.0" }),
        /too large/,
      );
    } finally {
      setLibraryLimits(null);
    }
  });

  it("works offline from what was downloaded before", async () => {
    (await installLibraries({ "zz-a": "1.0.0" })).cleanup();
    offline = true;
    try {
      const libs = await installLibraries({ "zz-a": "1.0.0" });
      assert.match(read(libs.nodeModules, "zz-c/index.js"), /zz-c@1\.5\.0/);
      libs.cleanup();
      await assert.rejects(
        installLibraries({ "zz-never-seen": "1.0.0" }),
        /Couldn't reach npm/,
      );
    } finally {
      offline = false;
    }
  });
});

describe("the compiler builds with the package's libraries", () => {
  it("a widget importing a listed library builds, with that library inside", async () => {
    const { compileWidget } = require("./widgetCompiler");
    const dir = fs.mkdtempSync(path.join(work, "pkg-"));
    fs.mkdirSync(path.join(dir, "widgets"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "@zz/uses-lib",
        dependencies: { "zz-a": "1.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.js"),
      'import a from "zz-a";\nexport default function Hello() { return a; }',
    );
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.dash.js"),
      'import Hello from "./Hello";\nexport default { component: Hello, type: "widget" };',
    );
    const out = await compileWidget(dir);
    assert.match(fs.readFileSync(out, "utf8"), /zz-a@1\.0\.0/);
    // Nothing is left in the package.
    assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
  });

  it("a registry rebuild uses only the package's listed libraries — not the app's", async () => {
    const { compileWidget } = require("./widgetCompiler");
    const dir = fs.mkdtempSync(path.join(work, "pkg-"));
    fs.mkdirSync(path.join(dir, "widgets"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "@zz/strict", dependencies: { "zz-a": "1.0.0" } }),
    );
    // clsx is one of the app's own libraries, but this package didn't list it.
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.js"),
      'import a from "zz-a";\nimport Z from "clsx";\nexport default function Hello() { return a + Z; }',
    );
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.dash.js"),
      'import Hello from "./Hello";\nexport default { component: Hello, type: "widget" };',
    );
    await assert.rejects(
      compileWidget(dir, { ownLibrariesOnly: true }),
      /clsx/,
    );
    // Elsewhere (Widget Builder checks, installs from file) the app's
    // libraries fill in.
    assert.ok(await compileWidget(dir));
  });
});

describe("finding and recording what a package imports", () => {
  function pkg(files) {
    const dir = fs.mkdtempSync(path.join(work, "scan-"));
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
  }
  it("finds the libraries a package's source imports — not the app's own, relative files, Node's modules, builds or tests", () => {
    const dir = pkg({
      "widgets/A.js": [
        'import React from "react";',
        'import { Panel } from "@trops/dash-react";',
        'import { liteClient } from "algoliasearch/lite";',
        'import Mustache from "mustache";',
        'import "./local";',
        'const x = require("lodash.get");',
        'const y = await import("@scope/pkg/sub");',
        'import path from "path";',
        'import fs from "node:fs";',
      ].join("\n"),
      "utils/b.jsx": 'export { a } from "react-instantsearch-hooks-web";',
      "dist/index.cjs.js": 'require("bundled-only");',
      "index.cjs.js": 'require("root-bundle");',
      "widgets/A.test.js": 'import { render } from "@testing-library/react";',
      "node_modules/x/index.js": 'require("inside-node-modules");',
    });
    assert.deepEqual(findLibraryImports(dir), [
      "@scope/pkg",
      "algoliasearch",
      "lodash.get",
      "mustache",
      "react-instantsearch-hooks-web",
    ]);
  });

  it("text that only looks like an import isn't one", () => {
    const dir = pkg({
      "widgets/A.js": [
        "import {",
        "  liteClient,",
        "  other,",
        '} from "algoliasearch/lite";',
        'export * from "zz-reexported";',
        "export default function A() {",
        '  return <p>Imported from "Google Sheets" and import x from "nope"</p>;',
        "}",
        '// import old from "zz-commented";',
        "const s = \"require('zz-in-string')\";",
      ].join("\n"),
    });
    assert.deepEqual(findLibraryImports(dir), [
      "algoliasearch",
      "zz-reexported",
    ]);
  });

  it("installedVersion reads the version the app would build with", () => {
    const nm = path.join(work, "nm", "node_modules");
    fs.mkdirSync(path.join(nm, "zz-lib"), { recursive: true });
    fs.writeFileSync(
      path.join(nm, "zz-lib", "package.json"),
      JSON.stringify({ version: "4.5.6" }),
    );
    assert.equal(installedVersion("zz-lib", [nm]), "4.5.6");
    assert.equal(installedVersion("zz-none", [nm]), null);
  });

  it("libraryDependencies keeps what the package lists, adds what it imports, names what's missing", () => {
    const nm = path.join(work, "nm2", "node_modules");
    fs.mkdirSync(path.join(nm, "mustache"), { recursive: true });
    fs.writeFileSync(
      path.join(nm, "mustache", "package.json"),
      JSON.stringify({ version: "4.2.0" }),
    );
    const dir = pkg({
      "package.json": JSON.stringify({
        dependencies: { "zz-listed": "^2.0.0" },
      }),
      "widgets/A.js":
        'import M from "mustache";\nimport L from "zz-listed";\nimport G from "zz-gone";',
    });
    assert.deepEqual(libraryDependencies(dir, [nm]), {
      dependencies: { mustache: "4.2.0", "zz-listed": "^2.0.0" },
      missing: ["zz-gone"],
    });
  });

  it("publishing records them before the checks build it, and before the version is bumped", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "controller", "widgetRegistryController.js"),
      "utf8",
    );
    const fn = src.indexOf("async function prepareWidgetForPublish(");
    const record = src.indexOf("libraryDependencies(", fn);
    const check = src.indexOf("checkPackage(", fn);
    const bump = src.indexOf("// 4. Compute + persist new version", fn);
    assert.ok(record > fn && record < check && check < bump);
  });

  it("a publish whose build fails puts the version back, and a network problem says so", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "controller", "widgetRegistryController.js"),
      "utf8",
    );
    const at = src.indexOf("} catch (compileErr) {");
    const block = src.slice(at, at + 1400);
    assert.match(
      block,
      /writeWidgetMetadataVersion\([\s\S]{0,120}previousVersion/,
    );
    assert.match(block, /Couldn't \(\?:reach\|download\)/);
  });
});
