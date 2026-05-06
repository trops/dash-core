/**
 * widgetMountTokenController.js
 *
 * IPC handlers for the widget mount-token registry. Called by
 * `WidgetFactory` at React mount/unmount time. Returns a fresh
 * server-generated token that the widget framework bakes into the
 * widget's bound API; the renderer never picks the token itself.
 *
 * See `electron/security/mountTokenRegistry.js` for the registry and
 * the longer threat-model note.
 *
 * Channels:
 *   - "framework:register-widget-mount" (widgetId) → token string
 *   - "framework:unregister-widget-mount" (token) → boolean (true = unregistered)
 */
"use strict";

const { ipcMain } = require("electron");
const { register, unregister } = require("../security/mountTokenRegistry");

function setupWidgetMountTokenHandlers() {
  ipcMain.handle("framework:register-widget-mount", (_event, widgetId) => {
    if (typeof widgetId !== "string" || widgetId.length === 0) {
      return null;
    }
    try {
      return register(widgetId);
    } catch {
      return null;
    }
  });

  ipcMain.handle("framework:unregister-widget-mount", (_event, token) => {
    if (typeof token !== "string" || token.length === 0) return false;
    unregister(token);
    return true;
  });
}

module.exports = { setupWidgetMountTokenHandlers };
