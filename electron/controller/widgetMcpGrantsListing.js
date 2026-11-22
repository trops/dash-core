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
 *     grantOrigin: string|null, // "declared" | "discovered" | "manual" | null
 *     instances: [{ key, instanceId, granted }]
 *   }
 *
 * `instances` are the grants of single placed widgets of this type
 * (DASH-46), kept under "<widgetId>#<instanceId>". They're listed under
 * their type's row — never as rows of their own — so each can be revoked
 * by its key.
 *
 * Includes ALL installed widgets (even unmanifested + ungranted) so the
 * panel can offer "Grant manually" for every widget. Also surfaces
 * orphan grants (granted but uninstalled — rare, only happens if
 * uninstall didn't revoke).
 */
"use strict";

const INSTANCE_SEPARATOR = "#";

/** "<widgetId>#<instanceId>" → { widgetId, instanceId }, else null. */
function parseInstanceKey(key) {
  if (typeof key !== "string") return null;
  const at = key.indexOf(INSTANCE_SEPARATOR);
  if (at <= 0 || at === key.length - 1) return null;
  return { widgetId: key.slice(0, at), instanceId: key.slice(at + 1) };
}

function _originOf(grant) {
  return grant &&
    typeof grant === "object" &&
    typeof grant.grantOrigin === "string"
    ? grant.grantOrigin
    : null;
}

function buildGrantsListing(
  installedWidgets,
  grantsByWidgetId,
  declaredByWidgetId,
) {
  const rows = [];
  const seen = new Set();

  const installed = Array.isArray(installedWidgets) ? installedWidgets : [];
  const allGrants =
    grantsByWidgetId instanceof Map ? grantsByWidgetId : new Map();
  const declared =
    declaredByWidgetId instanceof Map ? declaredByWidgetId : new Map();

  // Split the type grants from the placed widgets' own grants.
  const grants = new Map();
  const instancesByType = new Map();
  for (const [key, grant] of allGrants) {
    const parsed = parseInstanceKey(key);
    if (!parsed) {
      grants.set(key, grant);
      continue;
    }
    if (!instancesByType.has(parsed.widgetId)) {
      instancesByType.set(parsed.widgetId, []);
    }
    instancesByType
      .get(parsed.widgetId)
      .push({ key, instanceId: parsed.instanceId, granted: grant });
  }

  const rowFor = (widgetId, grant) => {
    const decl = declared.get(widgetId) || null;
    return {
      widgetId,
      declared: decl,
      granted: grant,
      hasManifest: decl !== null,
      grantOrigin: _originOf(grant),
      instances: instancesByType.get(widgetId) || [],
    };
  };

  for (const w of installed) {
    if (!w || typeof w !== "object") continue;
    const widgetId = w.name;
    if (typeof widgetId !== "string" || !widgetId) continue;
    if (seen.has(widgetId)) continue;
    seen.add(widgetId);
    rows.push(rowFor(widgetId, grants.get(widgetId) || null));
  }

  // Orphan grants: granted but not in the installed list. Honor any
  // declared block the controller resolved for this dotted-form grant
  // key — see widgetPermissions.dottedComponentIdToPackageId, which
  // bridges grant keys (`trops.gmail.GmailCompose`) to on-disk package
  // paths (`@trops/gmail`).
  for (const [widgetId, grant] of grants) {
    if (seen.has(widgetId)) continue;
    seen.add(widgetId);
    rows.push(rowFor(widgetId, grant));
  }

  // Placed widgets whose type is neither installed nor granted: one
  // orphan row for the type, carrying them.
  for (const widgetId of instancesByType.keys()) {
    if (seen.has(widgetId)) continue;
    seen.add(widgetId);
    rows.push(rowFor(widgetId, null));
  }

  return rows;
}

module.exports = { buildGrantsListing, parseInstanceKey };
