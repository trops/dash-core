/**
 * toolHandlers.js
 *
 * MCP tool handlers for dashboard/workspace CRUD and app statistics.
 * Each handler delegates to existing controllers via getServerContext().
 */
const { randomUUID } = require("crypto");
const mcpDashServerController = require("../controller/mcpDashServerController");
const workspaceController = require("../controller/workspaceController");
const themeController = require("../controller/themeController");
const providerController = require("../controller/providerController");

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
 * Widgets are layout items whose component is registered and is not a container.
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
 * list_dashboards — Returns all workspaces with id, name, widget count, active state.
 */
async function handleListDashboards() {
  const { win, appId } = requireContext();
  const result = workspaceController.listWorkspacesForApplication(win, appId);

  if (result.error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: result.message }),
        },
      ],
      isError: true,
    };
  }

  const dashboards = (result.workspaces || []).map((ws, index) => ({
    id: String(ws.id),
    name: ws.name || ws.label || `Dashboard ${index + 1}`,
    widgetCount: countWidgets(ws.layout),
    isActive: index === 0,
  }));

  return {
    content: [{ type: "text", text: JSON.stringify(dashboards, null, 2) }],
  };
}

/**
 * get_dashboard — Returns full details for a dashboard by ID (or the active one).
 */
async function handleGetDashboard({ dashboardId }) {
  const { win, appId } = requireContext();
  const result = workspaceController.listWorkspacesForApplication(win, appId);

  if (result.error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: result.message }),
        },
      ],
      isError: true,
    };
  }

  const workspaces = result.workspaces || [];
  let workspace;

  if (dashboardId) {
    workspace = workspaces.find((ws) => String(ws.id) === dashboardId);
    if (!workspace) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Dashboard not found: ${dashboardId}`,
            }),
          },
        ],
        isError: true,
      };
    }
  } else {
    // Return first workspace as the "active" one
    workspace = workspaces[0];
    if (!workspace) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "No dashboards exist",
            }),
          },
        ],
        isError: true,
      };
    }
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

  const detail = {
    id: String(workspace.id),
    name: workspace.name || workspace.label || "Dashboard",
    layout: workspace.layout || [],
    widgets,
    theme: workspace.theme || null,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
  };
}

/**
 * create_dashboard — Creates a new workspace with the given name.
 */
async function handleCreateDashboard({ name }) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "name is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();

  const newWorkspace = {
    id: Date.now(),
    name: name.trim(),
    label: name.trim(),
    type: "workspace",
    version: 1,
    menuId: 1,
    layout: [
      {
        id: 1,
        order: 1,
        component: "Container",
        parentId: 0,
        items: [],
      },
    ],
  };

  const result = workspaceController.saveWorkspaceForApplication(
    win,
    appId,
    newWorkspace,
  );

  if (result.error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: result.message }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { id: String(newWorkspace.id), name: newWorkspace.name },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * delete_dashboard — Deletes a workspace by ID. Rejects if it's the last one.
 */
async function handleDeleteDashboard({ dashboardId }) {
  if (!dashboardId || typeof dashboardId !== "string") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "dashboardId is required",
          }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();

  // Check how many dashboards exist
  const listResult = workspaceController.listWorkspacesForApplication(
    win,
    appId,
  );
  const workspaces = listResult.workspaces || [];

  if (workspaces.length <= 1) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Cannot delete the last remaining dashboard",
          }),
        },
      ],
      isError: true,
    };
  }

  // Verify the dashboard exists
  const exists = workspaces.some((ws) => String(ws.id) === dashboardId);
  if (!exists) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Dashboard not found: ${dashboardId}`,
          }),
        },
      ],
      isError: true,
    };
  }

  // Use numeric ID if stored as number
  const targetWs = workspaces.find((ws) => String(ws.id) === dashboardId);
  const result = workspaceController.deleteWorkspaceForApplication(
    win,
    appId,
    targetWs.id,
  );

  if (result.error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: result.message }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          deleted: dashboardId,
          remaining: (result.workspaces || []).length,
        }),
      },
    ],
  };
}

/**
 * get_app_stats — Returns counts of dashboards, widgets, themes, and providers.
 */
async function handleGetAppStats() {
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
  const providerCount = Object.keys(providers).length;

  const stats = {
    dashboardCount,
    widgetCount,
    themeCount,
    providerCount,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
  };
}

// --- Widget Tool Handlers ---

const registryController = require("../controller/registryController");

/**
 * Helper: find a workspace by ID or return the first (active) one.
 */
function findWorkspace(workspaces, dashboardId) {
  if (dashboardId) {
    const ws = workspaces.find((w) => String(w.id) === dashboardId);
    if (!ws) {
      return {
        error: true,
        response: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `Dashboard not found: ${dashboardId}`,
              }),
            },
          ],
          isError: true,
        },
      };
    }
    return { workspace: ws };
  }
  if (!workspaces.length) {
    return {
      error: true,
      response: {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "No dashboards exist" }),
          },
        ],
        isError: true,
      },
    };
  }
  return { workspace: workspaces[0] };
}

/**
 * Helper: generate the next unique layout item ID within a workspace.
 */
function nextLayoutId(layout) {
  if (!Array.isArray(layout) || layout.length === 0) return 1;
  const maxId = layout.reduce(
    (max, item) => Math.max(max, Number(item.id) || 0),
    0,
  );
  return maxId + 1;
}

/**
 * add_widget — Add a widget to a dashboard by component name.
 */
async function handleAddWidget({ dashboardId, widgetName }) {
  if (!widgetName || typeof widgetName !== "string" || !widgetName.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "widgetName is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();
  const result = workspaceController.listWorkspacesForApplication(win, appId);
  if (result.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: result.message }) },
      ],
      isError: true,
    };
  }

  const found = findWorkspace(result.workspaces || [], dashboardId);
  if (found.error) return found.response;

  const workspace = found.workspace;
  const layout = workspace.layout || [];

  // Find the first container to add the widget into
  const container = layout.find(
    (item) =>
      item.component === "Container" ||
      item.component === "LayoutContainer" ||
      item.component === "LayoutGridContainer",
  );
  const parentId = container ? container.id : 0;

  const newId = nextLayoutId(layout);
  const maxOrder = layout.reduce(
    (max, item) => Math.max(max, Number(item.order) || 0),
    0,
  );

  const newItem = {
    id: newId,
    order: maxOrder + 1,
    component: widgetName.trim(),
    parentId,
    config: {},
  };

  workspace.layout = [...layout, newItem];

  const saveResult = workspaceController.saveWorkspaceForApplication(
    win,
    appId,
    workspace,
  );
  if (saveResult.error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: saveResult.message }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            widgetId: String(newId),
            name: widgetName.trim(),
            dashboardId: String(workspace.id),
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * remove_widget — Remove a widget instance from a dashboard.
 */
async function handleRemoveWidget({ dashboardId, widgetId }) {
  if (!widgetId || typeof widgetId !== "string") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "widgetId is required" }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();
  const result = workspaceController.listWorkspacesForApplication(win, appId);
  if (result.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: result.message }) },
      ],
      isError: true,
    };
  }

  const found = findWorkspace(result.workspaces || [], dashboardId);
  if (found.error) return found.response;

  const workspace = found.workspace;
  const layout = workspace.layout || [];

  const exists = layout.some((item) => String(item.id) === widgetId);
  if (!exists) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Widget not found: ${widgetId}`,
          }),
        },
      ],
      isError: true,
    };
  }

  workspace.layout = layout.filter((item) => String(item.id) !== widgetId);

  const saveResult = workspaceController.saveWorkspaceForApplication(
    win,
    appId,
    workspace,
  );
  if (saveResult.error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: saveResult.message }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          removed: widgetId,
          remainingWidgets: countWidgets(workspace.layout),
        }),
      },
    ],
  };
}

/**
 * configure_widget — Update widget settings (partial merge).
 */
async function handleConfigureWidget({ dashboardId, widgetId, config }) {
  if (!widgetId || typeof widgetId !== "string") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "widgetId is required" }),
        },
      ],
      isError: true,
    };
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "config is required and must be an object",
          }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();
  const result = workspaceController.listWorkspacesForApplication(win, appId);
  if (result.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: result.message }) },
      ],
      isError: true,
    };
  }

  const found = findWorkspace(result.workspaces || [], dashboardId);
  if (found.error) return found.response;

  const workspace = found.workspace;
  const layout = workspace.layout || [];
  const item = layout.find((i) => String(i.id) === widgetId);

  if (!item) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Widget not found: ${widgetId}`,
          }),
        },
      ],
      isError: true,
    };
  }

  // Merge config
  item.config = { ...(item.config || {}), ...config };

  const saveResult = workspaceController.saveWorkspaceForApplication(
    win,
    appId,
    workspace,
  );
  if (saveResult.error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: saveResult.message }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            widgetId,
            component: item.component,
            config: item.config,
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * list_widgets — List available widgets from the registry.
 */
async function handleListWidgets() {
  try {
    const index = await registryController.fetchRegistryIndex();
    const packages = index.packages || [];

    const widgets = [];
    for (const pkg of packages) {
      // Skip non-widget packages
      if (pkg.type && pkg.type !== "widget") continue;

      for (const w of pkg.widgets || []) {
        widgets.push({
          name: w.name || pkg.name,
          displayName: w.displayName || w.name || pkg.displayName || pkg.name,
          description: w.description || pkg.description || "",
          icon: w.icon || pkg.icon || null,
          package: pkg.name,
          providers: (w.providers || pkg.providers || []).map((p) => ({
            type: p.type,
            providerClass: p.providerClass || "api",
            required: p.required !== false,
          })),
        });
      }

      // If a package has no widgets array, treat the package itself as a widget
      if (!pkg.widgets || pkg.widgets.length === 0) {
        widgets.push({
          name: pkg.name,
          displayName: pkg.displayName || pkg.name,
          description: pkg.description || "",
          icon: pkg.icon || null,
          package: pkg.name,
          providers: (pkg.providers || []).map((p) => ({
            type: p.type,
            providerClass: p.providerClass || "api",
            required: p.required !== false,
          })),
        });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ widgets, count: widgets.length }, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Failed to fetch widget registry: ${err.message}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * search_widgets — Search the registry by keyword.
 */
async function handleSearchWidgets({ query }) {
  if (!query || typeof query !== "string" || !query.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "query is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await registryController.searchRegistry(query.trim());
    const packages = result.packages || [];

    const widgets = [];
    for (const pkg of packages) {
      if (pkg.type && pkg.type !== "widget") continue;

      for (const w of pkg.widgets || []) {
        widgets.push({
          name: w.name || pkg.name,
          displayName: w.displayName || w.name || pkg.displayName || pkg.name,
          description: w.description || pkg.description || "",
          icon: w.icon || pkg.icon || null,
          package: pkg.name,
          providers: (w.providers || pkg.providers || []).map((p) => ({
            type: p.type,
            providerClass: p.providerClass || "api",
            required: p.required !== false,
          })),
        });
      }

      if (!pkg.widgets || pkg.widgets.length === 0) {
        widgets.push({
          name: pkg.name,
          displayName: pkg.displayName || pkg.name,
          description: pkg.description || "",
          icon: pkg.icon || null,
          package: pkg.name,
          providers: (pkg.providers || []).map((p) => ({
            type: p.type,
            providerClass: p.providerClass || "api",
            required: p.required !== false,
          })),
        });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { query: query.trim(), widgets, count: widgets.length },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Failed to search widget registry: ${err.message}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

// --- Theme Tool Handlers ---

const settingsController = require("../controller/settingsController");
const themeFromUrlController = require("../controller/themeFromUrlController");
const paletteToThemeMapper = require("../controller/paletteToThemeMapper");
const extractionCacheController = require("../controller/extractionCacheController");
const { THEME_SAVE_COMPLETE, SETTINGS_SAVE_COMPLETE } = require("../events");

/**
 * list_themes — Returns all saved themes with name, active state, and color summary.
 */
async function handleListThemes() {
  const { win, appId } = requireContext();
  const result = themeController.listThemesForApplication(win, appId);

  if (result.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: result.message }) },
      ],
      isError: true,
    };
  }

  const themes = result.themes || {};
  const settingsResult = settingsController.getSettingsForApplication(win);
  const activeThemeKey = settingsResult?.settings?.theme || null;

  const themeList = Object.keys(themes).map((name) => ({
    name,
    isActive: name === activeThemeKey,
    colors: themes[name],
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { themes: themeList, count: themeList.length },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * get_theme — Returns full details of a theme by name.
 */
async function handleGetTheme({ name }) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "name is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();
  const result = themeController.listThemesForApplication(win, appId);

  if (result.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: result.message }) },
      ],
      isError: true,
    };
  }

  const themes = result.themes || {};
  const themeName = name.trim();

  if (!(themeName in themes)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Theme not found: ${themeName}` }),
        },
      ],
      isError: true,
    };
  }

  const settingsResult = settingsController.getSettingsForApplication(win);
  const activeThemeKey = settingsResult?.settings?.theme || null;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            name: themeName,
            isActive: themeName === activeThemeKey,
            colors: themes[themeName],
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * create_theme — Creates a new theme from a colors object.
 */
async function handleCreateTheme({ name, colors }) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "name is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  if (!colors || typeof colors !== "object" || Array.isArray(colors)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "colors is required and must be an object",
          }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();
  const themeName = name.trim();

  const result = themeController.saveThemeForApplication(
    win,
    appId,
    themeName,
    colors,
  );

  if (result.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: result.message }) },
      ],
      isError: true,
    };
  }

  // Notify the renderer so the UI updates
  win.webContents.send(THEME_SAVE_COMPLETE, result);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ name: themeName, created: true }, null, 2),
      },
    ],
  };
}

/**
 * create_theme_from_url — Extracts colors from a URL and generates a theme.
 * Uses a hidden BrowserWindow to load the page and extract styles.
 */
async function handleCreateThemeFromUrl({ url, name }) {
  if (!url || typeof url !== "string" || !url.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "url is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  const trimmedUrl = url.trim();

  // Validate URL format
  if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "url must start with http:// or https://",
          }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();
  const { BrowserWindow } = require("electron");

  const LOAD_TIMEOUT_MS = 15000;

  try {
    // Extract colors using a hidden BrowserWindow (same approach as dash-electron IPC handler)
    const extractionData = await extractionCacheController.get(
      trimmedUrl,
      async () => {
        const scanWindow = new BrowserWindow({
          width: 1280,
          height: 900,
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        let destroyed = false;
        const destroyScanWindow = () => {
          if (!destroyed) {
            destroyed = true;
            scanWindow.destroy();
          }
        };

        try {
          scanWindow.webContents.on("will-navigate", (event) => {
            event.preventDefault();
          });

          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(
                new Error(
                  `Page load timed out after ${LOAD_TIMEOUT_MS}ms for ${trimmedUrl}`,
                ),
              );
            }, LOAD_TIMEOUT_MS);

            scanWindow.webContents.on(
              "did-fail-load",
              (event, errorCode, errorDescription) => {
                clearTimeout(timeout);
                const desc = errorDescription || `Error code ${errorCode}`;
                reject(new Error(`Page load failed: ${desc}`));
              },
            );

            scanWindow
              .loadURL(trimmedUrl)
              .then(() => {
                clearTimeout(timeout);
                resolve();
              })
              .catch((err) => {
                clearTimeout(timeout);
                reject(
                  new Error(`Failed to load ${trimmedUrl}: ${err.message}`),
                );
              });
          });

          const extracted = await scanWindow.webContents.executeJavaScript(`
            (function() {
              try {
                var htmlContent = document.documentElement.outerHTML;
                var cssContent = '';
                try {
                  for (var s = 0; s < document.styleSheets.length; s++) {
                    try {
                      var rules = document.styleSheets[s].cssRules;
                      for (var r = 0; r < rules.length; r++) {
                        cssContent += rules[r].cssText + '\\n';
                      }
                    } catch (e) {}
                  }
                } catch (e) {}

                var DEFAULT_COLORS = {
                  'rgba(0, 0, 0, 0)': 1, 'transparent': 1,
                  'rgb(0, 0, 0)': 1, 'rgb(255, 255, 255)': 1
                };
                var colorFreq = {};
                var elements = document.body ? document.body.querySelectorAll('*') : [];
                var limit = Math.min(elements.length, 500);
                for (var i = 0; i < limit; i++) {
                  var el = elements[i];
                  if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
                  var cs = window.getComputedStyle(el);
                  var props = ['color', 'backgroundColor', 'borderColor'];
                  for (var p = 0; p < props.length; p++) {
                    var val = cs[props[p]];
                    if (val && !DEFAULT_COLORS[val]) {
                      colorFreq[val] = (colorFreq[val] || 0) + 1;
                    }
                  }
                  if (el instanceof SVGElement) {
                    var fill = cs.fill;
                    var stroke = cs.stroke;
                    if (fill && fill !== 'none' && !DEFAULT_COLORS[fill]) {
                      colorFreq[fill] = (colorFreq[fill] || 0) + 1;
                    }
                    if (stroke && stroke !== 'none' && !DEFAULT_COLORS[stroke]) {
                      colorFreq[stroke] = (colorFreq[stroke] || 0) + 1;
                    }
                  }
                }
                var domColors = Object.keys(colorFreq)
                  .map(function(key) { return { color: key, count: colorFreq[key] }; })
                  .sort(function(a, b) { return b.count - a.count; })
                  .slice(0, 50);

                return { success: true, htmlContent: htmlContent, cssContent: cssContent, domColors: domColors };
              } catch (e) {
                return { success: false, error: { type: 'EXTRACTION_FAILED', message: e.message } };
              }
            })();
          `);

          if (!extracted || !extracted.success) {
            const errMsg =
              extracted?.error?.message || "Script execution failed";
            throw new Error(`Color extraction failed: ${errMsg}`);
          }

          return themeFromUrlController.extractColorsFromUrl({
            htmlContent: extracted.htmlContent,
            cssContent: extracted.cssContent,
            domColors: extracted.domColors,
            baseUrl: trimmedUrl,
          });
        } finally {
          destroyScanWindow();
        }
      },
    );

    // Map palette to theme
    const palette = extractionData?.palette || [];
    if (palette.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "No colors could be extracted from the URL",
            }),
          },
        ],
        isError: true,
      };
    }

    const { theme: generatedTheme } =
      paletteToThemeMapper.generateThemeFromPalette(palette);

    // Derive theme name from URL hostname if not provided
    let themeName;
    if (name && typeof name === "string" && name.trim()) {
      themeName = name.trim();
    } else {
      try {
        const { URL } = require("url");
        const parsed = new URL(trimmedUrl);
        themeName = parsed.hostname.replace(/^www\./, "");
      } catch {
        themeName = "url-theme";
      }
    }

    // Save the generated theme
    const saveResult = themeController.saveThemeForApplication(
      win,
      appId,
      themeName,
      generatedTheme,
    );

    if (saveResult.error) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: saveResult.message }) },
        ],
        isError: true,
      };
    }

    // Notify the renderer
    win.webContents.send(THEME_SAVE_COMPLETE, saveResult);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              name: themeName,
              created: true,
              colorsExtracted: palette.length,
              source: trimmedUrl,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Failed to create theme from URL: ${err.message}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * apply_theme — Applies a saved theme to the active dashboard.
 * Updates settings to set the active theme key and notifies the renderer.
 */
async function handleApplyTheme({ name }) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "name is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();
  const themeName = name.trim();

  // Verify the theme exists
  const themeResult = themeController.listThemesForApplication(win, appId);
  if (themeResult.error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: themeResult.message }),
        },
      ],
      isError: true,
    };
  }

  const themes = themeResult.themes || {};
  if (!(themeName in themes)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Theme not found: ${themeName}. Use list_themes to see available themes.`,
          }),
        },
      ],
      isError: true,
    };
  }

  // Update settings to set the active theme
  const settingsResult = settingsController.getSettingsForApplication(win);
  const settings = settingsResult?.settings || {};
  settings.theme = themeName;

  const saveResult = settingsController.saveSettingsForApplication(
    win,
    settings,
  );

  if (saveResult.error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: saveResult.message }),
        },
      ],
      isError: true,
    };
  }

  // Notify the renderer to update the theme
  win.webContents.send(SETTINGS_SAVE_COMPLETE, { settings });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ name: themeName, applied: true }, null, 2),
      },
    ],
  };
}

// --- Provider Tool Handlers ---

const { PROVIDER_LIST_COMPLETE } = require("../events");

/**
 * list_providers — Returns all configured providers with name, type, class, and status.
 * Credentials/secrets are NEVER included in the response.
 */
async function handleListProviders() {
  const { win, appId } = requireContext();
  const result = providerController.listProviders(win, appId);

  if (result.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: result.message }) },
      ],
      isError: true,
    };
  }

  const providers = (result.providers || []).map((p) => ({
    name: p.name,
    type: p.type,
    providerClass: p.providerClass || "credential",
    dateCreated: p.dateCreated,
    dateUpdated: p.dateUpdated,
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ providers, count: providers.length }, null, 2),
      },
    ],
  };
}

/**
 * add_provider — Adds a new provider with encrypted credentials.
 * Credentials are accepted on input but never returned in the response.
 */
async function handleAddProvider({
  name,
  type,
  providerClass,
  credentials,
  mcpConfig,
  allowedTools,
}) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "name is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  if (!type || typeof type !== "string" || !type.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "type is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  if (
    !credentials ||
    typeof credentials !== "object" ||
    Array.isArray(credentials)
  ) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "credentials is required and must be an object",
          }),
        },
      ],
      isError: true,
    };
  }

  const resolvedClass = providerClass || "credential";
  if (resolvedClass !== "credential" && resolvedClass !== "mcp") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "providerClass must be 'credential' or 'mcp'",
          }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();
  const providerName = name.trim();
  const providerType = type.trim();

  // Check for duplicate names
  const existing = providerController.listProviders(win, appId);
  if (!existing.error) {
    const duplicate = (existing.providers || []).find(
      (p) => p.name === providerName,
    );
    if (duplicate) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `A provider with name "${providerName}" already exists. Remove it first or use a different name.`,
            }),
          },
        ],
        isError: true,
      };
    }
  }

  const result = providerController.saveProvider(
    win,
    appId,
    providerName,
    providerType,
    credentials,
    resolvedClass,
    resolvedClass === "mcp" ? mcpConfig || null : null,
    resolvedClass === "mcp" ? allowedTools || null : null,
  );

  if (result.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: result.message }) },
      ],
      isError: true,
    };
  }

  // Notify the renderer so the UI updates
  const listResult = providerController.listProviders(win, appId);
  win.webContents.send(PROVIDER_LIST_COMPLETE, listResult);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            name: providerName,
            type: providerType,
            providerClass: resolvedClass,
            created: true,
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * remove_provider — Removes a provider by name, deleting its stored credentials.
 */
async function handleRemoveProvider({ name }) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "name is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  const { win, appId } = requireContext();
  const providerName = name.trim();

  const result = providerController.deleteProvider(win, appId, providerName);

  if (result.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: result.message }) },
      ],
      isError: true,
    };
  }

  // Notify the renderer so the UI updates
  const listResult = providerController.listProviders(win, appId);
  win.webContents.send(PROVIDER_LIST_COMPLETE, listResult);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ name: providerName, removed: true }, null, 2),
      },
    ],
  };
}

// ── Setup Guide ───────────────────────────────────────────────────────

const GUIDE_CONTENT = {
  overview: `# Dash MCP Server — What You Can Do

You are connected to Dash, a dashboard application. Here is what you can help with:

## Dashboards
- **Create** dashboards with create_dashboard
- **Populate** them with widgets using search_widgets + add_widget
- **Configure** widgets with configure_widget
- **Inspect** with list_dashboards and get_dashboard

## Themes
- **Create** themes from hex colors with create_theme
- **Extract** brand colors from any website with create_theme_from_url
- **Apply** themes with apply_theme

## Providers
- **Connect** external services (Slack, GitHub, Algolia, etc.) with add_provider
- **Check** existing connections with list_providers

## Typical Workflow
1. Create a dashboard: create_dashboard("My Dashboard")
2. Search for widgets: search_widgets("slack") or list_widgets()
3. Add widgets: add_widget(widgetName, dashboardId)
4. Configure: configure_widget(widgetId, config)
5. Style it: create_theme_from_url("https://example.com") then apply_theme(name)`,

  dashboard: `# How to Build a Dashboard

## Step 1: Create
Use create_dashboard with a descriptive name.

## Step 2: Find Widgets
- search_widgets("keyword") — find widgets by topic (e.g., "slack", "github", "analytics")
- list_widgets() — see all available widgets

## Step 3: Add Widgets
Call add_widget for each widget you want. You need the exact component name from the search/list results.

## Step 4: Configure
Use get_dashboard to see the current state, then configure_widget to set options on each widget instance.

## Tips
- You can add the same widget type multiple times with different configurations
- Some widgets require providers (check the providers field in search results)
- Use list_providers to check what is already connected`,

  theme: `# How to Create and Apply Themes

## Option A: From Colors
Use create_theme with a name and colors object:
- **primary** — buttons, links, active states (e.g., "#3b82f6" for blue)
- **secondary** — backgrounds, cards, panels (e.g., "#10b981" for emerald)
- **tertiary** — accents, badges, highlights (e.g., "#f59e0b" for amber)

Example: create_theme("My Theme", { primary: "#3b82f6", secondary: "#10b981", tertiary: "#f59e0b" })

## Option B: From a Website
Use create_theme_from_url with any website URL. Dash extracts brand colors automatically.

Example: create_theme_from_url("https://stripe.com")

## Apply
After creating, use apply_theme with the theme name.

## Browse
Use list_themes to see all saved themes, get_theme to inspect colors.`,

  provider: `# How to Set Up Providers

Providers connect Dash widgets to external services. Some widgets require providers to function.

## Available Services
Common provider types: github, slack, algolia, notion, openai, google-drive, gmail, google-calendar, brave-search, filesystem, gong

## Adding a Provider
Use add_provider with:
- **name** — display name (e.g., "My GitHub")
- **type** — service type (e.g., "github")
- **credentials** — API keys/tokens for the service

## Credential Types by Service
- **GitHub**: { token: "ghp_..." } — Personal Access Token from github.com/settings/tokens
- **Slack**: { botToken: "xoxb-...", teamId: "T..." } — from Slack app settings
- **Algolia**: { appId: "...", apiKey: "..." } — from Algolia dashboard
- **OpenAI**: { apiKey: "sk-..." } — from platform.openai.com/api-keys
- **Notion**: { apiKey: "ntn_..." } — from notion.so/my-integrations

## MCP Providers
For MCP server providers, set providerClass to "mcp" and include mcpConfig with transport, command, and args.

## Check Status
Use list_providers to see what is already connected.`,

  widget: `# How to Find and Add Widgets

## Discover Widgets
- search_widgets("keyword") — search by topic, service name, or function
- list_widgets() — browse all available widgets

## Add to Dashboard
Use add_widget with the widget component name and optionally a dashboard ID.

## Configure
After adding, use configure_widget with the widget instance ID and a config object.
Use get_dashboard to see current widget configs and discover valid config keys.

## Widget Requirements
Some widgets require providers (external service connections). Check the "providers" field in search results. Use add_provider to connect required services.

## Tips
- Widget names are case-sensitive — use the exact name from search/list results
- You can add the same widget type multiple times with different configs
- Widgets auto-refresh when providers are connected`,
};

async function handleGetSetupGuide({ topic }) {
  const key = topic || "overview";
  const content = GUIDE_CONTENT[key] || GUIDE_CONTENT.overview;

  return {
    content: [{ type: "text", text: content }],
  };
}

module.exports = {
  handleListDashboards,
  handleGetDashboard,
  handleCreateDashboard,
  handleDeleteDashboard,
  handleGetAppStats,
  handleAddWidget,
  handleRemoveWidget,
  handleConfigureWidget,
  handleListWidgets,
  handleSearchWidgets,
  handleListThemes,
  handleGetTheme,
  handleCreateTheme,
  handleCreateThemeFromUrl,
  handleApplyTheme,
  handleListProviders,
  handleAddProvider,
  handleRemoveProvider,
  handleGetSetupGuide,
};
