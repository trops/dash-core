/**
 * migrateLayoutItemTypes.js
 *
 * One-shot data migration that runs at workspace load time. Fixes
 * legacy `item.type` values where user widgets were persisted with
 * the old `LayoutModel` default (`type: "layout"`) — that default
 * silently mis-classified every widget as a container, which broke
 * any downstream code that filtered "is this a user widget?" by
 * type field.
 *
 * Post-v0.1.444 LayoutModel defaults `type` based on component
 * name. This migration applies the same logic to ALREADY-PERSISTED
 * items so old workspaces.json data heals on next save.
 *
 * Rules:
 *   - `component === "LayoutGridContainer"` → `type: "grid"`
 *   - `component === "Container"` / `"LayoutContainer"` → `type: "layout"`
 *   - Anything else → `type: "widget"`
 *
 * Mutates in place. Idempotent — running on a clean workspace is
 * a no-op. Returns a count of items whose type was corrected.
 *
 * @param {Object} workspace
 * @returns {{ corrected: number }}
 */

const FRAMEWORK_CONTAINER_COMPONENTS = new Set([
  "LayoutGridContainer",
  "Container",
  "LayoutContainer",
]);

function expectedType(component) {
  if (component === "LayoutGridContainer") return "grid";
  if (component === "Container" || component === "LayoutContainer") {
    return "layout";
  }
  return "widget";
}

export function migrateLayoutItemTypes(workspace) {
  const summary = { corrected: 0 };
  if (!workspace) return summary;

  const fixItem = (item) => {
    if (!item || typeof item !== "object" || !item.component) return;
    const want = expectedType(item.component);
    // Only correct OBVIOUS misclassifications. If the persisted type
    // is `widget` but the component is a known container — fix it.
    // If a user widget is typed `layout` (the old default) — fix it.
    // Don't disturb items that were intentionally typed something
    // unusual (e.g. `workspace`) on a non-container component.
    const current = item.type;
    const isContainer = FRAMEWORK_CONTAINER_COMPONENTS.has(item.component);
    if (isContainer && current !== want) {
      item.type = want;
      summary.corrected += 1;
      return;
    }
    if (!isContainer && (current === "layout" || current === undefined)) {
      item.type = "widget";
      summary.corrected += 1;
    }
  };

  const walk = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      fixItem(item);
      if (Array.isArray(item.items)) walk(item.items);
      if (Array.isArray(item.layout)) walk(item.layout);
    }
  };

  walk(workspace.layout);
  if (Array.isArray(workspace.pages)) {
    for (const page of workspace.pages) walk(page?.layout);
  }
  walk(workspace.sidebarLayout);

  return summary;
}
