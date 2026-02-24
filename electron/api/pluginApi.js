/**
 * pluginApi.js
 *
 * Plugin management API for the renderer process.
 */
// ipcRenderer that must be used to invoke the events
const { ipcRenderer } = require("electron");

const pluginApi = {
    install: (packageName, filepath) =>
        ipcRenderer.invoke("plugin-install", { packageName, filepath }),
    uninstall: (filepath) => ipcRenderer.invoke("plugin-uninstall", filepath),
};

module.exports = pluginApi;
