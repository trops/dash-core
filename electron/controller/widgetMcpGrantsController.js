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

const { ipcMain, dialog, BrowserWindow } = require("electron");
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
const { isBroadening } = require("./grantDiff");

// Native confirm dialog for any set-grant call that broadens the
// widget's current permissions. The dialog runs at OS level — a
// renderer (including a malicious widget) cannot dismiss it
// programmatically. This is the defense-in-depth fix for the
// `widget-mcp:set-grant` consent-bypass gap documented in the IPC
// audit doc: a widget calling `mainApi.widgetMcp.setGrant("@self",
// {wide-open perms})` now triggers a system-level prompt the user
// must explicitly approve. Reductions / equality pass unprompted.
async function _confirmBroadening(event, widgetId, summary) {
  const senderWindow =
    BrowserWindow.fromWebContents(event.sender) ||
    BrowserWindow.getFocusedWindow();
  // Cap the listed lines so the dialog body stays readable.
  const MAX_LINES = 20;
  const trimmed = summary.slice(0, MAX_LINES);
  const overflow =
    summary.length > MAX_LINES
      ? `\n  …and ${summary.length - MAX_LINES} more`
      : "";
  const detail =
    "Widget '" +
    widgetId +
    "' will be granted the following NEW permissions:\n\n  " +
    trimmed.join("\n  ") +
    overflow +
    "\n\nIf you didn't initiate this from Settings → Privacy & Security, " +
    "click Cancel — a malicious widget may be trying to escalate its own " +
    "permissions.";

  const result = await dialog.showMessageBox(senderWindow, {
    type: "warning",
    title: "Confirm permissions change",
    message: "Allow new permissions for " + widgetId + "?",
    detail,
    buttons: ["Cancel", "Allow"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}

function setupWidgetMcpGrantsHandlers() {
  ipcMain.handle("widget-mcp:get-grant", (event, widgetId) => {
    return getGrant(widgetId);
  });

  ipcMain.handle("widget-mcp:set-grant", async (event, widgetId, perms) => {
    const current = getGrant(widgetId);
    const diff = isBroadening(current, perms);
    if (diff.broadening) {
      const approved = await _confirmBroadening(event, widgetId, diff.summary);
      if (!approved) return false;
    }
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
    // Also resolve declared blocks for every dotted-form grant key.
    // getWidgetMcpPermissions translates dotted ids to npm package
    // paths internally, so the same package's manifest is shared
    // across all of its components. Without this, orphan-grant rows
    // ship to the renderer with declared:null and every granted tool
    // looks "stale" in Settings → Privacy.
    for (const widgetId of grantsByWidget.keys()) {
      if (declaredByWidget.has(widgetId)) continue;
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
