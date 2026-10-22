/**
 * menuItemsController.test.js — deleting a folder (QA 2026-10-22: folders
 * couldn't be deleted at all). The folder goes; its dashboards stay, with
 * no folder (menuId null, not missing — a missing menuId reads as 1).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// The controller requires "electron"; stub it so the test runs in node.
const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-menu-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_menu__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_menu__"] = {
  id: "__stub_electron_menu__",
  filename: "__stub_electron_menu__",
  loaded: true,
  exports: { app: { getPath: () => stubDir } },
};

const controller = require("./menuItemsController");

function seed(appId, menuItems, workspaces) {
  const dir = path.join(stubDir, "Dashboard", appId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "menuItems.json"), JSON.stringify(menuItems));
  fs.writeFileSync(
    path.join(dir, "workspaces.json"),
    JSON.stringify(workspaces),
  );
  const read = (name) =>
    JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  return read;
}

describe("deleteMenuItemForApplication", () => {
  it("removes the folder and leaves its dashboards without one", () => {
    const read = seed(
      "app-a",
      [
        { id: 1, name: "Home" },
        { id: 2, name: "Work" },
      ],
      [
        { id: 10, name: "Sales", menuId: 2 },
        { id: 11, name: "Ops", menuId: "2" },
        { id: 12, name: "Notes", menuId: 1 },
      ],
    );

    const result = controller.deleteMenuItemForApplication(null, "app-a", 2);

    assert.equal(result.success, true);
    assert.equal(result.dashboardsMoved, 2);
    assert.deepEqual(read("menuItems.json"), [{ id: 1, name: "Home" }]);
    assert.deepEqual(
      read("workspaces.json").map((w) => [w.id, w.menuId]),
      [
        [10, null],
        [11, null],
        [12, 1],
      ],
    );
  });

  it("an empty folder just goes; dashboards are untouched", () => {
    const read = seed(
      "app-b",
      [{ id: 3, name: "Empty" }],
      [{ id: 20, name: "Solo", menuId: 1 }],
    );

    const result = controller.deleteMenuItemForApplication(null, "app-b", 3);

    assert.equal(result.dashboardsMoved, 0);
    assert.deepEqual(read("menuItems.json"), []);
    assert.deepEqual(read("workspaces.json"), [
      { id: 20, name: "Solo", menuId: 1 },
    ]);
  });
});
