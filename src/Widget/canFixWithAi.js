/**
 * Whether a failing widget gets "Fix with AI": an installed one (a scoped
 * id, or AI-built) — Create › Change <widget> on it, with the error
 * (consolidation Phase 3); the Dash team fixes it in place, or as a new
 * widget. Built-ins (the dash. scope) ship with Dash; nothing to change.
 */
export function canFixWithAi(widgetName) {
  return (
    typeof widgetName === "string" &&
    !widgetName.startsWith("dash.") &&
    (widgetName.split(".").length >= 3 ||
      /(^|[./])ai-built\b/i.test(widgetName))
  );
}

/**
 * What Fix sends (dash:edit-widget-with-ai): the widget and its error and,
 * for a widget in a dashboard's cell, where it is — the same details the
 * card's menu sends — so a fix saved as a new widget takes its place there
 * (consolidation Phase 3P).
 * @param {string} widgetName  the cell's component id
 * @param {string} error
 * @param {object} [item]      its layout item (LayoutModel: id, parent, dashboardId)
 * @param {string} [scope]     "main" | "sidebar"
 */
export function fixRequestDetail(
  widgetName,
  error,
  item = null,
  scope = "main",
) {
  const detail = { widgetComponentName: widgetName, error };
  if (!item || item.id == null || item.parent == null) return detail;
  return {
    ...detail,
    widgetId: item.id,
    gridItemId: item.parent,
    workspaceId: item.dashboardId ?? null,
    scope: scope || "main",
    userPrefs:
      item.userPrefs && typeof item.userPrefs === "object"
        ? item.userPrefs
        : null,
    selectedProviders:
      item.selectedProviders && typeof item.selectedProviders === "object"
        ? item.selectedProviders
        : null,
    // Its package, as the card's menu sends it (finds a bare name's widget).
    sourcePackage: item.packageId || item._sourcePackage || null,
  };
}
