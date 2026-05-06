/**
 * resolveSiblings.js
 *
 * Pure helper that maps a grant-keyed widgetId (e.g.
 * "trops.google-drive.GDriveFilePreview") to the package it belongs to
 * and the dotted ids of every currently-installed widget in that
 * package. Used by the JIT consent flow to offer "Apply to all widgets
 * from <package>" — the JIT modal renders a checkbox when
 * `siblingWidgetIds.length > 1`, and on approval the gate's batch-write
 * path persists the same grant to each sibling.
 *
 * Source of truth is the renderer-process WidgetRegistry's `widgets`
 * Map (`getWidgetRegistry().widgets`), passed in here as a snapshot
 * so this helper stays pure and testable. Both Map and plain-object
 * shapes are accepted.
 *
 * Conversion: registry keys are scoped (`@trops/google-drive`); grant
 * keys are dotted (`trops.google-drive.GDriveFileList`). The mapping
 * for each entry is `@<scope>/<name>` + `<componentName>` →
 * `<scope>.<name>.<componentName>`. Bare-name lookup uses the LAST
 * dot-segment of the input widgetId so 3-part scope.pkg.component ids
 * resolve correctly.
 */
"use strict";

const FALLBACK = (widgetId) => ({
  packageId: null,
  siblingWidgetIds: typeof widgetId === "string" && widgetId ? [widgetId] : [],
});

function _bareNameFromWidgetId(widgetId) {
  const idx = widgetId.lastIndexOf(".");
  return idx >= 0 ? widgetId.slice(idx + 1) : widgetId;
}

function _toGrantId(packageId, componentName) {
  // "@trops/google-drive" + "GDriveFileList" → "trops.google-drive.GDriveFileList"
  // Strip leading "@" and replace the first "/" with ".".
  let stripped = packageId.startsWith("@") ? packageId.slice(1) : packageId;
  stripped = stripped.replace("/", ".");
  return stripped + "." + componentName;
}

function _entries(snapshot) {
  if (!snapshot) return [];
  if (typeof snapshot.entries === "function") {
    // Map (or anything with Map-like .entries())
    return Array.from(snapshot.entries());
  }
  if (typeof snapshot === "object") {
    return Object.entries(snapshot);
  }
  return [];
}

/**
 * @param {string} widgetId — grant-keyed widget id
 * @param {Map<string, object>|object} registrySnapshot — getWidgetRegistry().widgets
 * @returns {{ packageId: string|null, siblingWidgetIds: string[] }}
 */
function resolveSiblings(widgetId, registrySnapshot) {
  if (typeof widgetId !== "string" || !widgetId) return FALLBACK(widgetId);

  const bareName = _bareNameFromWidgetId(widgetId);
  if (!bareName) return FALLBACK(widgetId);

  for (const [, entry] of _entries(registrySnapshot)) {
    if (!entry || typeof entry !== "object") continue;
    const names = Array.isArray(entry.componentNames)
      ? entry.componentNames
      : null;
    if (!names || names.length === 0) continue;
    if (!names.includes(bareName)) continue;
    const packageId =
      typeof entry.packageId === "string" && entry.packageId
        ? entry.packageId
        : null;
    if (!packageId) continue;
    return {
      packageId,
      siblingWidgetIds: names.map((n) => _toGrantId(packageId, n)),
    };
  }

  return FALLBACK(widgetId);
}

module.exports = { resolveSiblings };
