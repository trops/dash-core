import { normalizeUserConfig } from "./userConfigFields";
import { getUserConfigurableProviders } from "./providerUtils";

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

/**
 * What the edit panel's widget panel has to show (consolidation Phase 3P):
 * Settings, Connections and Listens for are always there (saying so when
 * empty); these say whether each has something to edit, and whether the
 * widget has Notifications or a Schedule at all.
 * @param {object} item    the layout item
 * @param {object} config  its .dash.js config (ComponentManager.config)
 */
export function panelSections(item, config) {
  const c = config || {};
  const declared = Array.isArray(c.providers)
    ? c.providers
    : Array.isArray(item?.providers)
      ? item.providers
      : [];
  const handlers = Array.isArray(item?.eventHandlers)
    ? item.eventHandlers
    : Array.isArray(c.eventHandlers)
      ? c.eventHandlers
      : [];
  return {
    settings: Object.keys(normalizeUserConfig(c.userConfig)).length > 0,
    connections: getUserConfigurableProviders(declared).length > 0,
    listeners: showsListeners(item) && handlers.length > 0,
    notifications: Array.isArray(c.notifications) && c.notifications.length > 0,
    schedule: Array.isArray(c.scheduledTasks) && c.scheduledTasks.length > 0,
  };
}
