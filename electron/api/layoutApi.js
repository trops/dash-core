/**
 * layoutApi.js
 *
 * Handle the layout configuration file
 */
// ipcRenderer that must be used to invoke the events
const { ipcRenderer } = require("electron");

const { LAYOUT_LIST } = require("../events");

const layoutApi = {
  listLayoutsForApplication: (appId) =>
    ipcRenderer.invoke(LAYOUT_LIST, { appId }),
};

module.exports = layoutApi;
