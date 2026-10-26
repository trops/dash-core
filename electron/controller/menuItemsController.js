const path = require("path");
const { writeFileSync } = require("fs");
const events = require("../events");
const { getFileContents } = require("../utils/file");
const { getAppFilePath, getAppDataDir } = require("../utils/appPaths");
const {
  filterToActive,
  addToActive,
  removeEverywhere,
} = require("../profile/profileMembership");
const { upsertMenuItem } = require("../utils/upsertMenuItem");

const configFilename = "menuItems.json";

const menuItemsController = {
  saveMenuItemForApplication: (win, appId, menuItem) => {
    try {
      const filename = getAppFilePath(appId, configFilename);
      const raw = getFileContents(filename) || [];
      const deduped = upsertMenuItem(raw, menuItem);
      writeFileSync(filename, JSON.stringify(deduped, null, 2));
      if (menuItem && menuItem.id != null) {
        addToActive(appId, "folders", menuItem.id);
      }
      console.log("[menuItemsController] Menu item saved successfully");
      return {
        menuItems: filterToActive(appId, "folders", deduped, (m) => m.id),
        success: true,
      };
    } catch (e) {
      console.error("[menuItemsController] Error saving menu item:", e);
      return { error: true, message: e.message, menuItems: [] };
    }
  },

  listMenuItemsForApplication: (win, appId) => {
    try {
      const filename = getAppFilePath(appId, configFilename);
      const menuItemsArray = getFileContents(filename);
      const filtered = filterToActive(
        appId,
        "folders",
        menuItemsArray.filter((mi) => mi !== null),
        (m) => m.id,
      );
      // Return the data for ipcMain.handle() - modern promise-based approach
      return {
        menuItems: filtered,
      };
    } catch (e) {
      console.error("[menuItemsController] Error listing menu items:", e);
      // Return error object with empty menu items array
      return {
        error: true,
        message: e.message,
        menuItems: [],
      };
    }
  },

  // Deletes a folder. Its dashboards stay, with no folder (menuId null —
  // a missing menuId would read as folder 1), as the confirm says.
  deleteMenuItemForApplication: (win, appId, menuItemId) => {
    try {
      const dir = getAppDataDir(appId);
      const result = deleteMenuItemFromFiles(
        path.join(dir, configFilename),
        path.join(dir, "workspaces.json"),
        menuItemId,
      );
      removeEverywhere(appId, "folders", menuItemId);
      return {
        ...result,
        menuItems: filterToActive(
          appId,
          "folders",
          result.menuItems,
          (m) => m.id,
        ),
      };
    } catch (e) {
      console.error("[menuItemsController] Error deleting menu item:", e);
      return { error: true, message: e.message, menuItems: [] };
    }
  },
};

function deleteMenuItemFromFiles(menuFile, workspacesFile, menuItemId) {
  const same = (id) => id != null && String(id) === String(menuItemId);
  const menuItems = (getFileContents(menuFile) || []).filter(
    (mi) => mi && !same(mi.id),
  );
  const workspaces = getFileContents(workspacesFile) || [];
  let moved = 0;
  const nextWorkspaces = workspaces.map((ws) => {
    if (!ws || !same(ws.menuId)) return ws;
    moved += 1;
    return { ...ws, menuId: null };
  });
  // Dashboards first: a failure here leaves the folder, never orphans.
  if (moved > 0) {
    writeFileSync(workspacesFile, JSON.stringify(nextWorkspaces, null, 2));
  }
  writeFileSync(menuFile, JSON.stringify(menuItems, null, 2));
  return { success: true, menuItems, dashboardsMoved: moved };
}

module.exports = menuItemsController;
module.exports.deleteMenuItemFromFiles = deleteMenuItemFromFiles;
