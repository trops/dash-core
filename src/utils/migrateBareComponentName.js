/**
 * One-shot legacy bare-name → canonical scoped-id migration.
 *
 * Pre-v0.1.435 dashboards stored layout items with bare component
 * names (`component: "PipelineKanban"`). Post-v0.1.435 the registry
 * is keyed strictly by scoped ids (`scope.package.Component`) and
 * `resolveComponentKey` does no fallback scanning. This helper
 * bridges the two: at workspace-load time, walk the registry once
 * and rewrite any bare name that maps unambiguously to a scoped
 * registration.
 *
 * Behavior (deliberately strict):
 *   - Already-scoped (3 dot-separated parts) → return verbatim.
 *   - Bare name with exactly one matching registry key ending in
 *     `.${bareName}` → return the scoped key.
 *   - Zero matches OR multiple matches → return verbatim. The
 *     renderer surfaces `WidgetNotFound` rather than guessing wrong;
 *     the user can resave or republish to fix the layout.
 *
 * Should be called once per layout item on workspace load. After the
 * workspace is saved, every item carries a scoped id and this helper
 * is a no-op.
 *
 * @param {Object} componentMap - The live registry map keyed by scoped ids
 * @param {string} component - The layout item's `component` field
 * @returns {string} - The canonical scoped id, or the input unchanged
 */
export function migrateBareComponentName(componentMap, component) {
  if (!componentMap || typeof component !== "string" || !component) {
    return component;
  }
  // Already scoped — fast path. Three dot-separated parts is the
  // canonical shape (`scope.package.Component`); anything else
  // (bare names, two-part forms, four-part typos) goes through the
  // suffix scan.
  if (component.split(".").length === 3) return component;
  // Already in the registry under its current key — also a fast path.
  if (component in componentMap) return component;
  const suffix = `.${component}`;
  const matches = Object.keys(componentMap).filter((k) => k.endsWith(suffix));
  if (matches.length === 1) return matches[0];
  return component;
}
