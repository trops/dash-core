/**
 * profilePaths.test.js — every per-profile controller reads and writes
 * the active profile's folder. With no profiles.json that is the same
 * Dashboard/<appId>/ folder as before profiles existed; after a switch,
 * none of them may still read Default's files.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// The controllers require "electron"; stub it so the test runs in node.
const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-ppaths-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_ppaths__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_ppaths__"] = {
  id: "__stub_electron_ppaths__",
  filename: "__stub_electron_ppaths__",
  loaded: true,
  exports: {
    app: { getPath: () => stubDir },
    dialog: {},
    BrowserWindow: function () {},
    shell: {},
  },
};

const store = require("./profileStore");
const { getProfileDataDir, getProfileFilePath } = require("./profilePaths");
const workspaceController = require("../controller/workspaceController");
const themeController = require("../controller/themeController");
const menuItemsController = require("../controller/menuItemsController");
const ratings = require("../controller/dashboardRatingsController");

const appId = "@test/paths-app";
const defaultDir = path.join(stubDir, "Dashboard", appId);

function seed(dir, label) {
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, data) =>
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  write("workspaces.json", [{ id: 1, name: `${label} dashboard` }]);
  write("themes.json", { [`${label}-theme`]: { name: label } });
  write("menuItems.json", [{ id: 1, name: `${label} folder` }]);
}

describe("profilePaths", () => {
  before(() => seed(defaultDir, "default"));

  it("with no profiles.json, uses the same folder as before profiles", () => {
    assert.equal(getProfileDataDir(appId), defaultDir);
    assert.equal(
      getProfileFilePath(appId, "workspaces.json"),
      path.join(defaultDir, "workspaces.json"),
    );
    assert.deepEqual(
      workspaceController
        .listWorkspacesForApplication(null, appId)
        .workspaces.map((w) => w.name),
      ["default dashboard"],
    );
    assert.deepEqual(
      Object.keys(themeController.listThemesForApplication(null, appId).themes),
      ["default-theme"],
    );
    assert.deepEqual(
      menuItemsController
        .listMenuItemsForApplication(null, appId)
        .menuItems.map((m) => m.name),
      ["default folder"],
    );
    assert.equal(fs.existsSync(path.join(defaultDir, "profiles.json")), false);
  });

  it("after a switch, every controller reads and writes the new profile only", () => {
    const profile = store.create(appId, "Mac Mini");
    const profileDir = path.join(defaultDir, "profiles", profile.id);
    seed(profileDir, "mini");
    store.setActive(appId, profile.id);

    assert.equal(getProfileDataDir(appId), profileDir);
    assert.deepEqual(
      workspaceController
        .listWorkspacesForApplication(null, appId)
        .workspaces.map((w) => w.name),
      ["mini dashboard"],
    );
    assert.deepEqual(
      Object.keys(themeController.listThemesForApplication(null, appId).themes),
      ["mini-theme"],
    );
    assert.deepEqual(
      menuItemsController
        .listMenuItemsForApplication(null, appId)
        .menuItems.map((m) => m.name),
      ["mini folder"],
    );

    workspaceController.saveWorkspaceForApplication(null, appId, {
      id: 2,
      name: "Home Assistant",
    });
    themeController.saveThemeForApplication(null, appId, "new-theme", {});
    menuItemsController.saveMenuItemForApplication(null, appId, {
      id: 2,
      name: "Home",
    });
    const rated = ratings.saveDashboardRating(appId, "@trops/x", {
      stars: 5,
    });
    assert.equal(rated.success, true, JSON.stringify(rated));

    const read = (dir, name) =>
      JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    assert.equal(read(profileDir, "workspaces.json").length, 2);
    assert.ok(read(profileDir, "themes.json")["new-theme"]);
    assert.equal(read(profileDir, "menuItems.json").length, 2);
    assert.ok(read(profileDir, "dashboard-ratings.json")["@trops/x"]);
    assert.equal(
      fs.existsSync(path.join(defaultDir, "dashboard-ratings.json")),
      false,
    );

    // Default is untouched.
    assert.deepEqual(read(defaultDir, "workspaces.json"), [
      { id: 1, name: "default dashboard" },
    ]);
    assert.equal(read(defaultDir, "themes.json")["new-theme"], undefined);
    assert.equal(read(defaultDir, "menuItems.json").length, 1);
  });

  it("deleting a folder only touches the active profile's dashboards", () => {
    const result = menuItemsController.deleteMenuItemForApplication(
      null,
      appId,
      1,
    );
    assert.equal(result.success, true);
    const defaultMenus = JSON.parse(
      fs.readFileSync(path.join(defaultDir, "menuItems.json"), "utf8"),
    );
    assert.equal(defaultMenus.length, 1);
  });

  it("switching back reads Default again", () => {
    store.setActive(appId, store.DEFAULT_PROFILE_ID);
    assert.deepEqual(
      workspaceController
        .listWorkspacesForApplication(null, appId)
        .workspaces.map((w) => w.name),
      ["default dashboard"],
    );
  });
});
