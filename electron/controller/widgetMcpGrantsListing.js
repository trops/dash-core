/**
 * widgetMcpGrantsListing.js
 *
 * Pure helper that joins three data sources into rows for the
 * Settings → Privacy & Security panel:
 *   - installed widgets (from widgetRegistry.getWidgets())
 *   - persisted grants (from grantedPermissions.listAllGrants())
 *   - declared manifests (from widgetPermissions.getWidgetMcpPermissions())
 *
 * Output row shape:
 *   {
 *     widgetId: string,
 *     declared: object|null,    // dash.permissions.mcp block from package.json
 *     granted: object|null,     // user grant from widgetMcpGrants.json
 *     hasManifest: boolean,     // declared !== null
 *     grantOrigin: string|null  // "declared" | "discovered" | "manual" | null
 *   }
 *
 * Includes ALL installed widgets (even unmanifested + ungranted) so the
 * panel can offer "Grant manually" for every widget. Also surfaces
 * orphan grants (granted but uninstalled — rare, only happens if
 * uninstall didn't revoke).
 */
"use strict";

function buildGrantsListing(
  installedWidgets,
  grantsByWidgetId,
  declaredByWidgetId,
) {
  const rows = [];
  const seen = new Set();

  const installed = Array.isArray(installedWidgets) ? installedWidgets : [];
  const grants = grantsByWidgetId instanceof Map ? grantsByWidgetId : new Map();
  const declared =
    declaredByWidgetId instanceof Map ? declaredByWidgetId : new Map();

  for (const w of installed) {
    if (!w || typeof w !== "object") continue;
    const widgetId = w.name;
    if (typeof widgetId !== "string" || !widgetId) continue;
    if (seen.has(widgetId)) continue;
    seen.add(widgetId);

    const decl = declared.get(widgetId) || null;
    const grant = grants.get(widgetId) || null;
    const grantOrigin =
      grant &&
      typeof grant === "object" &&
      typeof grant.grantOrigin === "string"
        ? grant.grantOrigin
        : null;

    rows.push({
      widgetId,
      declared: decl,
      granted: grant,
      hasManifest: decl !== null,
      grantOrigin,
    });
  }

  // Orphan grants: granted but not in the installed list. Honor any
  // declared block the controller resolved for this dotted-form grant
  // key — see widgetPermissions.dottedComponentIdToPackageId, which
  // bridges grant keys (`trops.gmail.GmailCompose`) to on-disk package
  // paths (`@trops/gmail`).
  for (const [widgetId, grant] of grants) {
    if (seen.has(widgetId)) continue;
    const grantOrigin =
      grant &&
      typeof grant === "object" &&
      typeof grant.grantOrigin === "string"
        ? grant.grantOrigin
        : null;
    const decl = declared.get(widgetId) || null;
    rows.push({
      widgetId,
      declared: decl,
      granted: grant,
      hasManifest: decl !== null,
      grantOrigin,
    });
  }

  return rows;
}

module.exports = { buildGrantsListing };
