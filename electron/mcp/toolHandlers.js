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
async function handleCreateDashboard({ name, layout }) {
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

  // Default to a 1×1 grid when the caller omits `layout`. A bare
  // container dashboard has no grid cells, so widgets can't be added
  // without further editing — even a single-cell grid avoids that
  // dead-end while staying unopinionated about layout. Callers that
  // want a specific size pass an explicit `layout` object. Callers
  // that genuinely want a layout-less container must pass
  // `layout: null` explicitly.
  if (layout === undefined) {
    layout = { rows: 1, cols: 1 };
  }

  // Validate optional layout parameter
  if (layout !== undefined && layout !== null) {
    if (typeof layout !== "object" || Array.isArray(layout)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "layout must be an object with rows and cols",
            }),
          },
        ],
        isError: true,
      };
    }
    const { rows, cols } = layout;
    if (
      rows === undefined ||
      cols === undefined ||
      typeof rows !== "number" ||
      typeof cols !== "number"
    ) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "layout.rows and layout.cols are required numbers",
            }),
          },
        ],
        isError: true,
      };
    }
    if (rows < 1 || rows > 10 || cols < 1 || cols > 10) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "rows and cols must be between 1 and 10",
            }),
          },
        ],
        isError: true,
      };
    }
  }

  const { win, appId } = requireContext();

  // Build root layout node — grid or plain container
  const rootNode =
    layout && layout.rows && layout.cols
      ? {
          id: 1,
          order: 1,
          component: "LayoutGridContainer",
          type: "grid",
          parent: 0,
          hasChildren: 1,
          scrollable: false,
          width: "w-full",
          height: "h-full",
          workspace: "layout",
          grid: buildEmptyGrid(
            layout.rows,
            layout.cols,
            layout.gap,
            layout.colModes,
          ),
        }
      : {
          id: 1,
          order: 1,
          component: "Container",
          parent: 0,
          items: [],
        };

  const newWorkspace = {
    id: Date.now(),
    name: name.trim(),
    label: name.trim(),
    type: "workspace",
    version: 1,
    menuId: 1,
    layout: [rootNode],
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

  // Notify renderer so UI refreshes
  win.webContents.send("workspace:saved");

  const response = { id: String(newWorkspace.id), name: newWorkspace.name };
  if (layout && layout.rows && layout.cols) {
    response.layout = { rows: layout.rows, cols: layout.cols };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(response, null, 2),
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

  // Notify renderer so UI refreshes
  win.webContents.send("workspace:saved");

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
const registryAuthController = require("../controller/registryAuthController");
const { getWidgetRegistry } = require("../widgetRegistry");

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
 * Helper: find the LayoutGridContainer node in a layout array.
 */
function findGridNode(layout) {
  if (!Array.isArray(layout)) return null;
  return (
    layout.find(
      (item) => item.component === "LayoutGridContainer" && item.grid,
    ) || null
  );
}

/**
 * Helper: build an empty grid object with cell slots for all row.col positions.
 */
function buildEmptyGrid(rows, cols, gap, colModes) {
  const grid = {
    rows,
    cols,
    gap: gap || "gap-2",
  };
  if (colModes && Object.keys(colModes).length > 0) {
    grid.colModes = colModes;
  }
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      grid[`${r}.${c}`] = { component: null, hide: false };
    }
  }
  return grid;
}

/**
 * Helper: find the next empty cell scanning left-to-right, top-to-bottom.
 */
function findNextEmptyCell(grid) {
  for (let r = 1; r <= grid.rows; r++) {
    for (let c = 1; c <= grid.cols; c++) {
      const key = `${r}.${c}`;
      const cell = grid[key];
      if (!cell || (cell.component === null && !cell.hide)) {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

/**
 * Helper: check if a row/col position is within grid bounds.
 */
function isValidCell(grid, row, col) {
  return row >= 1 && row <= grid.rows && col >= 1 && col <= grid.cols;
}

/**
 * add_widget — Add a widget to a dashboard by component name.
 */
async function handleAddWidget({ dashboardId, widgetName, row, col }) {
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

  // Validate row/col pairing
  if (
    (row !== undefined && col === undefined) ||
    (row === undefined && col !== undefined)
  ) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Both row and col must be provided together, or both omitted",
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

  const gridNode = findGridNode(layout);

  // Determine grid placement
  let targetRow = null;
  let targetCol = null;

  if (row !== undefined && col !== undefined) {
    // Explicit placement requested
    if (!gridNode) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error:
                "Cannot specify row/col: dashboard has no grid layout. Use create_dashboard with layout or set_layout first.",
            }),
          },
        ],
        isError: true,
      };
    }
    const r = Number(row);
    const c = Number(col);
    if (!isValidCell(gridNode.grid, r, c)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Cell ${r}.${c} is out of bounds (grid is ${gridNode.grid.rows}x${gridNode.grid.cols})`,
            }),
          },
        ],
        isError: true,
      };
    }
    const cellKey = `${r}.${c}`;
    const cell = gridNode.grid[cellKey];
    if (cell && cell.hide) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Cell ${r}.${c} is hidden`,
            }),
          },
        ],
        isError: true,
      };
    }
    if (cell && cell.component !== null) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Cell ${r}.${c} is already occupied by widget ${cell.component}`,
            }),
          },
        ],
        isError: true,
      };
    }
    targetRow = r;
    targetCol = c;
  } else if (gridNode) {
    // No row/col specified but grid exists — auto-place in next empty cell
    const empty = findNextEmptyCell(gridNode.grid);
    if (empty) {
      targetRow = empty.row;
      targetCol = empty.col;
    }
  }

  const parentContainerId = gridNode
    ? gridNode.id
    : container
      ? container.id
      : 0;

  const newId = nextLayoutId(layout);
  const maxOrder = layout.reduce(
    (max, item) => Math.max(max, Number(item.order) || 0),
    0,
  );

  const newItem = {
    id: newId,
    order: maxOrder + 1,
    component: widgetName.trim(),
    parent: parentContainerId,
    config: {},
  };

  workspace.layout = [...layout, newItem];

  // If placing in grid, update the cell assignment
  if (gridNode && targetRow !== null && targetCol !== null) {
    const cellKey = `${targetRow}.${targetCol}`;
    gridNode.grid[cellKey] = {
      ...(gridNode.grid[cellKey] || {}),
      component: newId,
      hide: false,
    };
  }

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

  // Notify renderer so UI refreshes
  win.webContents.send("workspace:saved");

  const response = {
    widgetId: String(newId),
    name: widgetName.trim(),
    dashboardId: String(workspace.id),
  };
  if (targetRow !== null && targetCol !== null) {
    response.cell = { row: targetRow, col: targetCol };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(response, null, 2),
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

  // Clean up grid cell assignments that reference this widget
  const numericId = Number(widgetId);
  for (const item of workspace.layout) {
    if (item.grid) {
      for (const key of Object.keys(item.grid)) {
        if (/^\d+\.\d+$/.test(key)) {
          const cell = item.grid[key];
          if (cell && cell.component === numericId) {
            cell.component = null;
          }
        }
      }
    }
  }

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

  // Notify renderer so UI refreshes
  win.webContents.send("workspace:saved");

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

  // Notify renderer so UI refreshes
  win.webContents.send("workspace:saved");

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
 * Build a Set of installed package identifiers for quick lookup.
 * Includes both scoped ("@trops/slack") and bare ("slack") forms.
 */
function getInstalledPackageNames() {
  const installed = new Set();
  try {
    const registry = getWidgetRegistry();
    const widgets = registry.getWidgets();
    for (const w of widgets) {
      const name = w.name || w.packageId || "";
      installed.add(name.toLowerCase());
      // Also add bare name for scoped packages ("@trops/slack" → "slack")
      if (name.includes("/")) {
        installed.add(name.split("/").pop().toLowerCase());
      }
    }
  } catch {
    // Widget registry may not be initialized (e.g. in tests)
  }
  return installed;
}

/**
 * Check if a registry package is locally installed.
 */
function isPackageInstalled(pkg, installedNames) {
  const candidates = [
    pkg.name,
    pkg.scope ? `@${pkg.scope}/${pkg.name}` : null,
    pkg.scope ? `${pkg.scope}/${pkg.name}` : null,
  ].filter(Boolean);
  return candidates.some((c) => installedNames.has(c.toLowerCase()));
}

/**
 * list_widgets — List available widgets from the registry.
 */
async function handleListWidgets() {
  try {
    const index = await registryController.fetchRegistryIndex();
    const packages = index.packages || [];
    const installedNames = getInstalledPackageNames();

    const widgets = [];
    for (const pkg of packages) {
      // Skip non-widget packages
      if (pkg.type && pkg.type !== "widget") continue;

      const installed = isPackageInstalled(pkg, installedNames);

      for (const w of pkg.widgets || []) {
        const shortName = w.name || pkg.name;
        const scopedName =
          pkg.scope && pkg.name && w.name
            ? `${pkg.scope}.${pkg.name}.${w.name}`
            : shortName;
        widgets.push({
          name: scopedName,
          displayName: w.displayName || w.name || pkg.displayName || pkg.name,
          description: w.description || pkg.description || "",
          icon: w.icon || pkg.icon || null,
          package: pkg.name,
          scope: pkg.scope || null,
          installed,
          providers: (w.providers || pkg.providers || []).map((p) => ({
            type: p.type,
            providerClass: p.providerClass || "api",
            required: p.required !== false,
          })),
        });
      }

      // If a package has no widgets array, treat the package itself as a widget
      if (!pkg.widgets || pkg.widgets.length === 0) {
        const scopedName =
          pkg.scope && pkg.name
            ? `${pkg.scope}.${pkg.name}.${pkg.name}`
            : pkg.name;
        widgets.push({
          name: scopedName,
          displayName: pkg.displayName || pkg.name,
          description: pkg.description || "",
          icon: pkg.icon || null,
          package: pkg.name,
          scope: pkg.scope || null,
          installed,
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
    const installedNames = getInstalledPackageNames();

    const widgets = [];
    for (const pkg of packages) {
      if (pkg.type && pkg.type !== "widget") continue;

      const installed = isPackageInstalled(pkg, installedNames);

      for (const w of pkg.widgets || []) {
        const shortName = w.name || pkg.name;
        const scopedName =
          pkg.scope && pkg.name && w.name
            ? `${pkg.scope}.${pkg.name}.${w.name}`
            : shortName;
        widgets.push({
          name: scopedName,
          displayName: w.displayName || w.name || pkg.displayName || pkg.name,
          description: w.description || pkg.description || "",
          icon: w.icon || pkg.icon || null,
          package: pkg.name,
          scope: pkg.scope || null,
          installed,
          providers: (w.providers || pkg.providers || []).map((p) => ({
            type: p.type,
            providerClass: p.providerClass || "api",
            required: p.required !== false,
          })),
        });
      }

      if (!pkg.widgets || pkg.widgets.length === 0) {
        const scopedName =
          pkg.scope && pkg.name
            ? `${pkg.scope}.${pkg.name}.${pkg.name}`
            : pkg.name;
        widgets.push({
          name: scopedName,
          displayName: pkg.displayName || pkg.name,
          description: pkg.description || "",
          icon: pkg.icon || null,
          package: pkg.name,
          scope: pkg.scope || null,
          installed,
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

/**
 * install_widget — Install a widget package from the Dash registry.
 * Requires the user to be authenticated via Settings > Account.
 */
async function handleInstallWidget({ packageName }) {
  if (!packageName || typeof packageName !== "string" || !packageName.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "packageName is required and must be a non-empty string",
          }),
        },
      ],
      isError: true,
    };
  }

  // Check authentication
  const auth = registryAuthController.getStoredToken();
  if (!auth) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Not authenticated with the Dash registry. Please sign in via Settings > Account in the Dash app first.",
            authRequired: true,
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    // Look up the package in the registry
    const pkg = await registryController.getPackage(packageName.trim());
    if (!pkg) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Package "${packageName}" not found in the registry. Use search_widgets to find available packages.`,
            }),
          },
        ],
        isError: true,
      };
    }

    if (!pkg.downloadUrl) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Package "${packageName}" has no download URL in the registry.`,
            }),
          },
        ],
        isError: true,
      };
    }

    // Download and install
    const registry = getWidgetRegistry();
    const config = await registry.downloadWidget(pkg.name, pkg.downloadUrl);

    // Notify all renderer windows
    const { win } = requireContext();
    const { BrowserWindow } = require("electron");
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send("widget:installed", {
        widgetName: pkg.name,
        config,
      });
    });

    // Build the list of installed widget names for the response
    const widgetNames = (pkg.widgets || []).map((w) => {
      const scopedName =
        pkg.scope && pkg.name && w.name
          ? `${pkg.scope}.${pkg.name}.${w.name}`
          : w.name || pkg.name;
      return {
        name: scopedName,
        displayName: w.displayName || w.name,
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              package: pkg.name,
              scope: pkg.scope || null,
              version: pkg.version || null,
              widgets: widgetNames,
              message: `Successfully installed "${pkg.displayName || pkg.name}". Use add_widget with the widget names above to add them to a dashboard.`,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    // Handle auth expiration
    if (
      err.message &&
      (err.message.includes("401") || err.message.includes("Unauthorized"))
    ) {
      registryAuthController.clearToken();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error:
                "Authentication expired. Please sign in again via Settings > Account in the Dash app.",
              authRequired: true,
            }),
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
            error: `Failed to install widget package: ${err.message}`,
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
async function handleApplyTheme({ name, dashboard }) {
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

  // Dashboard-scoped apply: if the caller provided `dashboard`
  // (either a workspace ID or a workspace name), set that workspace's
  // theme override instead of the global default. Empty/omitted
  // `dashboard` means app-level.
  const dashboardRef =
    typeof dashboard === "string" ? dashboard.trim() : dashboard;
  if (
    dashboardRef !== undefined &&
    dashboardRef !== null &&
    dashboardRef !== ""
  ) {
    const wsList = workspaceController.listWorkspacesForApplication(win, appId);
    if (wsList?.error) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: wsList.message }) },
        ],
        isError: true,
      };
    }
    const workspaces = wsList?.workspaces || [];
    // Match by numeric ID first, then by name (case-insensitive).
    const asNumber = Number(dashboardRef);
    const match =
      (!Number.isNaN(asNumber) &&
        workspaces.find((w) => Number(w.id) === asNumber)) ||
      workspaces.find(
        (w) =>
          typeof w.name === "string" &&
          w.name.toLowerCase() === String(dashboardRef).toLowerCase(),
      );
    if (!match) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Dashboard not found: ${dashboardRef}. Use list_dashboards to see available dashboards.`,
            }),
          },
        ],
        isError: true,
      };
    }
    // The renderer reads `workspace.themeKey` (via WorkspaceModel and
    // DashboardThemeProvider) — NOT `workspace.theme`. Set both for
    // forward-compat in case anything else reads the older field, but
    // `themeKey` is the one that actually drives the override.
    const updated = { ...match, themeKey: themeName, theme: themeName };
    const saveResult = workspaceController.saveWorkspaceForApplication(
      win,
      appId,
      updated,
    );
    if (saveResult?.error) {
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
    win.webContents.send("workspace:saved");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              name: themeName,
              applied: true,
              scope: "dashboard",
              dashboardId: String(match.id),
              dashboardName: match.name,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // App-level apply: update application settings
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
        text: JSON.stringify(
          { name: themeName, applied: true, scope: "app" },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * search_registry_themes — Search the online Dash registry for themes by
 * keyword. Companion to list_themes (which lists already-saved themes).
 */
async function handleSearchRegistryThemes({ query }) {
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
    const result = await registryController.searchThemes(query.trim());
    const packages = result.packages || [];

    // Build a set of locally-saved theme names so the LLM knows which
    // registry themes are already available.
    let installedNames = new Set();
    try {
      const { win, appId } = requireContext();
      const local = themeController.listThemesForApplication(win, appId);
      const themeMap = local?.themes || {};
      installedNames = new Set(Object.keys(themeMap));
    } catch {
      /* best-effort — continue with empty set if context unavailable */
    }

    const themes = packages.map((pkg) => ({
      name: pkg.name,
      scope: pkg.scope || null,
      displayName: pkg.displayName || pkg.name,
      description: pkg.description || "",
      icon: pkg.icon || null,
      installed: installedNames.has(pkg.name),
      preview: pkg.preview || null,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { query: query.trim(), themes, count: themes.length },
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
            error: `Failed to search theme registry: ${err.message}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * search_registry_dashboards — Search the online Dash registry for
 * pre-built dashboard templates.
 */
async function handleSearchRegistryDashboards({
  query,
  compatibleWidgetsOnly = false,
}) {
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
    // If compatibility filter requested, compute the list of widget
    // scoped IDs the user currently has installed. The registry
    // filter in searchDashboards then prunes dashboards whose required
    // widgets aren't all present.
    let filters = {};
    if (compatibleWidgetsOnly) {
      const installedPkgs = getInstalledPackageNames();
      filters.compatibleWidgets = Array.from(installedPkgs);
    }

    const result = await registryController.searchDashboards(
      query.trim(),
      filters,
    );
    const packages = result.packages || [];

    const dashboards = packages.map((pkg) => ({
      name: pkg.name,
      scope: pkg.scope || null,
      displayName: pkg.displayName || pkg.name,
      description: pkg.description || "",
      icon: pkg.icon || null,
      requiredWidgets: pkg.requiredWidgets || pkg.widgets || [],
      preview: pkg.preview || null,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query: query.trim(),
              compatibleWidgetsOnly,
              dashboards,
              count: dashboards.length,
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
            error: `Failed to search dashboard registry: ${err.message}`,
          }),
        },
      ],
      isError: true,
    };
  }
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
3. Add widgets: add_widget(scopedName, dashboardId) — use the name from search/list results (e.g. "trops.slack.SlackChannelFeed")
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

// --- Layout Tool Handlers ---

/**
 * set_layout — Set or replace the grid layout on a dashboard.
 */
async function handleSetLayout({ dashboardId, rows, cols, gap, colModes }) {
  if (
    rows === undefined ||
    cols === undefined ||
    typeof rows !== "number" ||
    typeof cols !== "number"
  ) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "rows and cols are required numbers",
          }),
        },
      ],
      isError: true,
    };
  }
  if (rows < 1 || rows > 10 || cols < 1 || cols > 10) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "rows and cols must be between 1 and 10",
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

  const newGrid = buildEmptyGrid(rows, cols, gap, colModes);
  const existingGridNode = findGridNode(layout);
  const orphanedWidgetIds = [];

  if (existingGridNode) {
    // Preserve cell assignments that still fit in the new dimensions
    const oldGrid = existingGridNode.grid;
    for (const key of Object.keys(oldGrid)) {
      if (
        /^\d+\.\d+$/.test(key) &&
        oldGrid[key] &&
        oldGrid[key].component !== null
      ) {
        const parts = key.split(".");
        const r = Number(parts[0]);
        const c = Number(parts[1]);
        if (r <= rows && c <= cols) {
          newGrid[key] = { ...newGrid[key], component: oldGrid[key].component };
        } else {
          orphanedWidgetIds.push(oldGrid[key].component);
        }
      }
    }
    existingGridNode.grid = newGrid;
  } else {
    // Replace root Container with a LayoutGridContainer
    const rootIdx = layout.findIndex(
      (item) =>
        item.parent === 0 &&
        (item.component === "Container" ||
          item.component === "LayoutContainer"),
    );

    const newGridNode = {
      id: rootIdx >= 0 ? layout[rootIdx].id : nextLayoutId(layout),
      order: 1,
      component: "LayoutGridContainer",
      type: "grid",
      parent: 0,
      hasChildren: 1,
      scrollable: false,
      width: "w-full",
      height: "h-full",
      workspace: "layout",
      grid: newGrid,
    };

    if (rootIdx >= 0) {
      // Reparent existing widgets to the new grid node
      const oldRootId = layout[rootIdx].id;
      for (const item of layout) {
        if (item.parent === oldRootId && item.id !== oldRootId) {
          item.parent = newGridNode.id;
        }
      }
      workspace.layout[rootIdx] = newGridNode;
    } else {
      workspace.layout = [newGridNode, ...layout];
    }
  }

  const saveResult = workspaceController.saveWorkspaceForApplication(
    win,
    appId,
    workspace,
  );
  if (saveResult.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: saveResult.message }) },
      ],
      isError: true,
    };
  }

  // Notify renderer so UI refreshes
  win.webContents.send("workspace:saved");

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            dashboardId: String(workspace.id),
            grid: { rows, cols },
            orphanedWidgets: orphanedWidgetIds.map(String),
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * update_layout — Partially update grid layout properties.
 */
async function handleUpdateLayout({ dashboardId, rows, cols, gap, colModes }) {
  if (
    rows === undefined &&
    cols === undefined &&
    gap === undefined &&
    colModes === undefined
  ) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "At least one of rows, cols, gap, or colModes must be provided",
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
  const gridNode = findGridNode(workspace.layout || []);

  if (!gridNode) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Dashboard has no grid layout. Use set_layout or create_dashboard with layout first.",
          }),
        },
      ],
      isError: true,
    };
  }

  const grid = gridNode.grid;
  const oldRows = grid.rows;
  const oldCols = grid.cols;
  const newRows = rows !== undefined ? rows : oldRows;
  const newCols = cols !== undefined ? cols : oldCols;

  if (newRows < 1 || newRows > 10 || newCols < 1 || newCols > 10) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "rows and cols must be between 1 and 10",
          }),
        },
      ],
      isError: true,
    };
  }

  // Update gap if specified
  if (gap !== undefined) {
    grid.gap = gap;
  }

  // Merge colModes if specified
  if (colModes !== undefined) {
    grid.colModes = { ...(grid.colModes || {}), ...colModes };
    // Remove entries set to null
    for (const k of Object.keys(grid.colModes)) {
      if (grid.colModes[k] === null) {
        delete grid.colModes[k];
      }
    }
    if (Object.keys(grid.colModes).length === 0) {
      delete grid.colModes;
    }
  }

  // Handle dimension changes
  const orphanedWidgetIds = [];
  if (newRows !== oldRows || newCols !== oldCols) {
    // Add new cells
    for (let r = 1; r <= newRows; r++) {
      for (let c = 1; c <= newCols; c++) {
        const key = `${r}.${c}`;
        if (!grid[key]) {
          grid[key] = { component: null, hide: false };
        }
      }
    }
    // Collect orphaned widgets from removed cells
    for (const key of Object.keys(grid)) {
      if (/^\d+\.\d+$/.test(key)) {
        const parts = key.split(".");
        const r = Number(parts[0]);
        const c = Number(parts[1]);
        if (r > newRows || c > newCols) {
          if (grid[key] && grid[key].component !== null) {
            orphanedWidgetIds.push(grid[key].component);
          }
          delete grid[key];
        }
      }
    }
    grid.rows = newRows;
    grid.cols = newCols;
  }

  const saveResult = workspaceController.saveWorkspaceForApplication(
    win,
    appId,
    workspace,
  );
  if (saveResult.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: saveResult.message }) },
      ],
      isError: true,
    };
  }

  // Notify renderer so UI refreshes
  win.webContents.send("workspace:saved");

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            dashboardId: String(workspace.id),
            grid: { rows: newRows, cols: newCols, gap: grid.gap },
            orphanedWidgets: orphanedWidgetIds.map(String),
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * move_widget — Move a widget to a different grid cell (swap if occupied).
 */
async function handleMoveWidget({ dashboardId, widgetId, row, col }) {
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
  if (row === undefined || col === undefined) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "row and col are required" }),
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
  const gridNode = findGridNode(workspace.layout || []);

  if (!gridNode) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Dashboard has no grid layout",
          }),
        },
      ],
      isError: true,
    };
  }

  const r = Number(row);
  const c = Number(col);
  if (!isValidCell(gridNode.grid, r, c)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Cell ${r}.${c} is out of bounds (grid is ${gridNode.grid.rows}x${gridNode.grid.cols})`,
          }),
        },
      ],
      isError: true,
    };
  }

  const targetKey = `${r}.${c}`;
  const targetCell = gridNode.grid[targetKey];
  if (targetCell && targetCell.hide) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Cell ${r}.${c} is hidden`,
          }),
        },
      ],
      isError: true,
    };
  }

  // Find the widget's current cell
  const numericWidgetId = Number(widgetId);
  let sourceKey = null;
  for (const key of Object.keys(gridNode.grid)) {
    if (
      /^\d+\.\d+$/.test(key) &&
      gridNode.grid[key] &&
      gridNode.grid[key].component === numericWidgetId
    ) {
      sourceKey = key;
      break;
    }
  }

  if (!sourceKey) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Widget ${widgetId} not found in any grid cell`,
          }),
        },
      ],
      isError: true,
    };
  }

  if (sourceKey === targetKey) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              widgetId,
              cell: { row: r, col: c },
              swapped: false,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // Perform the move (swap if target occupied)
  const targetComponentId = targetCell ? targetCell.component : null;
  gridNode.grid[targetKey] = {
    ...(gridNode.grid[targetKey] || {}),
    component: numericWidgetId,
  };
  gridNode.grid[sourceKey] = {
    ...(gridNode.grid[sourceKey] || {}),
    component: targetComponentId,
  };

  const saveResult = workspaceController.saveWorkspaceForApplication(
    win,
    appId,
    workspace,
  );
  if (saveResult.error) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: saveResult.message }) },
      ],
      isError: true,
    };
  }

  // Notify renderer so UI refreshes
  win.webContents.send("workspace:saved");

  const response = {
    widgetId,
    cell: { row: r, col: c },
    swapped: targetComponentId !== null,
  };
  if (targetComponentId !== null) {
    response.swappedWidgetId = String(targetComponentId);
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(response, null, 2),
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
  handleInstallWidget,
  handleListThemes,
  handleGetTheme,
  handleCreateTheme,
  handleCreateThemeFromUrl,
  handleApplyTheme,
  handleSearchRegistryThemes,
  handleSearchRegistryDashboards,
  handleListProviders,
  handleAddProvider,
  handleRemoveProvider,
  handleGetSetupGuide,
  handleSetLayout,
  handleUpdateLayout,
  handleMoveWidget,
  // Helpers (exported for testing)
  findGridNode,
  buildEmptyGrid,
  findNextEmptyCell,
  isValidCell,
};
