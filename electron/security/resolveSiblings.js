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
 * `<scope>.<name>.<componentName>`.
 *
 * Resolution strategy:
 *
 *   1. SCOPED PATH (preferred): a 3-part widgetId carries the package
 *      identity in its first two segments. We rebuild `@scope/pkg` from
 *      those segments and look the package up directly in the registry.
 *      That keeps two packages exporting the same bare component name
 *      from cross-contaminating each other's grant scope.
 *
 *   2. LEGACY BARE-NAME FALLBACK: for legacy widget ids that don't
 *      carry scope (1- or 2-segment ids), walk the registry and match
 *      on the last dot-segment. Honours `entry.packageId` when present
 *      so the returned sibling set is correctly mapped.
 *
 * The scoped-first strategy was added after a bare-name collision
 * caused JIT consent for a widget in `@ai-built/prompt-validation` to
 * resolve siblings under `@trops/google-drive` (both packages
 * happened to ship a `GoogleDriveRecentFiles` component). The grant
 * subsequently landed on the wrong package's widgets entirely. Don't
 * regress this — the test file pins the collision case explicitly.
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

/**
 * Pull `@scope/pkg` out of a 3-part dotted widgetId. Returns null for
 * any input that isn't exactly 3 dot-segments — 1- and 2-segment ids
 * fall through to the legacy bare-name path.
 */
function _packageIdFromScopedWidgetId(widgetId) {
  const parts = widgetId.split(".");
  if (parts.length !== 3) return null;
  if (!parts[0] || !parts[1] || !parts[2]) return null;
  return `@${parts[0]}/${parts[1]}`;
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
 * Look up an exact registry entry by packageId (either the registry
 * key OR the entry's own `packageId` field). Returns the entry or
 * null. We accept both shapes because some registry persistence
 * paths historically keyed by `name` instead of `packageId`.
 */
function _findEntryByPackageId(packageId, registrySnapshot) {
  for (const [key, entry] of _entries(registrySnapshot)) {
    if (key === packageId) return entry;
    if (
      entry &&
      typeof entry.packageId === "string" &&
      entry.packageId === packageId
    ) {
      return entry;
    }
  }
  return null;
}

/**
 * @param {string} widgetId — grant-keyed widget id
 * @param {Map<string, object>|object} registrySnapshot — getWidgetRegistry().widgets
 * @returns {{ packageId: string|null, siblingWidgetIds: string[] }}
 */
function resolveSiblings(widgetId, registrySnapshot) {
  if (typeof widgetId !== "string" || !widgetId) return FALLBACK(widgetId);

  // SCOPED PATH — the widgetId is already scoped, so we know its
  // package directly. No cross-package matching, no collision risk.
  const derivedPackageId = _packageIdFromScopedWidgetId(widgetId);
  if (derivedPackageId) {
    const entry = _findEntryByPackageId(derivedPackageId, registrySnapshot);
    const names = Array.isArray(entry?.componentNames)
      ? entry.componentNames
      : null;
    if (entry && names && names.length > 0) {
      return {
        packageId: derivedPackageId,
        siblingWidgetIds: names.map((n) => _toGrantId(derivedPackageId, n)),
      };
    }
    // Package is known by id but the registry entry is missing or
    // empty (race: package just installed, registry write hasn't
    // landed). Don't fall through to bare-name search — that would
    // cross-contaminate by matching another package whose component
    // happens to share the bare name. Return the single widget.
    return FALLBACK(widgetId);
  }

  // LEGACY BARE-NAME FALLBACK — only for widget ids that don't carry
  // scope (1- or 2-segment ids).
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
