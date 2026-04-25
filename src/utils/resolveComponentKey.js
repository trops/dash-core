import { makeScopedComponentId } from "./scopedComponentId";

/**
 * Resolve a component name to a registry key. Returns null if no
 * match exists.
 *
 * Pure function — depends only on the passed-in `componentMap` and
 * `data`. Lives outside ComponentManager so it can be tested without
 * pulling in the full Component/Layout import chain (and so other
 * call sites can route through it without circular deps).
 *
 * Lookup order (the LAYOUT ITEM is the source of truth):
 *   1. EXACT match on `component` — covers the new scoped form
 *      (`scope.package.X`) and any legacy `.dash.js` that already
 *      set `config.id` to a scoped value.
 *   2. If `component` is bare (no dots) AND we have a packageId hint
 *      on the layout item, build the scoped id and try that.
 *   3. Bare-name fallback: scan the map for any key ending in
 *      `.${component}`. If exactly one matches, use it. If multiple
 *      match (the collision case), prefer the one matching the
 *      layout item's `packageId` / `_sourcePackage`; otherwise fall
 *      through to the first match (deterministic, but also logs a
 *      warning so callers can spot the ambiguity).
 *
 * Step (3) is the back-compat path for layouts authored before
 * scoped registration landed. New layouts ALWAYS resolve via step (1).
 */
export function resolveComponentKey(componentMap, component, data) {
  if (!componentMap || !component) return null;
  if (component in componentMap) return component;
  if (typeof component !== "string") return null;
  if (component.includes(".")) return null;

  const packageId =
    data?.packageId || data?._sourcePackage || data?.packageName || null;
  if (packageId) {
    const scoped = makeScopedComponentId(packageId, component);
    if (scoped in componentMap) return scoped;
  }

  const suffix = `.${component}`;
  const matches = Object.keys(componentMap).filter((k) => k.endsWith(suffix));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  if (packageId) {
    const target = makeScopedComponentId(packageId, component);
    if (matches.includes(target)) return target;
  }
  console.warn(
    `[ComponentManager] Multiple registered widgets share the bare name "${component}": ${matches.join(", ")}. Resolving to "${matches[0]}". Add an explicit packageId on the layout item to disambiguate.`,
  );
  return matches[0];
}
