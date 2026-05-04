/**
 * widgetMcpGrantsController.js
 *
 * IPC handlers for the Slice-2 user-grant store. The renderer reads/writes
 * grants via these channels: install consent modal calls `widget-mcp:set-grant`
 * with the user's selections, Settings → Privacy & Security calls
 * `widget-mcp:list-all` to render the grant audit, and either entry point can
 * call `widget-mcp:revoke` / `widget-mcp:revoke-server`.
 *
 * The list-all handler joins each grant with its declared manifest so the UI
 * can show declared-vs-granted diffs (declared paths the user did NOT grant
 * are rendered struck through, etc.). Widgets that have a manifest but no
 * grant are also surfaced — those are the install-consent retroactive prompts.
 */
"use strict";

const { ipcMain } = require("electron");
const {
  getGrant,
  setGrant,
  revokeGrant,
  revokeServer,
  listAllGrants,
} = require("../mcp/grantedPermissions");
const { getWidgetMcpPermissions } = require("../mcp/widgetPermissions");
const { getWidgetRegistry } = require("../widgetRegistry");

function setupWidgetMcpGrantsHandlers() {
  ipcMain.handle("widget-mcp:get-grant", (event, widgetId) => {
    return getGrant(widgetId);
  });

  ipcMain.handle("widget-mcp:set-grant", (event, widgetId, perms) => {
    return setGrant(widgetId, perms);
  });

  ipcMain.handle("widget-mcp:revoke", (event, widgetId) => {
    return revokeGrant(widgetId);
  });

  ipcMain.handle("widget-mcp:revoke-server", (event, widgetId, serverName) => {
    return revokeServer(widgetId, serverName);
  });

  // Joins all installed widgets with their declared and granted permission
  // blocks. Returns one row per widget that has a declared manifest OR a
  // grant — this surfaces both "freshly installed, awaiting consent" and
  // "previously granted, now reviewable" cases in Settings.
  ipcMain.handle("widget-mcp:list-all", () => {
    const grantsByWidget = new Map();
    for (const { widgetId, granted } of listAllGrants()) {
      grantsByWidget.set(widgetId, granted);
    }

    const rows = [];
    const seen = new Set();

    let installedWidgets = [];
    try {
      installedWidgets = getWidgetRegistry().getWidgets() || [];
    } catch (_e) {
      // Registry not initialized yet; fall back to grants-only listing.
    }

    for (const w of installedWidgets) {
      const widgetId = w?.name;
      if (!widgetId || seen.has(widgetId)) continue;
      seen.add(widgetId);
      const declared = getWidgetMcpPermissions(widgetId);
      const granted = grantsByWidget.get(widgetId) || null;
      // Skip widgets with neither — they have nothing to show.
      if (!declared && !granted) continue;
      rows.push({ widgetId, declared, granted });
    }

    // Surface any grants whose widget is no longer installed (rare, but
    // possible if uninstall didn't revoke). The user can still revoke them.
    for (const [widgetId, granted] of grantsByWidget) {
      if (seen.has(widgetId)) continue;
      rows.push({ widgetId, declared: null, granted });
    }

    return rows;
  });
}

module.exports = { setupWidgetMcpGrantsHandlers };
