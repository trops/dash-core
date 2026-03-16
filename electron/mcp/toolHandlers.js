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
                const htmlContent = document.documentElement.outerHTML;
                let cssContent = '';
                try {
                  for (const sheet of document.styleSheets) {
                    try {
                      for (const rule of sheet.cssRules) {
                        cssContent += rule.cssText + '\\n';
                      }
                    } catch (e) { /* cross-origin stylesheet */ }
                  }
                } catch (e) {}
                const selectors = ['body', 'header', 'nav', 'main', 'footer', 'a', 'button', 'h1', 'h2'];
                const computedStyles = {};
                for (const sel of selectors) {
                  const el = document.querySelector(sel);
                  if (!el) continue;
                  const cs = window.getComputedStyle(el);
                  computedStyles[sel] = {
                    color: cs.color,
                    backgroundColor: cs.backgroundColor,
                    borderColor: cs.borderColor,
                  };
                }
                return { success: true, htmlContent, cssContent, computedStyles };
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
            computedStyles: extracted.computedStyles,
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
};
