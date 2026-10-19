/**
 * Compatibility helpers for installing a registry dashboard.
 */

/** The key a widget dependency has in compatibility.widgets. */
export function depKeyFor(dep) {
  return dep.scope && dep.packageName && dep.widgetName
    ? `${dep.scope}.${dep.packageName}.${dep.widgetName}`
    : dep.id || dep.package || dep.name;
}

/**
 * Names of the required widgets that can't be installed — Install is blocked
 * while there are any (Phase 1e). No check yet, or a compatible one, blocks
 * nothing.
 */
export function unavailableRequiredWidgets(widgetDeps, compatibility) {
  if (!compatibility || compatibility.compatible !== false) return [];
  return (widgetDeps || [])
    .filter((dep) => dep.required !== false)
    .filter((dep) => {
      const status = (compatibility.widgets || {})[depKeyFor(dep)];
      return status !== "installed" && status !== "available";
    })
    .map((dep) => dep.displayName || dep.name || dep.packageName);
}
