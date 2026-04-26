const { app } = require("electron");
const path = require("path");
const { writeFileSync } = require("fs");
const events = require("../events");
const { getFileContents } = require("../utils/file");
const { upsertMenuItem } = require("../utils/upsertMenuItem");

const configFilename = "menuItems.json";
const appName = "Dashboard";

const menuItemsController = {
  saveMenuItemForApplication: (win, appId, menuItem) => {
    try {
      const filename = path.join(
        app.getPath("userData"),
        appName,
        appId,
        configFilename,
      );
      const raw = getFileContents(filename) || [];
      const deduped = upsertMenuItem(raw, menuItem);
      writeFileSync(filename, JSON.stringify(deduped, null, 2));
      console.log("[menuItemsController] Menu item saved successfully");
      return { menuItems: deduped, success: true };
    } catch (e) {
      console.error("[menuItemsController] Error saving menu item:", e);
      return { error: true, message: e.message, menuItems: [] };
    }
  },

  listMenuItemsForApplication: (win, appId) => {
    try {
      const filename = path.join(
        app.getPath("userData"),
        appName,
        appId,
        configFilename,
      );
      const menuItemsArray = getFileContents(filename);
      const filtered = menuItemsArray.filter((mi) => mi !== null);
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
};

module.exports = menuItemsController;
