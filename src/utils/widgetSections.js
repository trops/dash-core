/**
 * Whether a layout item's settings include Listeners: every widget does.
 *
 * It used to be decided by `item.workspace !== "layout"`, but LayoutModel
 * fills a missing `workspace` with "layout", and widgets placed by the Dash
 * team, bots and the MCP add_widget tool never set one — so their Listeners
 * vanished (consolidation Phase 3P). A widget is known by its type
 * (LayoutModel defaults it, migrateLayoutItemTypes heals saved ones);
 * containers keep the old rule.
 */
export function showsListeners(item) {
  if (!item || typeof item !== "object") return false;
  if (item.type === "widget") return true;
  return item.workspace !== "layout";
}
