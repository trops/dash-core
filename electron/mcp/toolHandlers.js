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
};
