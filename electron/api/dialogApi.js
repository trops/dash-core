/**
 * dialogApi.js
 *
 * Dialog API exposed to renderer via contextBridge.
 * Provides file/folder chooser dialogs.
 */
const { ipcRenderer } = require("electron");

const { CHOOSE_FILE } = require("../events");

const dialogApi = {
  /**
   * chooseFile — open a file or folder picker.
   *
   * @param {boolean} allowFile - true for file picker, false for folder picker
   * @param {string[]} extensions - allowed file extensions (e.g., ["json", "csv"])
   * @returns {Promise<string|null>} selected file/folder path, or null if cancelled
   */
  chooseFile: (allowFile = true, extensions = ["*"]) => {
    return ipcRenderer.invoke(CHOOSE_FILE, { allowFile, extensions });
  },

  /**
   * showDialog — compatibility wrapper matching the Electron dialog.showOpenDialog shape.
   *
   * Widgets call this as:
   *   const result = await window.mainApi.dialog.showDialog(options, allowFile, extensions)
   *
   * Returns { canceled: boolean, filePaths: string[] } to match the shape
   * that existing widgets (AlgoliaExportWidget, AlgoliaBatchManagerWidget) expect.
   *
   * @param {object} options - { allowFile, extensions } or unused options object
   * @param {boolean} allowFile - true for file picker, false for folder picker
   * @param {string[]} extensions - allowed file extensions
   * @returns {Promise<{ canceled: boolean, filePaths: string[] }>}
   */
  showDialog: async (options = {}, allowFile = true, extensions = ["*"]) => {
    // Support both calling conventions:
    //   showDialog({ allowFile: true, extensions: ["json"] })
    //   showDialog({}, true, ["json"])
    const resolvedAllowFile =
      typeof options.allowFile === "boolean" ? options.allowFile : allowFile;
    const resolvedExtensions = options.extensions || extensions;

    const filePath = await ipcRenderer.invoke(CHOOSE_FILE, {
      allowFile: resolvedAllowFile,
      extensions: resolvedExtensions,
    });

    if (!filePath) {
      return { canceled: true, filePaths: [] };
    }
    return { canceled: false, filePaths: [filePath] };
  },
};

module.exports = dialogApi;
