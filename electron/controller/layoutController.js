const events = require("../events");
const { getFileContents } = require("../utils/file");
const { getProfileFilePath } = require("../profile/profilePaths");

const configFilename = "layouts.json";

const layoutController = {
  /**
   *
   *
   * @param {BrowserWindow} win the main window
   * @param {string} appId the application id from Algolia
   */
  listLayoutsForApplication: (win, appId) => {
    try {
      const filename = getProfileFilePath(appId, configFilename);
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
