/**
 * menuItemsApi.js
 *
 */
// ipcRenderer that must be used to invoke the events
const { ipcRenderer } = require("electron");

const {
  MENU_ITEMS_SAVE,
  MENU_ITEMS_LIST,
  MENU_ITEMS_DELETE,
} = require("../events");

const menuItemsApi = {
  saveMenuItem: (appId, menuItem) =>
    ipcRenderer.invoke(MENU_ITEMS_SAVE, { appId, menuItem }),
  listMenuItems: (appId) => ipcRenderer.invoke(MENU_ITEMS_LIST, { appId }),
  deleteMenuItem: (appId, menuItemId) =>
    ipcRenderer.invoke(MENU_ITEMS_DELETE, { appId, menuItemId }),
};

module.exports = menuItemsApi;
