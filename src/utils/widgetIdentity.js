/**
 * widgetIdentity.js
 *
 * Single source of truth for the widget-name + scoped-id-subtitle
 * pattern used across the renderer:
 *
 *   PRIMARY  Sales Pipeline
 *   SUBTITLE trops.pipeline.SalesPipeline
 *
 * Surfaces that previously rolled their own derivation (WidgetsTab,
 * listenerResolution, providerResolution, WidgetCardHeader,
 * LayoutBuilderConfigModal) all route through these two helpers so a
 * given widget instance shows the same name in every panel.
 */

/**
 * Pick the most user-friendly display name for a layout item.
 *
 * Priority:
 *   1. per-instance user title (`item.userPrefs.title`)
 *   2. widget's default per-instance title
 *      (`item.userConfig.title.defaultValue`, or string-form
 *      `item.userConfig.title`)
 *   3. developer-set friendly `cfg.displayName`
 *   4. widget config `cfg.name`
 *   5. bare component name (last segment of the scoped id)
 *   6. full component string (last resort, never preferred)
 *
 * @param {Object} item - layout item (must carry `component` to be useful)
 * @param {Object} [cfg] - the live registry config returned by ComponentManager
 * @returns {string} a non-empty display string
 */
export function pickWidgetDisplayName(item, cfg) {
  const prefsTitle = item?.userPrefs?.title;
  if (typeof prefsTitle === "string" && prefsTitle.trim()) return prefsTitle;
  const userConfigTitle =
    item?.userConfig?.title?.defaultValue ||
    (typeof item?.userConfig?.title === "string"
      ? item.userConfig.title
      : null);
  if (typeof userConfigTitle === "string" && userConfigTitle.trim()) {
    return userConfigTitle;
  }
  if (cfg?.displayName) return cfg.displayName;
  if (cfg?.name) return cfg.name;
  if (typeof item?.component === "string") {
    const parts = item.component.split(".");
    if (parts.length === 3) return parts[2];
    return item.component;
  }
  return "Widget";
}

/**
 * Build the full scoped registry id (`scope.package.Component`) for
 * use as a subtitle. Returns the layout item's canonical id when
 * present; otherwise null so callers can hide the subtitle.
 *
 * @param {Object} item
 * @returns {string|null}
 */
export function pickWidgetRef(item) {
  const c = item?.component;
  if (typeof c !== "string") return null;
  const parts = c.split(".");
  return parts.length === 3 ? c : null;
}

/**
 * Cross-dashboard isolation gate. Layout items carry a `dashboardId`
 * stamp from `LayoutModel`; this helper drops items whose stamp
 * doesn't match the surrounding workspace's id. Used at every
 * workspace-walking surface (Listeners / Providers / Widgets tabs,
 * bulk-edit panes, dependency resolution) to prevent items leaked
 * from another dashboard's tree from showing up.
 *
 * STRICT mode (workspace has an id): item must have a matching
 * `dashboardId`. No dashboardId → reject. Different dashboardId → reject.
 *
 * PERMISSIVE mode (workspace has no id — synthetic test fixtures
 * and in-memory sandboxes): everything passes.
 *
 * @param {Object} item
 * @param {Object} workspace
 * @returns {boolean}
 */
export function belongsToWorkspace(item, workspace) {
  const wsId = workspace?.id;
  if (wsId === undefined || wsId === null) return true;
  const itemDashId = item?.dashboardId;
  if (itemDashId === undefined || itemDashId === null) return false;
  return String(itemDashId) === String(wsId);
}

const FRAMEWORK_CONTAINER_COMPONENTS = new Set([
  "LayoutGridContainer",
  "Container",
  "LayoutContainer",
]);

/**
 * Is this layout item a USER widget (i.e. something the user added
 * via the widget sidebar / drag-drop)? False for framework chrome —
 * `LayoutGridContainer`, `Container`, `LayoutContainer` — which the
 * dashboard config UI shouldn't expose as a configurable widget,
 * even though the layout walker visits them.
 *
 * Filter is by COMPONENT NAME only, not by `item.type`.
 * `LayoutModel` defaults `type: "layout"` when the source data
 * doesn't set it explicitly (`layout.type = "type" in obj ? obj.type
 * : "layout"`), and most persisted user widgets fall into that
 * default — so a `type !== "widget"` check would silently drop
 * legitimate widgets from every list.
 *
 * @param {Object} item
 * @returns {boolean}
 */
export function isUserWidget(item) {
  if (!item || typeof item !== "object" || !item.component) return false;
  if (FRAMEWORK_CONTAINER_COMPONENTS.has(item.component)) return false;
  return true;
}
