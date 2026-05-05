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
const { buildGrantsListing } = require("./widgetMcpGrantsListing");

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

  // Joins all installed widgets with their declared manifests + persisted
  // grants. Returns ONE row per installed widget regardless of whether it
  // has a manifest or grant — that's how the Settings panel can offer
  // "Grant manually" for unmanifested widgets. Plus orphan-grant rows for
  // granted-but-uninstalled cases. Logic delegated to
  // widgetMcpGrantsListing.buildGrantsListing for unit-testability.
  ipcMain.handle("widget-mcp:list-all", () => {
    const grantsByWidget = new Map();
    for (const { widgetId, granted } of listAllGrants()) {
      grantsByWidget.set(widgetId, granted);
    }

    let installedWidgets = [];
    try {
      installedWidgets = getWidgetRegistry().getWidgets() || [];
    } catch (_e) {
      // Registry not initialized yet; fall back to grants-only listing.
    }

    const declaredByWidget = new Map();
    for (const w of installedWidgets) {
      const widgetId = w?.name;
      if (!widgetId) continue;
      const declared = getWidgetMcpPermissions(widgetId);
      if (declared) declaredByWidget.set(widgetId, declared);
    }

    return buildGrantsListing(
      installedWidgets,
      grantsByWidget,
      declaredByWidget,
    );
  });
}

module.exports = { setupWidgetMcpGrantsHandlers };
