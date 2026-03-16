/**
 * resourceHandlers.js
 *
 * MCP resource handlers for read-only app state.
 * Each handler delegates to existing controllers via getServerContext().
 * Returns { contents: [{ uri, mimeType, text }] } per MCP resource spec.
 */
const mcpDashServerController = require("../controller/mcpDashServerController");
const workspaceController = require("../controller/workspaceController");
const themeController = require("../controller/themeController");
const providerController = require("../controller/providerController");
const settingsController = require("../controller/settingsController");

/**
 * Helper: get win + appId or throw a descriptive error.
 */
function requireContext() {
  const ctx = mcpDashServerController.getServerContext();
  if (!ctx) {
    throw new Error("MCP server is not running or has no active window");
  }
  return ctx;
}

/**
 * Helper: count widgets in a workspace's layout array.
 */
function countWidgets(layout) {
  if (!Array.isArray(layout)) return 0;
  return layout.filter(
    (item) =>
      item.component &&
      item.component !== "Container" &&
      item.component !== "LayoutContainer" &&
      item.component !== "LayoutGridContainer",
  ).length;
}

/**
 * Helper: wrap data as an MCP resource response.
 */
function resourceResponse(uri, data) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * dash://dashboards/active — Current active dashboard state.
 */
async function handleActiveDashboard(uri) {
  const { win, appId } = requireContext();
  const result = workspaceController.listWorkspacesForApplication(win, appId);

  if (result.error) {
    return resourceResponse(uri.href, { error: result.message });
  }

  const workspaces = result.workspaces || [];
  const workspace = workspaces[0];

  if (!workspace) {
    return resourceResponse(uri.href, { error: "No dashboards exist" });
  }

  const widgets = (workspace.layout || [])
    .filter(
      (item) =>
        item.component &&
        item.component !== "Container" &&
        item.component !== "LayoutContainer" &&
        item.component !== "LayoutGridContainer",
    )
    .map((item) => ({
      id: String(item.id),
      type: item.component,
      config: item.config || {},
    }));

  return resourceResponse(uri.href, {
    id: String(workspace.id),
    name: workspace.name || workspace.label || "Dashboard",
    widgetCount: widgets.length,
    widgets,
    layout: workspace.layout || [],
    theme: workspace.theme || null,
  });
}

/**
 * dash://dashboards — All dashboards summary.
 */
async function handleAllDashboards(uri) {
  const { win, appId } = requireContext();
  const result = workspaceController.listWorkspacesForApplication(win, appId);

  if (result.error) {
    return resourceResponse(uri.href, { error: result.message });
  }

  const dashboards = (result.workspaces || []).map((ws, index) => ({
    id: String(ws.id),
    name: ws.name || ws.label || `Dashboard ${index + 1}`,
    widgetCount: countWidgets(ws.layout),
    isActive: index === 0,
  }));

  return resourceResponse(uri.href, {
    dashboards,
    count: dashboards.length,
  });
}

/**
 * dash://themes — All themes with active state.
 */
async function handleAllThemes(uri) {
  const { win, appId } = requireContext();
  const result = themeController.listThemesForApplication(win, appId);

  if (result.error) {
    return resourceResponse(uri.href, { error: result.message });
  }

  const themes = result.themes || {};
  const settingsResult = settingsController.getSettingsForApplication(win);
  const activeThemeKey = settingsResult?.settings?.theme || null;

  const themeList = Object.keys(themes).map((name) => ({
    name,
    isActive: name === activeThemeKey,
    colors: themes[name],
  }));

  return resourceResponse(uri.href, {
    themes: themeList,
    count: themeList.length,
    activeTheme: activeThemeKey,
  });
}

/**
 * dash://providers — All providers (no secrets).
 */
async function handleAllProviders(uri) {
  const { win, appId } = requireContext();
  const result = providerController.listProviders(win, appId);

  if (result.error) {
    return resourceResponse(uri.href, { error: result.message });
  }

  const providers = (result.providers || []).map((p) => ({
    name: p.name,
    type: p.type,
    providerClass: p.providerClass || "credential",
    dateCreated: p.dateCreated,
    dateUpdated: p.dateUpdated,
  }));

  return resourceResponse(uri.href, {
    providers,
    count: providers.length,
  });
}

/**
 * dash://app/info — Version, appId, and aggregate stats.
 */
async function handleAppInfo(uri) {
  const { win, appId } = requireContext();

  // Dashboards + widget count
  const wsResult = workspaceController.listWorkspacesForApplication(win, appId);
  const workspaces = wsResult.workspaces || [];
  const dashboardCount = workspaces.length;
  const widgetCount = workspaces.reduce(
    (sum, ws) => sum + countWidgets(ws.layout),
    0,
  );

  // Themes
  const themeResult = themeController.listThemesForApplication(win, appId);
  const themes = themeResult.themes || {};
  const themeCount = Object.keys(themes).length;

  // Providers
  const providerResult = providerController.listProviders(win, appId);
  const providers = providerResult.providers || {};
  const providerCount = Array.isArray(providers)
    ? providers.length
    : Object.keys(providers).length;

  // Server status
  const status = mcpDashServerController.getStatus(win);

  return resourceResponse(uri.href, {
    appId,
    server: {
      version: "1.0.0",
      port: status.port,
      uptime: status.uptime,
      toolCount: status.toolCount,
      resourceCount: status.resourceCount,
    },
    stats: {
      dashboardCount,
      widgetCount,
      themeCount,
      providerCount,
    },
  });
}

module.exports = {
  handleActiveDashboard,
  handleAllDashboards,
  handleAllThemes,
  handleAllProviders,
  handleAppInfo,
};
