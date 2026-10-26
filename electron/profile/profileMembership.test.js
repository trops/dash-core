/**
 * profileMembership.test.js — the controllers that list, create and delete
 * dashboards, folders and themes follow the active profile. Everything
 * lives once in the shared files; with only Default nothing is filtered.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// The controllers require "electron"; stub it so the test runs in node.
const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-members-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_members__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_members__"] = {
  id: "__stub_electron_members__",
  filename: "__stub_electron_members__",
  loaded: true,
  exports: {
    app: { getPath: () => stubDir },
    dialog: {},
    BrowserWindow: function () {},
    shell: {},
  },
};

const store = require("./profileStore");
const profileController = require("../controller/profileController");
const workspaceController = require("../controller/workspaceController");
const themeController = require("../controller/themeController");
const menuItemsController = require("../controller/menuItemsController");

const appId = "@test/members-app";
const appDir = path.join(stubDir, "Dashboard", appId);
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(appDir, name), "utf8"));

const dashboards = () =>
  workspaceController
    .listWorkspacesForApplication(null, appId)
    .workspaces.map((w) => w.name);
const folders = () =>
  menuItemsController
    .listMenuItemsForApplication(null, appId)
    .menuItems.map((m) => m.name);
const themes = () =>
  Object.keys(themeController.listThemesForApplication(null, appId).themes);

// No bot controller in this test.
const noBots = { applyActiveProfile() {} };

let mini;

describe("profile membership in the controllers", () => {
  before(() => {
    fs.mkdirSync(appDir, { recursive: true });
    const write = (name, data) =>
      fs.writeFileSync(path.join(appDir, name), JSON.stringify(data));
    write("workspaces.json", [
      { id: 1, name: "Home Assistant", menuId: 1, themeKey: "ha" },
      { id: 2, name: "Sales", menuId: 2, themeKey: "work" },
    ]);
    write("menuItems.json", [
      { id: 1, name: "Home" },
      { id: 2, name: "Work" },
    ]);
    write("themes.json", { ha: {}, work: {}, spare: {} });
  });

  it("with only Default, everything shows (no filtering)", () => {
    assert.deepEqual(dashboards(), ["Home Assistant", "Sales"]);
    assert.deepEqual(folders(), ["Home", "Work"]);
    assert.deepEqual(themes(), ["ha", "work", "spare"]);
    assert.equal(fs.existsSync(path.join(appDir, "profiles.json")), false);
  });

  it("creating the first profile keeps everything in Default", () => {
    const res = profileController.createProfile(appId, "Mac Mini");
    assert.equal(res.success, true, res.error);
    mini = res.profile;
    assert.deepEqual(store.members(appId, "dashboards"), ["1", "2"]);
    assert.deepEqual(store.members(appId, "folders"), ["1", "2"]);
    assert.deepEqual(store.members(appId, "themes"), ["ha", "work", "spare"]);
    assert.deepEqual(dashboards(), ["Home Assistant", "Sales"]);
  });

  it("a new profile starts empty; things made there join it", () => {
    profileController.switchProfile(appId, mini.id, { botController: noBots });
    assert.deepEqual(dashboards(), []);
    assert.deepEqual(folders(), []);
    assert.deepEqual(themes(), []);

    workspaceController.saveWorkspaceForApplication(null, appId, {
      id: 3,
      name: "Mini Only",
      themeKey: "ha",
    });
    menuItemsController.saveMenuItemForApplication(null, appId, {
      id: 3,
      name: "Mini Folder",
    });
    themeController.saveThemeForApplication(null, appId, "mini-theme", {});

    assert.deepEqual(dashboards(), ["Mini Only"]);
    assert.deepEqual(folders(), ["Mini Folder"]);
    // Its own theme, plus the one its dashboard uses.
    assert.deepEqual(themes().sort(), ["ha", "mini-theme"]);
    // Everything lives once, in the shared files.
    assert.equal(read("workspaces.json").length, 3);
  });

  it("an item in two profiles shows in both", () => {
    store.add(appId, "dashboards", 1, mini.id);
    assert.deepEqual(dashboards(), ["Home Assistant", "Mini Only"]);
  });

  it("switching back to Default shows only Default's things", () => {
    profileController.switchProfile(appId, "default", {
      botController: noBots,
    });
    assert.deepEqual(dashboards(), ["Home Assistant", "Sales"]);
    assert.deepEqual(folders(), ["Home", "Work"]);
    assert.ok(!themes().includes("mini-theme"));
  });

  it("deleting removes the item from every profile", () => {
    workspaceController.deleteWorkspaceForApplication(null, appId, 1);
    assert.deepEqual(store.members(appId, "dashboards"), ["2"]);
    assert.deepEqual(store.members(appId, "dashboards", mini.id), ["3"]);
    menuItemsController.deleteMenuItemForApplication(null, appId, 2);
    assert.deepEqual(store.members(appId, "folders"), ["1"]);
    themeController.deleteThemeForApplication(null, appId, "spare");
    assert.deepEqual(store.members(appId, "themes"), ["ha", "work"]);
  });

  it("switching tells the bot controller, and refuses unknown profiles", () => {
    let applied = 0;
    const bots = { applyActiveProfile: () => (applied += 1) };
    assert.equal(
      profileController.switchProfile(appId, mini.id, { botController: bots })
        .success,
      true,
    );
    assert.equal(applied, 1);
    const bad = profileController.switchProfile(appId, "p-nope", {
      botController: bots,
    });
    assert.equal(bad.success, false);
    assert.equal(applied, 1);
  });
});
