/**
 * widgetRegistryUninstall.test.js — uninstall deletes only what Dash owns.
 * A folder of widgets loads in place, so uninstalling one of them must
 * forget it and leave the user's folder alone (QA 2026-10-22: it deleted
 * the user's source folder).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// widgetRegistry requires "electron"; stub it so the test runs in node.
const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-uninst-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_uninstall__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_uninstall__"] = {
  id: "__stub_electron_uninstall__",
  filename: "__stub_electron_uninstall__",
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
const { isInsideWidgetsDir } = WidgetRegistry;

const registry = new WidgetRegistry();
const widgetsDir = path.join(stubDir, "widgets");

function makeWidget(dir) {
  fs.mkdirSync(path.join(dir, "widgets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dash.json"), "{}");
  fs.writeFileSync(path.join(dir, "widgets", "Clock.js"), "x");
  return dir;
}

function registered(name) {
  const saved = JSON.parse(
    fs.readFileSync(path.join(widgetsDir, "registry.json"), "utf8"),
  );
  return saved.widgets.some(([key]) => key === name);
}

describe("uninstallWidget", () => {
  it("forgets a widget loaded from the user's folder and keeps the folder", () => {
    const userFolder = fs.mkdtempSync(path.join(os.tmpdir(), "zz-my-widgets-"));
    const widgetPath = makeWidget(path.join(userFolder, "clock"));
    registry.registerWidget("clock", { name: "clock" }, widgetPath, false);

    assert.equal(registry.uninstallWidget("clock"), true);
    assert.equal(
      fs.existsSync(path.join(widgetPath, "widgets", "Clock.js")),
      true,
    );
    assert.equal(registry.getWidget("clock"), null);
    assert.equal(registered("clock"), false);
  });

  it("deletes a widget installed into the widgets folder", () => {
    const widgetPath = makeWidget(path.join(widgetsDir, "@me", "timer"));
    registry.registerWidget("@me/timer", { name: "timer" }, widgetPath, false);

    assert.equal(registry.uninstallWidget("@me/timer"), true);
    assert.equal(fs.existsSync(widgetPath), false);
    // The emptied scope folder goes too.
    assert.equal(fs.existsSync(path.join(widgetsDir, "@me")), false);
    assert.equal(registry.getWidget("@me/timer"), null);
  });

  it("doesn't follow a link in the widgets folder to the user's folder", () => {
    const userFolder = fs.mkdtempSync(path.join(os.tmpdir(), "zz-linked-"));
    const target = makeWidget(path.join(userFolder, "notes"));
    const link = path.join(widgetsDir, "notes");
    fs.symlinkSync(target, link, "dir");
    registry.registerWidget("notes", { name: "notes" }, link, false);

    assert.equal(registry.uninstallWidget("notes"), true);
    assert.equal(fs.existsSync(path.join(target, "dash.json")), true);
    assert.equal(registry.getWidget("notes"), null);
  });
});

describe("isInsideWidgetsDir", () => {
  it("is true only strictly inside the widgets folder", () => {
    const inside = makeWidget(path.join(widgetsDir, "inside"));
    assert.equal(isInsideWidgetsDir(inside), true);
    assert.equal(isInsideWidgetsDir(widgetsDir), false);
    assert.equal(isInsideWidgetsDir(stubDir), false);
    assert.equal(isInsideWidgetsDir(path.join(widgetsDir, "missing")), false);
  });

  it("isn't fooled by a sibling whose name starts with the folder's", () => {
    const sibling = makeWidget(path.join(stubDir, "widgets-old", "x"));
    assert.equal(isInsideWidgetsDir(sibling), false);
  });
});
