/**
 * widgetRegistryChecks.test.js — what's checked is what's recorded
 * (consolidation Phase 1a-2):
 *  - each install records who built the code that runs ("dash" when the
 *    app built it from the checked source, "developer" when the package
 *    ships its own build) and the checks it passed;
 *  - the installed folder is swapped in safely — a failed move puts the
 *    old one back;
 *  - a ZIP installed without a name takes the package's own name;
 *  - installed packages are checked once at startup (and again when they
 *    change): one that fails is flagged and keeps working; one found on
 *    disk that isn't registered is registered only if it passes; drafts
 *    aren't checked.
 */
const { describe, it, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");

// widgetRegistry requires "electron"; stub it so the test runs in node.
const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_checks__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_checks__"] = {
  id: "__stub_electron_checks__",
  filename: "__stub_electron_checks__",
  loaded: true,
  exports: {
    app: {
      getPath: () => stubDir,
      getAppPath: () => stubDir,
      isPackaged: false,
    },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
  },
};

process.env.DASH_LOCAL_INSTALL_LAX = "true";
const WidgetRegistry = require("./widgetRegistry");
const { setInstallGate } = require("./widgetRegistry");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zz-registry-checks-"));
WidgetRegistry.initialize(root);
const WIDGETS = path.join(root, "widgets");
const registry = new WidgetRegistry(null);

function makePackage(marker, { name = "@zz/checked", bundle = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-src-"));
  fs.mkdirSync(path.join(dir, "widgets"));
  fs.writeFileSync(
    path.join(dir, "dash.json"),
    JSON.stringify({ name, version: "1.0.0", widgets: [{ name: "Hello" }] }),
  );
  fs.writeFileSync(
    path.join(dir, "widgets", "Hello.js"),
    `export default function Hello() { return "${marker}"; }`,
  );
  fs.writeFileSync(
    path.join(dir, "widgets", "Hello.dash.js"),
    'import Hello from "./Hello";\nexport default { component: Hello, type: "widget" };',
  );
  if (bundle) {
    fs.writeFileSync(path.join(dir, "index.cjs.js"), "module.exports = {};");
  }
  return dir;
}

function zipOf(dir, file) {
  const zip = new AdmZip();
  zip.addLocalFolder(dir);
  const out = path.join(os.tmpdir(), file);
  zip.writeZip(out);
  return out;
}

const passAll = () => setInstallGate(async () => ({ ok: true, problems: [] }));

describe("an install records who built it and what it passed", () => {
  beforeEach(passAll);
  after(() => setInstallGate(null));

  it("a package that ships its own build is the developer's build", async () => {
    await registry.installFromLocalPath(
      "@zz/checked",
      makePackage("v1"),
      false,
    );
    const entry = registry.getWidget("@zz/checked");
    assert.equal(entry.build, "developer");
    assert.equal(entry.checks.ok, true);
    assert.deepEqual(entry.checks.problems, []);
    assert.ok(entry.checks.checkedAt);
    assert.ok(entry.checks.fingerprint);
  });

  it("a package the app builds from its checked source is Dash's build", async () => {
    await registry.installFromLocalPath(
      "@zz/checked",
      makePackage("v2", { bundle: false }),
      false,
    );
    const entry = registry.getWidget("@zz/checked");
    assert.equal(entry.build, "dash");
    assert.equal(entry.checks.ok, true);
  });

  it("a folder loaded in place records the same", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zz-folder-"));
    fs.cpSync(makePackage("f1"), path.join(parent, "zz-own-build"), {
      recursive: true,
    });
    await registry.registerWidgetsFromFolder(parent, false);
    const entry = registry.getWidget("zz-own-build");
    assert.equal(entry.build, "developer");
    assert.equal(entry.checks.ok, true);
    registry.widgets.delete("zz-own-build");
    fs.rmSync(parent, { recursive: true, force: true });
  });
});

describe("the installed folder is swapped in safely", () => {
  beforeEach(passAll);
  after(() => setInstallGate(null));

  it("if the new one can't be moved into place, the old one is put back", async () => {
    await registry.installFromLocalPath(
      "@zz/checked",
      makePackage("keep"),
      false,
    );
    const installed = path.join(WIDGETS, "@zz", "checked");
    const realRename = fs.renameSync;
    let calls = 0;
    fs.renameSync = (from, to) => {
      calls += 1;
      // The second move is the new package going into place.
      if (calls === 2) throw new Error("disk hiccup");
      return realRename(from, to);
    };
    try {
      await assert.rejects(
        registry.installFromLocalPath("@zz/checked", makePackage("new"), false),
        /disk hiccup/,
      );
    } finally {
      fs.renameSync = realRename;
    }
    assert.match(
      fs.readFileSync(path.join(installed, "widgets", "Hello.js"), "utf8"),
      /keep/,
    );
    const staging = path.join(WIDGETS, ".staging");
    assert.deepEqual(fs.existsSync(staging) ? fs.readdirSync(staging) : [], []);
  });
});

describe("a ZIP installed without a name takes the package's own name", () => {
  beforeEach(passAll);
  after(() => setInstallGate(null));

  it("scope + name from dash.json", async () => {
    const dir = makePackage("z1", { name: "zz-zipped" });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "dash.json"), "utf8"),
    );
    fs.writeFileSync(
      path.join(dir, "dash.json"),
      JSON.stringify({ ...manifest, scope: "zz" }),
    );
    const zip = zipOf(dir, "widget-zz-zipped-v1.0.0.zip");
    const config = await registry.installFromLocalPath(null, zip, false);
    assert.equal(config.installedAs, "@zz/zz-zipped");
    assert.ok(registry.getWidget("@zz/zz-zipped"));
    assert.equal(registry.getWidget("widget-zz-zipped-v1.0.0"), null);
    registry.widgets.delete("@zz/zz-zipped");
  });

  it("package.json's name when dash.json has no scope", async () => {
    const dir = makePackage("z2", { name: "zz-plain" });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "@zz/from-package-json", version: "1.0.0" }),
    );
    const config = await registry.installFromLocalPath(
      null,
      zipOf(dir, "anything.zip"),
      false,
    );
    assert.equal(config.installedAs, "@zz/from-package-json");
    registry.widgets.delete("@zz/from-package-json");
  });

  it("the file's name when the package names itself nowhere", async () => {
    const dir = makePackage("z3");
    fs.rmSync(path.join(dir, "dash.json"));
    const config = await registry.installFromLocalPath(
      null,
      zipOf(dir, "zz-fallback.zip"),
      false,
    );
    assert.equal(config.installedAs, "zz-fallback");
    registry.widgets.delete("zz-fallback");
  });
});

describe("installed packages are checked at startup", () => {
  after(() => setInstallGate(null));

  function placeOnDisk(rel, marker, { draft = false } = {}) {
    const dir = path.join(WIDGETS, ...rel.split("/"));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.cpSync(makePackage(marker, { name: rel }), dir, { recursive: true });
    if (draft) {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: rel, dash: { draft: true } }),
      );
    }
    return dir;
  }

  it("a failing package is flagged with its reasons and stays installed", async () => {
    passAll();
    await registry.installFromLocalPath(
      "@zz/startup",
      makePackage("bad"),
      false,
    );
    // Recorded as checked before this rule existed.
    delete registry.getWidget("@zz/startup").checks;
    setInstallGate(async (dir) =>
      fs
        .readFileSync(path.join(dir, "widgets", "Hello.js"), "utf8")
        .includes("bad")
        ? { ok: false, problems: ["Hello: line 1: nope"] }
        : { ok: true, problems: [] },
    );
    const summary = await registry.checkInstalled();
    const entry = registry.getWidget("@zz/startup");
    assert.ok(entry, "still installed");
    assert.equal(entry.checks.ok, false);
    assert.deepEqual(entry.checks.problems, ["Hello: line 1: nope"]);
    assert.ok(summary.failed.includes("@zz/startup"));
  });

  it("an unchanged package isn't checked again; a changed one is", async () => {
    let seen = 0;
    setInstallGate(async () => {
      seen += 1;
      return { ok: true, problems: [] };
    });
    await registry.checkInstalled();
    const first = seen;
    await registry.checkInstalled();
    assert.equal(seen, first, "nothing changed, nothing re-checked");
    const hello = path.join(
      registry.getWidget("@zz/startup").path,
      "widgets",
      "Hello.js",
    );
    fs.writeFileSync(
      hello,
      'export default function Hello() { return "edited"; }',
    );
    await registry.checkInstalled();
    assert.equal(seen, first + 1);
    assert.equal(registry.getWidget("@zz/startup").checks.ok, true);
  });

  it("a bot call found at startup is recorded as a problem, not thrown", async () => {
    passAll();
    const hello = path.join(
      registry.getWidget("@zz/startup").path,
      "widgets",
      "Hello.js",
    );
    fs.writeFileSync(
      hello,
      'export default function Hello() { window.mainApi.bots.run("x"); return 1; }',
    );
    await registry.checkInstalled();
    const entry = registry.getWidget("@zz/startup");
    assert.equal(entry.checks.ok, false);
    assert.ok(entry.checks.problems.length > 0);
  });

  it("drafts aren't checked", async () => {
    let seen = [];
    setInstallGate(async (dir) => {
      seen.push(dir);
      return { ok: true, problems: [] };
    });
    placeOnDisk("@ai-built/draft-zz1", "d", { draft: true });
    const fresh = new WidgetRegistry(null);
    await fresh.checkInstalled();
    assert.ok(!seen.some((d) => d.includes("draft-zz1")));
    fs.rmSync(path.join(WIDGETS, "@ai-built"), {
      recursive: true,
      force: true,
    });
  });

  it("a package found on disk is registered only after it passes", async () => {
    setInstallGate(async (dir) =>
      fs
        .readFileSync(path.join(dir, "widgets", "Hello.js"), "utf8")
        .includes("bad")
        ? { ok: false, problems: ["Hello: nope"] }
        : { ok: true, problems: [] },
    );
    placeOnDisk("@zz/orphan-good", "good");
    placeOnDisk("@zz/orphan-bad", "bad");
    const fresh = new WidgetRegistry(null);
    assert.equal(
      fresh.getWidget("@zz/orphan-good"),
      null,
      "not before it's checked",
    );
    const summary = await fresh.checkInstalled();
    assert.ok(fresh.getWidget("@zz/orphan-good"));
    assert.equal(fresh.getWidget("@zz/orphan-good").checks.ok, true);
    assert.equal(fresh.getWidget("@zz/orphan-bad"), null);
    assert.ok(summary.refused.includes("@zz/orphan-bad"));
    // Its files are left where they were.
    assert.ok(fs.existsSync(path.join(WIDGETS, "@zz", "orphan-bad")));
  });

  it("a package with no record of who built it: AI-built is Dash's, the rest the developer's", async () => {
    passAll();
    const entry = registry.getWidget("@zz/startup");
    delete entry.build;
    delete entry.checks;
    await registry.checkInstalled();
    assert.equal(registry.getWidget("@zz/startup").build, "developer");
  });
});

// A refusal never deletes what was checked (found in 1a-2: the bot-call
// check removed the folder it scanned — fine for a staged copy, not for a
// developer's own folder or an installed package being published).
describe("a check never deletes the folder it checks", () => {
  after(() => setInstallGate(null));
  const botCalling = () => {
    const dir = makePackage("bots");
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.js"),
      'export default function Hello() { window.mainApi.bots.run("x"); return 1; }',
    );
    return dir;
  };

  it("Load a widget from a folder keeps the developer's folder", async () => {
    passAll();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zz-folder-"));
    fs.cpSync(botCalling(), path.join(parent, "zz-starts-bots"), {
      recursive: true,
    });
    const results = await registry.registerWidgetsFromFolder(parent, false);
    assert.deepEqual(results.refused, ["zz-starts-bots"]);
    // Worded for what happened: it wasn't loaded (not "installed").
    assert.match(
      results.refusedReasons["zz-starts-bots"],
      /^zz-starts-bots wasn't loaded — it didn't pass its checks:\n- It starts your bots directly/,
    );
    assert.ok(
      fs.existsSync(path.join(parent, "zz-starts-bots", "widgets", "Hello.js")),
    );
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it("the publish check keeps the installed package", async () => {
    const { checkPackage } = require("./widgetRegistry");
    const dir = botCalling();
    await assert.rejects(checkPackage("@zz/checked", dir, "published"));
    assert.ok(fs.existsSync(path.join(dir, "widgets", "Hello.js")));
  });
});

// Review fixes (Phase 1a-2).
describe("a folder loaded in place runs its current source", () => {
  beforeEach(passAll);
  after(() => setInstallGate(null));

  it("Dash's build is marked and rebuilt on each load; the developer's own isn't", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zz-folder-"));
    const dev = path.join(parent, "zz-dev");
    fs.cpSync(makePackage("first", { bundle: false }), dev, {
      recursive: true,
    });
    await registry.registerWidgetsFromFolder(parent, false);
    const bundle = path.join(dev, "dist", "index.cjs.js");
    assert.match(fs.readFileSync(bundle, "utf8"), /first/);
    assert.equal(registry.getWidget("zz-dev").build, "dash");
    fs.writeFileSync(
      path.join(dev, "widgets", "Hello.js"),
      'export default function Hello() { return "second"; }',
    );
    await registry.registerWidgetsFromFolder(parent, false);
    assert.match(fs.readFileSync(bundle, "utf8"), /second/);
    assert.equal(registry.getWidget("zz-dev").build, "dash");

    const own = path.join(parent, "zz-own");
    fs.cpSync(makePackage("mine"), own, { recursive: true });
    await registry.registerWidgetsFromFolder(parent, false);
    assert.equal(
      fs.readFileSync(path.join(own, "index.cjs.js"), "utf8"),
      "module.exports = {};",
    );
    assert.equal(registry.getWidget("zz-own").build, "developer");
    registry.widgets.delete("zz-dev");
    registry.widgets.delete("zz-own");
    fs.rmSync(parent, { recursive: true, force: true });
  });
});

describe("a ZIP never takes a name silently", () => {
  beforeEach(passAll);
  after(() => setInstallGate(null));
  const zipNamed = (name, file, extra = {}) => {
    const dir = makePackage("n", { name });
    const m = JSON.parse(fs.readFileSync(path.join(dir, "dash.json"), "utf8"));
    fs.writeFileSync(
      path.join(dir, "dash.json"),
      JSON.stringify({ ...m, ...extra }),
    );
    return zipOf(dir, file);
  };

  it("inspectLocalPath says what it would be installed as, and whether that's installed", async () => {
    await registry.installFromLocalPath("@zz/taken", makePackage("t"), false);
    assert.deepEqual(
      registry.inspectLocalPath(zipNamed("taken", "x1.zip", { scope: "zz" })),
      { name: "@zz/taken", installed: true },
    );
    assert.deepEqual(
      registry.inspectLocalPath(zipNamed("free", "x2.zip", { scope: "zz" })),
      { name: "@zz/free", installed: false },
    );
  });

  it("a file can't claim the AI-built scope, or a name made of dots", () => {
    assert.doesNotMatch(
      registry.inspectLocalPath(
        zipNamed("mine", "ai-claim.zip", { scope: "ai-built" }),
      ).name,
      /^@ai-built\//,
    );
    assert.equal(
      registry.inspectLocalPath(zipNamed("..", "dots.zip", { scope: "x" }))
        .name,
      "dots",
    );
  });

  it("the renderer asks before replacing an installed package", () => {
    const src = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "src",
        "Components",
        "AppPages",
        "useWidgetInstall.js",
      ),
      "utf8",
    );
    assert.match(src, /inspectLocal\(filepath\)/);
    assert.match(src, /installLocal\(name, filepath\)/);
  });
});

describe("what was checked is recorded honestly", () => {
  after(() => setInstallGate(null));

  it("a package whose source the gate couldn't find says so", async () => {
    setInstallGate(async () => ({ ok: true, problems: [], sourceFiles: 0 }));
    await registry.installFromLocalPath(
      "@zz/nosource",
      makePackage("x"),
      false,
    );
    assert.equal(
      registry.getWidget("@zz/nosource").checks.sourceChecked,
      false,
    );
    setInstallGate(async () => ({ ok: true, problems: [], sourceFiles: 2 }));
    await registry.installFromLocalPath(
      "@zz/nosource",
      makePackage("y"),
      false,
    );
    assert.equal(registry.getWidget("@zz/nosource").checks.sourceChecked, true);
    registry.widgets.delete("@zz/nosource");
  });

  it("a package with no code at all (a dashboard package) has no build to describe", async () => {
    passAll();
    const dir = path.join(WIDGETS, "@zz", "dash-only");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), "{}");
    registry.widgets.set("@zz/dash-only", { name: "@zz/dash-only", path: dir });
    await registry.checkInstalled();
    assert.equal(registry.getWidget("@zz/dash-only").build, "none");
    registry.widgets.delete("@zz/dash-only");
  });

  it("a change outside widgets/ is re-checked at startup", async () => {
    passAll();
    await registry.installFromLocalPath("@zz/roots", makePackage("r"), false);
    let seen = 0;
    setInstallGate(async () => {
      seen += 1;
      return { ok: true, problems: [] };
    });
    await registry.checkInstalled();
    const before = seen;
    const util = path.join(
      registry.getWidget("@zz/roots").path,
      "utils",
      "x.js",
    );
    fs.mkdirSync(path.dirname(util), { recursive: true });
    fs.writeFileSync(util, "export const x = 1;");
    await registry.checkInstalled();
    assert.equal(seen, before + 1);
  });
});

// Registry installs build from the checked source (consolidation 1a-3);
// a package that can't be built here keeps its developer's build.
describe("a registry install builds from source", () => {
  beforeEach(passAll);
  after(() => setInstallGate(null));
  const { checkPackage } = require("./widgetRegistry");

  it("a package that ships a build and builds here runs Dash's build", async () => {
    const dir = makePackage("from-source");
    const res = await checkPackage("@zz/rebuilt", dir, "installed", {
      rebuild: true,
    });
    assert.equal(res.build, "dash");
    assert.match(
      fs.readFileSync(path.join(dir, "dist", "index.cjs.js"), "utf8"),
      /from-source/,
    );
  });

  it("one that can't be built here keeps its developer's build, saying why", async () => {
    const dir = makePackage("x");
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.js"),
      'import thing from "zz-no-such-library";\nexport default function Hello() { return thing; }',
    );
    const res = await checkPackage("@zz/kept", dir, "installed", {
      rebuild: true,
    });
    assert.equal(res.build, "developer");
    assert.match(res.rebuildError, /zz-no-such-library/);
    assert.equal(
      fs.readFileSync(path.join(dir, "index.cjs.js"), "utf8"),
      "module.exports = {};",
    );
    assert.equal(fs.existsSync(path.join(dir, "dist", "index.cjs.js")), false);
  });

  it("one that doesn't list its libraries isn't rebuilt with the app's — its developer's build is kept", async () => {
    const dir = makePackage("x");
    // adm-zip is one of the app's own libraries.
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.js"),
      'import Z from "adm-zip";\nexport default function Hello() { return Z; }',
    );
    const res = await checkPackage("@zz/unlisted", dir, "installed", {
      rebuild: true,
    });
    assert.equal(res.build, "developer");
    assert.match(
      res.rebuildError,
      /doesn't list the libraries it uses \(adm-zip\)/,
    );
    assert.equal(fs.existsSync(path.join(dir, "dist", "index.cjs.js")), false);
  });

  it("one whose listed libraries can't be fetched keeps its developer's build", async () => {
    const dir = makePackage("x");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "@zz/l",
        dependencies: { "zz-git": "git+https://example.com/x.git" },
      }),
    );
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.js"),
      'import G from "zz-git";\nexport default function Hello() { return G; }',
    );
    const res = await checkPackage("@zz/listed", dir, "installed", {
      rebuild: true,
    });
    assert.equal(res.build, "developer");
    assert.match(res.rebuildError, /can't be downloaded/);
  });

  it("what couldn't be built is recorded with the install", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "widgetRegistry.js"),
      "utf8",
    );
    assert.match(
      src,
      /if \(rebuildError\) checks\.rebuildError = rebuildError;/,
    );
  });

  it("registry downloads ask for it; file and folder installs don't", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "widgetRegistry.js"),
      "utf8",
    );
    const dl = src.slice(src.indexOf("async downloadWidget("));
    assert.match(dl, /stageInstall\([\s\S]{0,300}\{ rebuild: true \}/);
    const local = src.slice(
      src.indexOf("async installFromLocalPath("),
      src.indexOf("isWidgetFolder(dirPath)"),
    );
    assert.doesNotMatch(local, /rebuild: true/);
  });
});

after(() => fs.rmSync(root, { recursive: true, force: true }));
