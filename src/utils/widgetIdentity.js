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
