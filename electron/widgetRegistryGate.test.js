/**
 * widgetRegistryGate.test.js — nothing is installed until it passes the
 * app's install gate (consolidation Phase 1a): the package is staged and
 * checked before the installed one is touched; a refusal says why and
 * leaves the installed version as it was.
 */
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// widgetRegistry requires "electron"; stub it so the test runs in node.
const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_gate__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_gate__"] = {
  id: "__stub_electron_gate__",
  filename: "__stub_electron_gate__",
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zz-registry-"));
WidgetRegistry.initialize(root);
const registry = new WidgetRegistry(null);
// Signed out: a package's unscoped name goes under @local.
WidgetRegistry._setScopeUsernameForTest(null);

function makePackage(marker, name = "@zz/gated") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-src-"));
  fs.mkdirSync(path.join(dir, "widgets"));
  fs.writeFileSync(
    path.join(dir, "dash.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      widgets: [{ name: "Hello" }],
    }),
  );
  fs.writeFileSync(
    path.join(dir, "widgets", "Hello.js"),
    `export default function Hello() { return "${marker}"; }`,
  );
  fs.writeFileSync(
    path.join(dir, "widgets", "Hello.dash.js"),
    'import Hello from "./Hello";\nexport default { component: Hello, type: "widget" };',
  );
  fs.writeFileSync(path.join(dir, "index.cjs.js"), "module.exports = {};");
  return dir;
}
const installed = () =>
  path.join(root, "widgets", "@zz", "gated", "widgets", "Hello.js");

describe("the install gate", () => {
  beforeEach(() => setInstallGate(null));
  after(() => {
    setInstallGate(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("without a gate, installs as before", async () => {
    await registry.installFromLocalPath("@zz/gated", makePackage("v1"), false);
    assert.match(fs.readFileSync(installed(), "utf8"), /v1/);
  });

  it("the gate sees a staged copy, not the installed folder, and a pass installs", async () => {
    const seen = [];
    setInstallGate(async (dir, info) => {
      seen.push({
        dir,
        info,
        hello: fs.readFileSync(path.join(dir, "widgets", "Hello.js"), "utf8"),
      });
      return { ok: true, problems: [] };
    });
    await registry.installFromLocalPath("@zz/gated", makePackage("v2"), false);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].info.widgetName, "@zz/gated");
    assert.match(seen[0].hello, /v2/);
    assert.notEqual(
      path.resolve(seen[0].dir),
      path.resolve(path.join(root, "widgets", "@zz", "gated")),
    );
    assert.match(fs.readFileSync(installed(), "utf8"), /v2/);
  });

  it("a refusal says why and leaves the installed version as it was", async () => {
    setInstallGate(async () => ({
      ok: false,
      problems: [
        'Hello: setting "apiKey" asks for a key the algolia connection already provides',
      ],
    }));
    await assert.rejects(
      registry.installFromLocalPath("@zz/gated", makePackage("v3"), false),
      (err) => {
        assert.equal(err.code, "WIDGET_CHECKS_FAILED");
        assert.match(
          err.message,
          /@zz\/gated wasn't installed — it didn't pass its checks/,
        );
        assert.match(err.message, /- Hello: setting "apiKey"/);
        assert.deepEqual(err.problems.length, 1);
        return true;
      },
    );
    assert.match(fs.readFileSync(installed(), "utf8"), /v2/);
  });

  it("a package with no bundle must build, or it's refused", async () => {
    const dir = makePackage("v5");
    fs.rmSync(path.join(dir, "index.cjs.js"));
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.js"),
      'import thing from "zz-no-such-library";\nexport default function Hello() { return thing; }',
    );
    await assert.rejects(
      registry.installFromLocalPath("@zz/gated", dir, false),
      (err) => {
        assert.equal(err.code, "WIDGET_CHECKS_FAILED");
        assert.match(err.message, /@zz\/gated wasn't installed/);
        assert.match(err.message, /zz-no-such-library/);
        return true;
      },
    );
    assert.match(fs.readFileSync(installed(), "utf8"), /v2/);
  });

  it("a package with no bundle that builds is installed with its build", async () => {
    const dir = makePackage("v6");
    fs.rmSync(path.join(dir, "index.cjs.js"));
    await registry.installFromLocalPath("@zz/gated", dir, false);
    assert.match(fs.readFileSync(installed(), "utf8"), /v6/);
    assert.ok(
      fs.existsSync(
        path.join(root, "widgets", "@zz", "gated", "dist", "index.cjs.js"),
      ),
    );
  });

  it("no staging folders are left behind", () => {
    const staging = path.join(root, "widgets", ".staging");
    assert.deepEqual(fs.existsSync(staging) ? fs.readdirSync(staging) : [], []);
  });

  it("a package that starts a bot is refused before the installed one is touched", async () => {
    const dir = makePackage("v4");
    fs.writeFileSync(
      path.join(dir, "widgets", "Hello.js"),
      'export default function Hello() { window.mainApi.bots.run("x"); return "v4"; }',
    );
    await assert.rejects(
      registry.installFromLocalPath("@zz/gated", dir, false),
    );
    assert.match(fs.readFileSync(installed(), "utf8"), /v6/);
  });

  it("a folder of packages loads only those that pass, and says why the others didn't", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zz-folder-"));
    fs.cpSync(makePackage("good", "@zz/good"), path.join(parent, "good"), {
      recursive: true,
    });
    fs.cpSync(makePackage("bad", "@zz/bad"), path.join(parent, "bad"), {
      recursive: true,
    });
    setInstallGate(async (dir) =>
      fs
        .readFileSync(path.join(dir, "widgets", "Hello.js"), "utf8")
        .includes("bad")
        ? { ok: false, problems: ["Hello: something's wrong"] }
        : { ok: true, problems: [] },
    );
    const results = await registry.registerWidgetsFromFolder(parent, false);
    assert.deepEqual(
      results.map((r) => path.basename(r.path)),
      ["good"],
    );
    assert.deepEqual(results.refused, ["bad"]);
    assert.match(
      results.refusedReasons.bad,
      /bad wasn't loaded — it didn't pass its checks:\n- Hello: something's wrong/,
    );
    fs.rmSync(parent, { recursive: true, force: true });
  });
});

// IPC copies arrays without extra properties, so the folder load's handler
// sends a plain object (consolidation Phase 1a — the refusals and the
// skipped count never reached the screen).
describe("widget:load-folder over IPC", () => {
  it("returns { widgets, skipped, refused, refusedReasons }", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "widgetRegistry.js"),
      "utf8",
    );
    const at = src.indexOf('ipcMain.handle("widget:load-folder"');
    const body = src.slice(
      at,
      src.indexOf('ipcMain.handle("widget:uninstall"', at),
    );
    assert.match(body, /widgets: \[\.\.\.results\]/);
    assert.match(body, /skipped: results\.skipped \|\| 0/);
    assert.match(body, /refused: results\.refused \|\| \[\]/);
    assert.match(body, /refusedReasons: results\.refusedReasons \|\| \{\}/);
  });
});

// Publishing runs the same checks before anything is changed or sent
// (consolidation Phase 1a).
describe("publish", () => {
  it("checkPackage refuses with a publish-worded reason", async () => {
    const { checkPackage } = require("./widgetRegistry");
    setInstallGate(async () => ({ ok: false, problems: ["Hello: nope"] }));
    const dir = makePackage("p1");
    await assert.rejects(checkPackage("@zz/gated", dir, "published"), (err) => {
      assert.equal(err.code, "WIDGET_CHECKS_FAILED");
      assert.match(
        err.message,
        /^@zz\/gated wasn't published — it didn't pass its checks:\n- Hello: nope/,
      );
      return true;
    });
    setInstallGate(null);
  });
  it("prepareWidgetForPublish checks before it bumps the version or zips", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "controller", "widgetRegistryController.js"),
      "utf8",
    );
    const fn = src.indexOf("async function prepareWidgetForPublish(");
    const check = src.indexOf("checkPackage(", fn);
    const bump = src.indexOf("// 4. Compute + persist new version", fn);
    assert.ok(check > fn && check < bump);
  });
});
