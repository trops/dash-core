/**
 * Resolve a component reference to its registry key.
 *
 * Strict exact-match lookup. Layout items carry the canonical scoped
 * id (`scope.package.Component`); the registry stores entries under
 * the same key. If the layout item's `component` doesn't match a
 * registered key exactly, the renderer shows `WidgetNotFound` — there
 * is no suffix-scan fallback and no `packageId` hint, because both
 * could silently resolve a typo / legacy bare name to the wrong widget.
 *
 * Legacy dashboards that still carry a bare `component` (pre-scope
 * migration) are handled in `LayoutModel`, which performs a one-shot
 * suffix-scan rewrite on load. By the time `resolveComponentKey` is
 * called, every layout item is expected to have a fully scoped id.
 *
 * Pure function. No side effects. Stays outside ComponentManager so
 * it can be tested in isolation without the Models/Layout import chain.
 *
 * @param {Object} componentMap - The registry map keyed by scoped ids
 * @param {string} component - The scoped id from the layout item
 * @returns {string|null} The matching registry key, or null
 */
export function resolveComponentKey(componentMap, component) {
  if (!componentMap || !component) return null;
  if (typeof component !== "string") return null;
  return component in componentMap ? component : null;
}
