/**
 * notificationApi.js
 *
 * Preload-side IPC bindings for the notification system.
 * Exposed to the renderer via mainApi.notifications.
 */
const { ipcRenderer } = require("electron");
const {
  NOTIFICATION_SEND,
  NOTIFICATION_GET_PREFERENCES,
  NOTIFICATION_SET_PREFERENCES,
  NOTIFICATION_SET_GLOBAL,
} = require("../events");

const notificationApi = {
  /**
   * Send a notification to the OS.
   *
   * @param {Object} payload - { widgetName, widgetId, workspaceId, type, title, body, data?, silent?, urgency? }
   * @returns {Promise<{ success: boolean, reason?: string }>}
   */
  send: (payload) => ipcRenderer.invoke(NOTIFICATION_SEND, payload),

  /**
   * Get all notification preferences (global + per-instance).
   *
   * @returns {Promise<{ globalEnabled: boolean, doNotDisturb: boolean, instances: Object }>}
   */
  getPreferences: () => ipcRenderer.invoke(NOTIFICATION_GET_PREFERENCES),

  /**
   * Set per-widget-instance notification preferences.
   *
   * @param {string} widgetId - widget instance UUID
   * @param {Object} prefs - { [notificationType]: boolean }
   * @returns {Promise<{ success: boolean }>}
   */
  setPreferences: (widgetId, prefs) =>
    ipcRenderer.invoke(NOTIFICATION_SET_PREFERENCES, { widgetId, prefs }),

  /**
   * Set global notification settings (enabled, DND).
   *
   * @param {Object} settings - { globalEnabled?: boolean, doNotDisturb?: boolean }
   * @returns {Promise<{ success: boolean }>}
   */
  setGlobal: (settings) =>
    ipcRenderer.invoke(NOTIFICATION_SET_GLOBAL, settings),

  /**
   * Listen for notification click events from the main process.
   *
   * @param {Function} callback - ({ widgetName, widgetId, workspaceId, type, data }) => void
   * @returns {Function} removeListener function
   */
  onClicked: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("notification:clicked", handler);
    return () => ipcRenderer.removeListener("notification:clicked", handler);
  },
};

module.exports = notificationApi;
