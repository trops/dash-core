/**
 * widgetRegistryScope.test.js — a widget loaded from a folder (or a ZIP)
 * installs under its package's own name, scoped (QA 2026-10-22: Dash named
 * it after the folder, so it had no scope and could never be placed on a
 * dashboard). Unscoped names go under the signed-in user's registry name,
 * or @local when signed out.
 */
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// widgetRegistry requires "electron"; stub it so the test runs in node.
const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-scope-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_scope__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_scope__"] = {
  id: "__stub_electron_scope__",
  filename: "__stub_electron_scope__",
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

const WidgetRegistry = require("./widgetRegistry");
const {
  scopedLocalId,
  localPackageName,
  setInstallGate,
  _setScopeUsernameForTest,
} = WidgetRegistry;

const registry = new WidgetRegistry(null);
const widgetsDir = path.join(stubDir, "widgets");

// A widget package folder named `folder`, whose dash.json says `name`.
function makePackage(parent, folder, name, pkgName = null) {
  const dir = path.join(parent, folder);
  fs.mkdirSync(path.join(dir, "widgets"), { recursive: true });
  const dash = { version: "1.0.0", widgets: [{ name: "Hello" }] };
  if (name) dash.name = name;
  fs.writeFileSync(path.join(dir, "dash.json"), JSON.stringify(dash));
  if (pkgName) {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: pkgName, version: "1.0.0" }),
    );
  }
  fs.writeFileSync(
    path.join(dir, "widgets", "Hello.js"),
    'export default function Hello() { return "hi"; }',
  );
  fs.writeFileSync(
    path.join(dir, "widgets", "Hello.dash.js"),
    'import Hello from "./Hello";\nexport default { component: Hello, type: "widget" };',
  );
  fs.writeFileSync(path.join(dir, "index.cjs.js"), "module.exports = {};");
  return dir;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "zz-scope-src-"));

setInstallGate(async () => ({ ok: true, problems: [] }));

afterEach(() => _setScopeUsernameForTest(null));

describe("scopedLocalId", () => {
  it("keeps a scoped name", () => {
    assert.equal(scopedLocalId("@john/clock", "someone"), "@john/clock");
  });

  it("puts an unscoped name under the signed-in user", () => {
    assert.equal(scopedLocalId("clock", "John"), "@john/clock");
    assert.equal(scopedLocalId("clock", "@john"), "@john/clock");
  });

  it("puts an unscoped name under @local when signed out", () => {
    assert.equal(scopedLocalId("clock", null), "@local/clock");
  });

  it("never lets a file claim the AI-built scope", () => {
    assert.equal(scopedLocalId("@ai-built/clock", null), "@local/clock");
    assert.equal(scopedLocalId("@ai-built/clock", "john"), "@john/clock");
  });

  it("isn't a name for dots or spaces", () => {
    assert.equal(scopedLocalId("..", null), null);
    assert.equal(scopedLocalId("my clock", null), null);
  });
});

describe("localPackageName", () => {
  it("uses the package's own name, never the folder's", () => {
    const dir = makePackage(tmp(), "some-folder", "@john/clock");
    assert.equal(localPackageName(dir, null), "@john/clock");
  });

  it("a scoped package.json name wins over an unscoped dash.json one", () => {
    const dir = makePackage(tmp(), "f", "clock", "@john/clock");
    assert.equal(localPackageName(dir, null), "@john/clock");
  });

  it("an unscoped own name: the user's scope, else @local", () => {
    const dir = makePackage(tmp(), "some-folder", "clock");
    assert.equal(localPackageName(dir, "john"), "@john/clock");
    assert.equal(localPackageName(dir, null), "@local/clock");
  });

  it("package.json's name (what publishing uses) before dash.json's", () => {
    const dir = makePackage(tmp(), "f2", "clock-widget", "clock");
    assert.equal(localPackageName(dir, "john"), "@john/clock");
    // dash.json's own scope + name still comes first.
    fs.writeFileSync(
      path.join(dir, "dash.json"),
      JSON.stringify({ scope: "acme", name: "clock-widget" }),
    );
    assert.equal(localPackageName(dir, "john"), "@acme/clock-widget");
  });

  it("a scope that isn't a name doesn't win: the user's scope applies", () => {
    for (const bad of ["@My Org/clock", "@../clock"]) {
      const dir = makePackage(tmp(), "f4", bad);
      assert.equal(localPackageName(dir, "john"), "@john/clock");
      assert.equal(localPackageName(dir, null), "@local/clock");
    }
    // A real scope elsewhere in the package still wins over it.
    const both = makePackage(tmp(), "f5", "@My Org/clock", "@acme/clock");
    assert.equal(localPackageName(both, "john"), "@acme/clock");
  });

  it("no name anywhere: the folder's name, scoped", () => {
    const dir = makePackage(tmp(), "Weather", null);
    assert.equal(localPackageName(dir, null), "@local/weather");
  });
});

describe("loading folders", () => {
  it("a folder of widgets registers each under its package's scoped name", async () => {
    const parent = tmp();
    const scoped = makePackage(parent, "folder-a", "@john/clock");
    const plain = makePackage(parent, "folder-b", "weather");
    const results = await registry.registerWidgetsFromFolder(parent, false);
    assert.deepEqual(results.map((r) => r.name).sort(), [
      "@john/clock",
      "@local/weather",
    ]);
    assert.equal(registry.getWidget("@john/clock").path, scoped);
    assert.equal(registry.getWidget("@local/weather").path, plain);
    assert.equal(registry.getWidget("folder-a"), null);
    // Loaded in place: the folders are the user's.
    assert.ok(fs.existsSync(path.join(plain, "widgets", "Hello.js")));
    registry.widgets.delete("@john/clock");
    registry.widgets.delete("@local/weather");
  });

  it("signed in, an unscoped package goes under the user's name", async () => {
    _setScopeUsernameForTest("john");
    const parent = tmp();
    makePackage(parent, "folder-c", "notes");
    const results = await registry.registerWidgetsFromFolder(parent, false);
    assert.deepEqual(
      results.map((r) => r.name),
      ["@john/notes"],
    );
    registry.widgets.delete("@john/notes");
  });

  it("two folders whose packages share a name: the second is refused, saying why", async () => {
    const parent = tmp();
    makePackage(parent, "a-first", "@john/same");
    makePackage(parent, "b-second", "@john/same");
    const results = await registry.registerWidgetsFromFolder(parent, false);
    assert.equal(results.length, 1);
    assert.deepEqual(results.refused, ["b-second"]);
    assert.match(
      results.refusedReasons["b-second"],
      /its package is named @john\/same, like a-first/,
    );
    registry.widgets.delete("@john/same");
  });

  it("an older load's bare-name entry for the same folder is forgotten", async () => {
    const parent = tmp();
    const dir = makePackage(parent, "clock-folder", "clock");
    registry.registerWidget("clock-folder", { name: "clock" }, dir, false);
    await registry.registerWidgetsFromFolder(parent, false);
    assert.equal(registry.getWidget("clock-folder"), null);
    assert.equal(registry.getWidget("@local/clock").path, dir);
    assert.ok(fs.existsSync(dir));
    registry.widgets.delete("@local/clock");
  });

  it("a single widget folder is copied under widgets/@scope/name", async () => {
    const dir = makePackage(tmp(), "my-timer", "timer");
    const [result] = await registry.registerWidgetsFromFolder(dir, false);
    assert.equal(result.name, "@local/timer");
    assert.equal(result.mode, "single");
    assert.ok(
      fs.existsSync(path.join(widgetsDir, "@local", "timer", "dash.json")),
    );
    // Uninstalling Dash's copy leaves the user's folder.
    registry.uninstallWidget("@local/timer");
    assert.ok(fs.existsSync(path.join(dir, "dash.json")));
  });
});
