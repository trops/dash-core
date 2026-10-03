/**
 * dashboardSummary — what the Dashboards page shows about a dashboard
 * (app-navigation PRD NAV-005): its pages and each page's grid, every widget
 * (name + package), the providers it uses, and how many required providers
 * are unresolved. Pure; the same derivations Dashboard Config uses.
 */
import {
  forEachWidget,
  getAllProviderBindings,
} from "../../utils/providerResolution";
import {
  belongsToWorkspace,
  isUserWidget,
  pickWidgetDisplayName,
} from "../../utils/widgetIdentity";

/** `scope.package.Component` → `@scope/package`; null for unscoped ids. */
export function packageOf(component) {
  if (typeof component !== "string") return null;
  const parts = component.split(".");
  return parts.length === 3 ? `@${parts[0]}/${parts[1]}` : null;
}

/** The visible cells of a page's LayoutGridContainer, or null. */
export function pageGrid(layout) {
  const root = (layout || []).find(
    (item) => item && item.component === "LayoutGridContainer",
  );
  const grid = root && root.grid;
  if (!grid || !grid.rows || !grid.cols) return null;
  const cells = [];
  for (let r = 1; r <= grid.rows; r++) {
    for (let c = 1; c <= grid.cols; c++) {
      const cell = grid[`${r}.${c}`];
      if (!cell || cell.hide) continue;
      cells.push({
        row: r,
        col: c,
        colSpan: (cell.span && cell.span.col) || null,
        rowSpan: (cell.span && cell.span.row) || null,
      });
    }
  }
  return cells.length ? { rows: grid.rows, cols: grid.cols, cells } : null;
}

export function dashboardSummary(workspace, ctx = {}) {
  const {
    getWidgetConfig = null,
    getWidgetRequirements = null,
    appProviders = null,
  } = ctx;
  const ws = workspace || {};
  const rawPages =
    Array.isArray(ws.pages) && ws.pages.length
      ? ws.pages
      : [{ id: "main", name: "Main", layout: ws.layout }];
  const pages = rawPages.map((p) => ({
    id: p.id,
    name: p.name || "Untitled",
    grid: pageGrid(p.layout),
  }));

  const widgets = [];
  const seen = new Set();
  forEachWidget(ws, (item) => {
    if (!isUserWidget(item) || !belongsToWorkspace(item, ws)) return;
    const id = item.uuidString || item.uuid || item.id;
    if (id == null || seen.has(id)) return;
    seen.add(id);
    const cfg = getWidgetConfig ? getWidgetConfig(item.component) : null;
    widgets.push({
      id,
      name: pickWidgetDisplayName(item, cfg),
      component: item.component,
      package: packageOf(item.component),
    });
  });

  let providers = [];
  let unresolvedProviders = 0;
  if (getWidgetRequirements) {
    const bindings = getAllProviderBindings({
      workspace: ws,
      appProviders,
      getWidgetRequirements,
    });
    providers = Array.from(
      new Set(bindings.map((b) => b.resolvedProviderName).filter(Boolean)),
    );
    unresolvedProviders = bindings.filter(
      (b) => b.required && !b.resolvedProviderName,
    ).length;
  }

  return { pages, widgets, providers, unresolvedProviders };
}
