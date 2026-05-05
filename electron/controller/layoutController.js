const { app } = require("electron");
const path = require("path");
const events = require("../events");
const { getFileContents } = require("../utils/file");

const configFilename = "layouts.json";
const appName = "Dashboard";

const layoutController = {
  /**
   *
   *
   * @param {BrowserWindow} win the main window
   * @param {string} appId the application id from Algolia
   */
  listLayoutsForApplication: (win, appId) => {
    try {
      const filename = path.join(
        app.getPath("userData"),
        appName,
        appId,
        configFilename,
      );
      const layoutsArray = getFileContents(filename);
      win.webContents.send(events.LAYOUT_LIST_COMPLETE, {
        layouts: layoutsArray,
      });
    } catch (e) {
      win.webContents.send(events.LAYOUT_LIST_COMPLETE, {
        error: true,
        message: e.message,
      });
    }
  },
};

module.exports = layoutController;
