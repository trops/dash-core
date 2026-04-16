/**
 * dashboardConfigController.js
 *
 * Handles export and import of dashboard configuration files.
 * Runs in the Electron main process.
 *
 * Export: serializes a workspace into a .dashboard.json config,
 * resolving widget dependencies, extracting event wiring from
 * layout listeners, and aggregating provider requirements.
 *
 * Import: validates and processes a .dashboard.json config,
 * auto-installs missing widgets, creates workspace, and
 * applies event wiring. (Import is implemented in DASH-13.)
 */

const { app, dialog } = require("electron");
const path = require("path");
const AdmZip = require("adm-zip");
const { getFileContents } = require("../utils/file");
const {
  validateDashboardConfig,
  applyDefaults,
  CURRENT_SCHEMA_VERSION,
} = require("../schema/dashboardConfigValidator");
const {
  collectComponentNames,
  collectComponentNamesFromWorkspace,
  extractEventWiring,
  extractEventWiringFromWorkspace,
  buildWidgetDependencies,
  buildProviderRequirements,
  applyEventWiringToLayout,
} = require("../schema/dashboardConfigUtils");
const { searchRegistry, getPackage } = require("./registryController");
const { getStoredToken, clearToken } = require("./registryAuthController");
const themeController = require("./themeController");

const configFilename = "workspaces.json";
const appName = "Dashboard";

/**
 * Export a workspace as a .dashboard.json config inside a ZIP file.
 *
 * @param {BrowserWindow} win - The main window (for dialog)
 * @param {string} appId - Application identifier
 * @param {number|string} workspaceId - ID of the workspace to export
 * @param {Object} options - Export options
 * @param {string} options.authorName - Dashboard author name
 * @param {string} options.authorId - Dashboard author ID
 * @param {Object} widgetRegistry - WidgetRegistry instance (optional)
 * @returns {Promise<Object>} Result with success flag and file path
 */
async function exportDashboardConfig(
  win,
  appId,
  workspaceId,
  options = {},
  widgetRegistry = null,
) {
  try {
    // 1. Read workspace from workspaces.json
    const filename = path.join(
      app.getPath("userData"),
      appName,
      appId,
      configFilename,
    );
    const workspacesArray = getFileContents(filename);
    const workspace = workspacesArray.find(
      (w) => w.id === workspaceId || w.id === Number(workspaceId),
    );

    if (!workspace) {
      return {
        success: false,
        error: `Workspace not found: ${workspaceId}`,
      };
    }

    const layout = workspace.layout || [];

    // 2. Collect components, extract wiring, resolve deps — walk main
    //    layout, every page, and the sidebar so multi-page / sidebar
    //    dashboards export the full picture.
    const componentNames = collectComponentNamesFromWorkspace(workspace);
    const eventWiring = extractEventWiringFromWorkspace(workspace);
    const widgets = buildWidgetDependencies(componentNames, widgetRegistry);
    const providers = buildProviderRequirements(componentNames, widgetRegistry);

    // 3. Build the dashboard config
    const dashboardConfig = applyDefaults({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: workspace.name || workspace.label || "Exported Dashboard",
      description: options.description || "",
      ...(options.authorName
        ? { author: { name: options.authorName, id: options.authorId || "" } }
        : {}),
      shareable: true,
      tags: options.tags || [],
      icon: options.icon || "grip",
      workspace: {
        id: workspace.id,
        name: workspace.name,
        type: workspace.type || "workspace",
        label: workspace.label || workspace.name,
        version: workspace.version || 1,
        layout,
        ...(Array.isArray(workspace.pages) && workspace.pages.length > 0
          ? { pages: workspace.pages, activePageId: workspace.activePageId }
          : {}),
        ...(Array.isArray(workspace.sidebarLayout) &&
        workspace.sidebarLayout.length > 0
          ? {
              sidebarLayout: workspace.sidebarLayout,
              sidebarEnabled: workspace.sidebarEnabled !== false,
            }
          : {}),
        menuId: workspace.menuId || 1,
      },
      widgets,
      providers,
      eventWiring,
    });

    // 4. Bundle theme if workspace has a themeKey
    if (workspace.themeKey) {
      try {
        const themeResult = themeController.listThemesForApplication(
          win,
          appId,
        );
        const themeData = themeResult.themes?.[workspace.themeKey];
        if (themeData) {
          dashboardConfig.theme = {
            key: workspace.themeKey,
            data: themeData,
          };
          if (themeData._registryMeta?.packageName) {
            dashboardConfig.theme.registryPackage =
              themeData._registryMeta.packageName;
          }
        }
      } catch (themeErr) {
        console.warn(
          "[DashboardConfigController] Could not bundle theme:",
          themeErr.message,
        );
      }
    }

    // 5. Validate the generated config
    const validation = validateDashboardConfig(dashboardConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Generated config is invalid: ${validation.errors.join(", ")}`,
      };
    }

    // 6. Show save dialog
    const sanitizedName = (workspace.name || "dashboard")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export Dashboard as ZIP",
      defaultPath: path.join(
        app.getPath("desktop"),
        `dashboard-${sanitizedName}.zip`,
      ),
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    // 7. Create ZIP with the config
    const zip = new AdmZip();
    const configJson = JSON.stringify(dashboardConfig, null, 2);
    zip.addFile(
      `${sanitizedName}.dashboard.json`,
      Buffer.from(configJson, "utf-8"),
    );

    zip.writeZip(filePath);

    console.log(
      `[DashboardConfigController] Exported dashboard to: ${filePath}`,
    );

    return {
      success: true,
      filePath,
      config: dashboardConfig,
    };
  } catch (error) {
    console.error(
      "[DashboardConfigController] Error exporting dashboard:",
      error,
    );
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Select and preview a dashboard ZIP file without importing it.
 * Opens the file picker, extracts and validates the .dashboard.json,
 * and returns a preview of the config + the file path for later import.
 *
 * @param {BrowserWindow} win - The main window (for dialog)
 * @returns {Promise<Object>} Result with success, filePath, and dashboardConfig preview
 */
async function selectDashboardFile(win) {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Import Dashboard Configuration",
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      properties: ["openFile"],
    });

    if (canceled || !filePaths || !filePaths.length) {
      return { success: false, canceled: true };
    }

    const zipPath = filePaths[0];

    // Extract and validate
    const zip = new AdmZip(zipPath);
    const tempDir = path.join(app.getPath("temp"), "dash-import");
    const { validateZipEntries } = require("../widgetRegistry");
    validateZipEntries(zip, tempDir);

    const entries = zip.getEntries();
    const configEntry = entries.find((e) =>
      e.entryName.endsWith(".dashboard.json"),
    );

    if (!configEntry) {
      return {
        success: false,
        error: "No .dashboard.json file found in ZIP archive",
      };
    }

    const configJson = configEntry.getData().toString("utf-8");
    let dashboardConfig;
    try {
      dashboardConfig = JSON.parse(configJson);
    } catch (parseError) {
      return {
        success: false,
        error: `Invalid JSON: ${parseError.message}`,
      };
    }

    const validation = validateDashboardConfig(dashboardConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid config: ${validation.errors.join(", ")}`,
      };
    }

    dashboardConfig = applyDefaults(dashboardConfig);

    return {
      success: true,
      filePath: zipPath,
      dashboardConfig: {
        name: dashboardConfig.name,
        description: dashboardConfig.description,
        author: dashboardConfig.author,
        workspace: dashboardConfig.workspace,
        widgets: dashboardConfig.widgets || [],
        providers: dashboardConfig.providers || [],
      },
    };
  } catch (error) {
    console.error(
      "[DashboardConfigController] Error selecting dashboard file:",
      error,
    );
    return { success: false, error: error.message };
  }
}

/**
 * Import a dashboard from a ZIP file containing a .dashboard.json config.
 *
 * Steps:
 * 1. Show native file picker for .zip selection (or use options.filePath)
 * 2. Extract and validate .dashboard.json
 * 3. Auto-install missing widgets from registry
 * 4. Create workspace in workspaces.json
 * 5. Apply event wiring to layout
 * 6. Mark imported dashboard shareable: false
 *
 * @param {BrowserWindow} win - The main window (for dialog)
 * @param {string} appId - Application identifier
 * @param {Object} widgetRegistry - WidgetRegistry instance (needs getWidgets(), downloadWidget())
 * @param {Object} options - Import options
 * @param {string} options.filePath - Skip file picker, use this path directly
 * @param {string} options.name - Override workspace name
 * @param {number} options.menuId - Override workspace menuId (folder)
 * @param {string} options.themeKey - Override workspace themeKey
 * @returns {Promise<Object>} Result with success, workspace, and import summary
 */
async function importDashboardConfig(
  win,
  appId,
  widgetRegistry = null,
  options = {},
) {
  try {
    let zipPath;

    if (options.filePath) {
      // Use the provided file path (from selectDashboardFile)
      zipPath = options.filePath;
    } else {
      // Show file picker
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: "Import Dashboard Configuration",
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
        properties: ["openFile"],
      });

      if (canceled || !filePaths || !filePaths.length) {
        return { success: false, canceled: true };
      }

      zipPath = filePaths[0];
    }

    // 2. Extract and validate .dashboard.json from ZIP
    const zip = new AdmZip(zipPath);

    // Validate ZIP entries for path traversal
    const tempDir = path.join(app.getPath("temp"), "dash-import");
    const { validateZipEntries } = require("../widgetRegistry");
    validateZipEntries(zip, tempDir);

    // Find the .dashboard.json file
    const entries = zip.getEntries();
    const configEntry = entries.find((e) =>
      e.entryName.endsWith(".dashboard.json"),
    );

    if (!configEntry) {
      return {
        success: false,
        error: "No .dashboard.json file found in ZIP archive",
      };
    }

    const configJson = configEntry.getData().toString("utf-8");
    let dashboardConfig;
    try {
      dashboardConfig = JSON.parse(configJson);
    } catch (parseError) {
      return {
        success: false,
        error: `Invalid JSON in ${configEntry.entryName}: ${parseError.message}`,
      };
    }

    // Validate against schema
    const validation = validateDashboardConfig(dashboardConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid dashboard config: ${validation.errors.join(", ")}`,
      };
    }

    // Apply defaults to fill in optional fields
    dashboardConfig = applyDefaults(dashboardConfig);

    // Delegate to shared import pipeline with overrides
    return await processDashboardConfig(
      win,
      appId,
      dashboardConfig,
      widgetRegistry,
      {
        name: options.name,
        menuId: options.menuId,
        themeKey: options.themeKey,
      },
    );
  } catch (error) {
    console.error(
      "[DashboardConfigController] Error importing dashboard:",
      error,
    );
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Shared import pipeline: install widgets, create workspace, wire events.
 * Used by both importDashboardConfig (ZIP) and installDashboardFromRegistry.
 *
 * @param {BrowserWindow} win - The main window
 * @param {string} appId - Application identifier
 * @param {Object} dashboardConfig - Validated dashboard config object
 * @param {Object} widgetRegistry - WidgetRegistry instance
 * @param {Object} options - Additional options
 * @param {string} options.source - Source label ("zip" or "registry")
 * @returns {Promise<Object>} Result with success, workspace, and summary
 */
async function processDashboardConfig(
  win,
  appId,
  dashboardConfig,
  widgetRegistry = null,
  options = {},
) {
  const source = options.source || "zip";

  // 1. Auto-install missing widgets from registry
  const installSummary = {
    installed: [],
    alreadyInstalled: [],
    failed: [],
  };

  const {
    DASHBOARD_CONFIG_INSTALL_PROGRESS,
  } = require("../events/dashboardConfigEvents");

  // Compute total progress items (widgets + optional theme)
  const hasTheme = !!(dashboardConfig.theme && dashboardConfig.theme.key);
  const widgetTotal = dashboardConfig.widgets
    ? dashboardConfig.widgets.length
    : 0;
  const themeIndex = widgetTotal;
  const progressTotal = widgetTotal + (hasTheme ? 1 : 0);

  if (
    widgetRegistry &&
    dashboardConfig.widgets &&
    dashboardConfig.widgets.length
  ) {
    const installedWidgets = widgetRegistry.getWidgets();
    const installedPackages = new Set(installedWidgets.map((w) => w.name));

    // Emit initial "pending" state for all widgets
    for (let i = 0; i < widgetTotal; i++) {
      const dep = dashboardConfig.widgets[i];
      win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
        packageName: dep.package,
        displayName: dep.displayName || dep.name || dep.package,
        status: "pending",
        index: i,
        total: progressTotal,
      });
    }

    // Emit initial "pending" state for theme (if present)
    if (hasTheme) {
      const themeDisplay =
        dashboardConfig.theme.name ||
        dashboardConfig.theme.key ||
        "Bundled Theme";
      win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
        packageName:
          dashboardConfig.theme.registryPackage ||
          dashboardConfig.theme.key ||
          "theme",
        displayName: themeDisplay,
        status: "pending",
        index: themeIndex,
        total: progressTotal,
      });
    }

    for (let i = 0; i < widgetTotal; i++) {
      const widgetDep = dashboardConfig.widgets[i];
      const packageName = widgetDep.package;
      const displayName =
        widgetDep.displayName || widgetDep.name || packageName;

      if (installedPackages.has(packageName)) {
        installSummary.alreadyInstalled.push(packageName);
        win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
          packageName,
          displayName,
          status: "already-installed",
          index: i,
          total: progressTotal,
        });
        continue;
      }

      // Emit downloading status
      win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
        packageName,
        displayName,
        status: "downloading",
        index: i,
        total: progressTotal,
      });

      // Try to find the widget in the registry and install it
      try {
        const registryPkg = await getPackage(packageName);
        if (registryPkg && registryPkg.downloadUrl) {
          const config = await widgetRegistry.downloadWidget(
            packageName,
            registryPkg.downloadUrl,
            registryPkg.dashConfigUrl || null,
          );
          installSummary.installed.push({ packageName, config });
          installedPackages.add(packageName);
          win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
            packageName,
            displayName,
            status: "installed",
            index: i,
            total: progressTotal,
          });
        } else {
          installSummary.failed.push({
            package: packageName,
            reason: "Not found in registry",
          });
          win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
            packageName,
            displayName,
            status: "failed",
            index: i,
            total: progressTotal,
            error: "Not found in registry",
          });
        }
      } catch (installError) {
        installSummary.failed.push({
          package: packageName,
          reason: installError.message,
        });
        win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
          packageName,
          displayName,
          status: "failed",
          index: i,
          total: progressTotal,
          error: installError.message,
        });
      }
    }

    // Notify renderer about auto-installed widgets
    if (installSummary.installed.length > 0) {
      const { BrowserWindow } = require("electron");
      for (const { packageName, config } of installSummary.installed) {
        BrowserWindow.getAllWindows().forEach((w) => {
          w.webContents.send("widget:installed", {
            widgetName: packageName,
            config: config || {},
          });
        });
      }
    }

    // Flatten installed list to just package names for the summary
    installSummary.installed = installSummary.installed.map((entry) =>
      typeof entry === "string" ? entry : entry.packageName,
    );
  }

  // 2. Install bundled theme if present
  let themeInstalled = null;
  if (dashboardConfig.theme) {
    const bundledTheme = dashboardConfig.theme;
    const themeDisplay =
      bundledTheme.name || bundledTheme.key || "Bundled Theme";
    const themePackageName =
      bundledTheme.registryPackage || bundledTheme.key || "theme";

    try {
      const themeResult = themeController.listThemesForApplication(win, appId);
      const existingThemes = themeResult.themes || {};
      const themeKey = bundledTheme.key;

      if (themeKey) {
        if (bundledTheme.data && !existingThemes[themeKey]) {
          // Theme is new — install it
          win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
            packageName: themePackageName,
            displayName: themeDisplay,
            status: "downloading",
            index: themeIndex,
            total: progressTotal,
          });

          const themeData = { ...bundledTheme.data };
          if (bundledTheme.registryPackage) {
            themeData._registryMeta = {
              source: "dashboard-import",
              packageName: bundledTheme.registryPackage,
              installedAt: new Date().toISOString(),
            };
          }
          const saveResult = themeController.saveThemeForApplication(
            win,
            appId,
            themeKey,
            themeData,
          );
          if (saveResult.error) {
            console.warn(
              `[DashboardConfigController] Theme save failed: ${saveResult.message}`,
            );
            win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
              packageName: themePackageName,
              displayName: themeDisplay,
              status: "failed",
              index: themeIndex,
              total: progressTotal,
              error: saveResult.message,
            });
          } else {
            console.log(
              `[DashboardConfigController] Installed bundled theme: ${themeKey}`,
            );
            win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
              packageName: themePackageName,
              displayName: themeDisplay,
              status: "installed",
              index: themeIndex,
              total: progressTotal,
            });
          }
        } else if (
          !bundledTheme.data &&
          bundledTheme.registryPackage &&
          !existingThemes[themeKey]
        ) {
          // Fallback: try to install from registry by package name
          win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
            packageName: themePackageName,
            displayName: themeDisplay,
            status: "downloading",
            index: themeIndex,
            total: progressTotal,
          });

          try {
            const {
              installThemeFromRegistry,
            } = require("./themeRegistryController");
            await installThemeFromRegistry(
              win,
              appId,
              bundledTheme.registryPackage,
            );
            console.log(
              `[DashboardConfigController] Installed theme from registry: ${bundledTheme.registryPackage}`,
            );
            win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
              packageName: themePackageName,
              displayName: themeDisplay,
              status: "installed",
              index: themeIndex,
              total: progressTotal,
            });
          } catch (registryErr) {
            console.warn(
              `[DashboardConfigController] Could not install theme from registry: ${registryErr.message}`,
            );
            win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
              packageName: themePackageName,
              displayName: themeDisplay,
              status: "failed",
              index: themeIndex,
              total: progressTotal,
              error: registryErr.message,
            });
          }
        } else if (existingThemes[themeKey]) {
          console.log(
            `[DashboardConfigController] Theme already exists: ${themeKey}`,
          );
          win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
            packageName: themePackageName,
            displayName: themeDisplay,
            status: "already-installed",
            index: themeIndex,
            total: progressTotal,
          });
        }
        // Always bind workspace to theme key
        themeInstalled = themeKey;
      }
    } catch (themeErr) {
      console.warn(
        `[DashboardConfigController] Could not install bundled theme: ${themeErr.message}`,
      );
      win.webContents.send(DASHBOARD_CONFIG_INSTALL_PROGRESS, {
        packageName: themePackageName,
        displayName: themeDisplay,
        status: "failed",
        index: themeIndex,
        total: progressTotal,
        error: themeErr.message,
      });
    }
  }

  // 3. Build workspace from config
  const workspace = { ...dashboardConfig.workspace };

  if (!workspace || !workspace.layout) {
    return {
      success: false,
      error: "Dashboard config has no workspace data",
    };
  }

  // Generate a unique ID for the imported workspace
  workspace.id = Date.now();

  // Apply name/menuId/themeKey overrides if provided
  if (options.name) workspace.name = options.name;
  if (options.menuId !== undefined) workspace.menuId = options.menuId;
  if (options.themeKey !== undefined) workspace.themeKey = options.themeKey;

  // Set themeKey from bundled theme if it was installed and no override given
  if (themeInstalled && options.themeKey === undefined) {
    workspace.themeKey = themeInstalled;
  }

  // 4. Apply event wiring to layout
  const eventWiringSummary = [];
  if (
    dashboardConfig.eventWiring &&
    dashboardConfig.eventWiring.length &&
    workspace.layout
  ) {
    applyEventWiringToLayout(workspace.layout, dashboardConfig.eventWiring);
    for (const wire of dashboardConfig.eventWiring) {
      eventWiringSummary.push(
        `${wire.source?.widget}.${wire.source?.event} → ${wire.target?.widget}.${wire.target?.handler}`,
      );
    }
  }

  // 5. Mark as not shareable (imported dashboards cannot be re-published)
  workspace._dashboardConfig = {
    shareable: false,
    source,
    importedFrom: dashboardConfig.name,
    importedAt: new Date().toISOString(),
    originalAuthor: dashboardConfig.author,
    schemaVersion: dashboardConfig.schemaVersion,
    registryPackage: options.registryPackage || null,
    installedVersion: options.installedVersion || null,
  };

  // Save workspace to workspaces.json
  const workspaceController = require("./workspaceController");
  const saveResult = workspaceController.saveWorkspaceForApplication(
    win,
    appId,
    workspace,
  );

  if (saveResult.error) {
    return {
      success: false,
      error: `Failed to save workspace: ${saveResult.message}`,
    };
  }

  // Build provider requirements summary
  const providerSummary = (dashboardConfig.providers || []).map((p) => ({
    type: p.type,
    providerClass: p.providerClass,
    required: p.required,
    usedBy: p.usedBy,
  }));

  console.log(
    `[DashboardConfigController] Imported dashboard "${dashboardConfig.name}" (${source}) as workspace ${workspace.id}`,
  );

  return {
    success: true,
    workspace,
    summary: {
      name: dashboardConfig.name,
      description: dashboardConfig.description || "",
      author: dashboardConfig.author,
      widgets: installSummary,
      eventsWired: eventWiringSummary,
      providersRequired: providerSummary,
      themeInstalled: themeInstalled || null,
    },
  };
}

/**
 * Install a dashboard from the registry by package name.
 *
 * Fetches the dashboard ZIP from the registry, extracts the .dashboard.json,
 * validates it, and delegates to the shared import pipeline.
 *
 * @param {BrowserWindow} win - The main window
 * @param {string} appId - Application identifier
 * @param {string} packageName - Registry package name for the dashboard
 * @param {Object} widgetRegistry - WidgetRegistry instance
 * @returns {Promise<Object>} Result with success, workspace, and summary
 */
async function installDashboardFromRegistry(
  win,
  appId,
  packageName,
  widgetRegistry = null,
) {
  try {
    // 1. Look up the dashboard package in the registry
    const registryPkg = await getPackage(packageName);
    if (!registryPkg) {
      return {
        success: false,
        error: `Dashboard package not found in registry: ${packageName}`,
      };
    }

    // 2. Construct download URL via /api/packages/.../download endpoint
    //    (matches theme download flow in themeRegistryController.js)
    const registryBaseUrl =
      process.env.DASH_REGISTRY_API_URL ||
      "https://main.d919rwhuzp7rj.amplifyapp.com";
    const downloadUrl = `${registryBaseUrl}/api/packages/${encodeURIComponent(registryPkg.scope)}/${encodeURIComponent(registryPkg.name)}/download?version=${encodeURIComponent(registryPkg.version || "1.0.0")}`;

    console.log(
      `[DashboardConfigController] Fetching dashboard from: ${downloadUrl}`,
    );

    // Download the ZIP (with auth header)
    const auth = getStoredToken();
    if (!auth) {
      return {
        success: false,
        error: "Not authenticated with registry",
        authRequired: true,
      };
    }
    const headers = {};
    if (auth?.token) {
      headers["Authorization"] = `Bearer ${auth.token}`;
    }
    const response = await fetch(downloadUrl, { headers });
    if (response.status === 401) {
      clearToken();
      return {
        success: false,
        error: "Authentication expired. Please sign in again.",
        authRequired: true,
      };
    }
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to download dashboard: ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const arrayBuffer = await response.arrayBuffer();
    let zipBuffer = Buffer.from(arrayBuffer);

    if (zipBuffer.length === 0) {
      return {
        success: false,
        error: "Download failed: registry returned an empty response.",
      };
    }

    if (contentType.includes("text/html")) {
      return {
        success: false,
        error:
          "Download failed: registry returned an HTML page instead of package data.",
      };
    }

    if (contentType.includes("application/json")) {
      let jsonData;
      try {
        jsonData = JSON.parse(zipBuffer.toString("utf-8"));
      } catch (parseErr) {
        return {
          success: false,
          error: `Download failed: invalid JSON (${parseErr.message}).`,
        };
      }
      if (jsonData.error) {
        return {
          success: false,
          error: `Download failed: ${jsonData.error}`,
        };
      }
      if (jsonData.downloadUrl) {
        let zipResponse;
        try {
          zipResponse = await fetch(jsonData.downloadUrl);
        } catch (fetchErr) {
          return {
            success: false,
            error: `Download failed: could not fetch ZIP from storage (${fetchErr.message}).`,
          };
        }
        if (!zipResponse.ok) {
          return {
            success: false,
            error: `Download failed: storage returned ${zipResponse.status} ${zipResponse.statusText}`,
          };
        }
        zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
        if (zipBuffer.length === 0) {
          return {
            success: false,
            error: "Download failed: storage returned an empty ZIP file.",
          };
        }
      }
    }

    const zip = new AdmZip(zipBuffer);

    // 3. Validate ZIP entries
    const tempDir = path.join(app.getPath("temp"), "dash-registry-import");
    const { validateZipEntries } = require("../widgetRegistry");
    validateZipEntries(zip, tempDir);

    // 4. Find and parse .dashboard.json
    const entries = zip.getEntries();
    const configEntry = entries.find((e) =>
      e.entryName.endsWith(".dashboard.json"),
    );

    if (!configEntry) {
      return {
        success: false,
        error: "No .dashboard.json file found in downloaded archive",
      };
    }

    const configJson = configEntry.getData().toString("utf-8");
    let dashboardConfig;
    try {
      dashboardConfig = JSON.parse(configJson);
    } catch (parseError) {
      return {
        success: false,
        error: `Invalid JSON in dashboard config: ${parseError.message}`,
      };
    }

    // 5. Validate against schema
    const validation = validateDashboardConfig(dashboardConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid dashboard config: ${validation.errors.join(", ")}`,
      };
    }

    dashboardConfig = applyDefaults(dashboardConfig);

    // 5b. Inject theme metadata from registry if config has no theme section
    if (
      !dashboardConfig.theme &&
      registryPkg.theme &&
      registryPkg.theme.registryPackage
    ) {
      dashboardConfig.theme = {
        key: registryPkg.theme.key || registryPkg.theme.name,
        registryPackage: registryPkg.theme.registryPackage,
      };
    }

    // 6. Delegate to shared import pipeline
    return await processDashboardConfig(
      win,
      appId,
      dashboardConfig,
      widgetRegistry,
      {
        source: "registry",
        registryPackage: packageName,
        installedVersion: registryPkg.version || null,
      },
    );
  } catch (error) {
    console.error(
      "[DashboardConfigController] Error installing dashboard from registry:",
      error,
    );
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Check compatibility of a dashboard's widget dependencies against
 * installed widgets and registry availability.
 *
 * @param {Array} dashboardWidgets - Widget deps from dashboard config
 * @param {Object} widgetRegistry - WidgetRegistry instance (needs getWidgets())
 * @returns {Promise<Object>} Compatibility report
 */
async function checkCompatibility(dashboardWidgets, widgetRegistry = null) {
  const {
    checkDashboardCompatibility,
  } = require("../schema/dashboardConfigUtils");
  const { fetchRegistryIndex } = require("./registryController");

  const installedWidgets = widgetRegistry ? widgetRegistry.getWidgets() : [];

  let registryPackages = [];
  try {
    const index = await fetchRegistryIndex();
    registryPackages = index.packages || [];
  } catch (err) {
    console.warn(
      "[DashboardConfigController] Could not fetch registry index for compatibility check:",
      err.message,
    );
  }

  return checkDashboardCompatibility(
    dashboardWidgets,
    installedWidgets,
    registryPackages,
  );
}

/**
 * Collect enriched dependency info for a workspace — widgets + theme.
 *
 * Read-only. Used by the batch-publish dialog to build its dependency
 * table. Resolves local state (scope, name, version from each widget's
 * package.json, and packageDir for later zipping). Does NOT query the
 * registry — that's the caller's job (see registry resolve endpoint).
 *
 * @param {string} appId - Application identifier
 * @param {number|string} workspaceId - Workspace ID
 * @param {Object} widgetRegistry - WidgetRegistry instance
 * @param {Object} options - { componentConfigs?: Object }
 * @returns {Promise<Object>} { success, widgets, theme }
 */
async function collectDashboardDependencies(
  appId,
  workspaceId,
  widgetRegistry = null,
  options = {},
) {
  try {
    // 1. Read workspace
    const filename = path.join(
      app.getPath("userData"),
      appName,
      appId,
      configFilename,
    );
    const workspacesArray = getFileContents(filename);
    const workspace = workspacesArray.find(
      (w) => w.id === workspaceId || w.id === Number(workspaceId),
    );

    if (!workspace) {
      return {
        success: false,
        error: `Workspace not found: ${workspaceId}`,
      };
    }

    // 2. Collect component names from main + pages + sidebar layouts
    const componentNames = collectComponentNamesFromWorkspace(workspace);

    // 3. Resolve widget refs (scope, packageName, widgetName, version)
    const deps = buildWidgetDependencies(
      componentNames,
      widgetRegistry,
      options.componentConfigs || null,
    );

    // 4. Enrich with packageDir + componentNames-in-package (from registry)
    //    so the caller can zip and publish each widget.
    const installedWidgets = widgetRegistry ? widgetRegistry.getWidgets() : [];

    const widgets = deps.map((dep) => {
      // Match by componentName OR by any shape of the package id.
      // Registry packages are stored as `@scope/name` but callers may
      // synthesize `scope/name`; try both before giving up.
      const candidateIds = new Set();
      if (dep.scope && dep.packageName) {
        candidateIds.add(`@${dep.scope}/${dep.packageName}`);
        candidateIds.add(`${dep.scope}/${dep.packageName}`);
      }
      const match = installedWidgets.find(
        (w) =>
          (w.componentNames && w.componentNames.includes(dep.widgetName)) ||
          (w.scope === dep.scope &&
            (w.name === dep.packageName ||
              candidateIds.has(w.packageId) ||
              candidateIds.has(w.name))),
      );

      return {
        scope: dep.scope || null,
        packageName: dep.packageName,
        widgetName: dep.widgetName,
        component: dep.widgetName,
        localVersion: dep.version,
        packageDir: match?.path || null,
        packageId:
          match?.packageId ||
          (dep.scope && dep.packageName
            ? `@${dep.scope}/${dep.packageName}`
            : null),
        author: dep.author || "",
        hasLocalPackage: !!match?.path,
      };
    });

    // 5. Resolve theme (if workspace has one)
    let theme = null;
    if (workspace.themeKey) {
      try {
        const themeResult = themeController.listThemesForApplication(
          null,
          appId,
        );
        const themeData = themeResult?.themes?.[workspace.themeKey];
        if (themeData) {
          const registryMeta = themeData._registryMeta || {};
          theme = {
            themeKey: workspace.themeKey,
            scope: registryMeta.scope || null,
            name: registryMeta.name || workspace.themeKey,
            localVersion: registryMeta.version || null,
            hasRegistryMeta: !!themeData._registryMeta,
          };
        }
      } catch (err) {
        console.warn(
          "[dashboardConfig] Could not resolve theme for dependencies:",
          err.message,
        );
      }
    }

    return { success: true, widgets, theme };
  } catch (error) {
    console.error(
      "[dashboardConfig] collectDashboardDependencies failed:",
      error,
    );
    return { success: false, error: error.message };
  }
}

/**
 * Build an enriched dependency plan for batch-publishing a dashboard.
 *
 * Combines local dependency info (collectDashboardDependencies) with the
 * registry's current state (POST /api/packages/resolve) so the batch-
 * publish UI can decorate each widget + theme row with "already in
 * registry at vX.Y.Z", "owned by you", "public/private", etc.
 *
 * Each returned widget has a `registry` sub-object that is either null
 * (registry call failed or the package didn't exist) or the resolved
 * entry from the API. Never throws on registry failures — the UI can
 * still fall back to local-only info.
 *
 * @param {string} appId - Application identifier
 * @param {number|string} workspaceId - Workspace ID
 * @param {Object} widgetRegistry - WidgetRegistry instance
 * @param {Object} options - { componentConfigs?: Object }
 * @returns {Promise<Object>} { success, widgets, theme, registryError? }
 */
async function getDashboardPublishPlan(
  appId,
  workspaceId,
  widgetRegistry = null,
  options = {},
) {
  try {
    const { resolvePackages } = require("./registryApiController");
    const { getRegistryProfile } = require("./registryAuthController");

    const deps = await collectDashboardDependencies(
      appId,
      workspaceId,
      widgetRegistry,
      options,
    );
    if (!deps.success) {
      return { success: false, error: deps.error };
    }

    // Local scopes (e.g. `@ai-built/…` for AI-generated widgets) differ
    // from the registry scope — widgets always publish under the caller's
    // username. Resolve against the caller's scope so "exists / owned /
    // latest version" reflect reality.
    const profile = await getRegistryProfile().catch(() => null);
    const callerScope = profile?.username || null;

    const publishScopeFor = (w) => {
      if (!w.scope || !w.packageName) return null;
      return callerScope || w.scope;
    };

    // Dedupe by publish-scope/name — many components share the same
    // package, and duplicate refs waste registry calls.
    const refs = [];
    const seenRefs = new Set();
    for (const w of deps.widgets) {
      const scope = publishScopeFor(w);
      if (!scope || !w.packageName) continue;
      const key = `${scope}/${w.packageName}`;
      if (seenRefs.has(key)) continue;
      seenRefs.add(key);
      refs.push({ scope, name: w.packageName });
    }
    if (deps.theme && deps.theme.scope && deps.theme.name) {
      refs.push({
        scope: callerScope || deps.theme.scope,
        name: deps.theme.name,
      });
    }

    let registryError = null;
    const resolvedByKey = new Map();
    if (refs.length > 0) {
      const res = await resolvePackages(refs);
      if (res.success && Array.isArray(res.resolved)) {
        for (const r of res.resolved) {
          resolvedByKey.set(`${r.scope}/${r.name}`, r);
        }
      } else {
        registryError = res.error || "Registry lookup failed";
      }
    }

    const widgets = deps.widgets.map((w) => {
      const publishScope = publishScopeFor(w);
      const key =
        publishScope && w.packageName
          ? `${publishScope}/${w.packageName}`
          : null;
      return {
        ...w,
        publishScope,
        registry: key ? resolvedByKey.get(key) || null : null,
      };
    });

    let theme = null;
    if (deps.theme) {
      const themeScope = callerScope || deps.theme.scope;
      const key =
        themeScope && deps.theme.name
          ? `${themeScope}/${deps.theme.name}`
          : null;
      theme = {
        ...deps.theme,
        publishScope: themeScope,
        registry: key ? resolvedByKey.get(key) || null : null,
      };
    }

    return {
      success: true,
      widgets,
      theme,
      callerScope,
      ...(registryError ? { registryError } : {}),
    };
  } catch (error) {
    console.error("[dashboardConfig] getDashboardPublishPlan failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Prepare a dashboard for publishing to the registry.
 *
 * Validates that the workspace is shareable, builds the dashboard config,
 * checks that all widgets exist in the registry, generates a registry
 * manifest, and creates a ZIP containing both the manifest and
 * .dashboard.json config.
 *
 * @param {BrowserWindow} win - The main window (for save dialog)
 * @param {string} appId - Application identifier
 * @param {number|string} workspaceId - ID of the workspace to publish
 * @param {Object} options - Publishing options
 * @param {string} options.authorName - Author name
 * @param {string} options.authorId - Author ID
 * @param {string} options.description - Dashboard description
 * @param {string[]} options.tags - Tags
 * @param {string} options.icon - Icon name
 * @param {string} options.githubUser - GitHub user/org for registry scope
 * @param {string} options.category - Registry category
 * @param {Object} widgetRegistry - WidgetRegistry instance
 * @returns {Promise<Object>} Result with success, manifest, and filePath
 */
async function prepareDashboardForPublish(
  win,
  appId,
  workspaceId,
  options = {},
  widgetRegistry = null,
) {
  try {
    const {
      generateRegistryManifest,
    } = require("../schema/dashboardConfigUtils");

    // 1. Read workspace
    const filename = path.join(
      app.getPath("userData"),
      appName,
      appId,
      configFilename,
    );
    const workspacesArray = getFileContents(filename);
    const workspace = workspacesArray.find(
      (w) => w.id === workspaceId || w.id === Number(workspaceId),
    );

    if (!workspace) {
      return {
        success: false,
        error: `Workspace not found: ${workspaceId}`,
      };
    }

    // 2. Check shareable flag — imported dashboards cannot be published
    if (
      workspace._dashboardConfig &&
      workspace._dashboardConfig.shareable === false
    ) {
      return {
        success: false,
        error:
          "This dashboard was imported and cannot be published. Only dashboards you created can be shared.",
      };
    }

    const layout = workspace.layout || [];

    // 3. Build the dashboard config — walk main + pages + sidebar
    const componentNames = collectComponentNamesFromWorkspace(workspace);
    const eventWiring = extractEventWiringFromWorkspace(workspace);

    // Build componentConfigs map from renderer-supplied data
    // This resolves scope/packageName for built-in widgets that aren't in widgetRegistry
    let componentConfigs = null;
    if (options.componentConfigs) {
      componentConfigs = {};
      for (const [key, config] of Object.entries(options.componentConfigs)) {
        componentConfigs[key] = config;
      }
    }

    const widgets = buildWidgetDependencies(
      componentNames,
      widgetRegistry,
      componentConfigs,
    );
    const providers = buildProviderRequirements(componentNames, widgetRegistry);

    const dashboardConfig = applyDefaults({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: workspace.name || workspace.label || "Dashboard",
      description: options.description || "",
      ...(options.authorName
        ? { author: { name: options.authorName, id: options.authorId || "" } }
        : {}),
      shareable: true,
      tags: options.tags || [],
      icon: options.icon || "grip",
      workspace: {
        id: workspace.id,
        name: workspace.name,
        type: workspace.type || "workspace",
        label: workspace.label || workspace.name,
        version: workspace.version || 1,
        layout,
        ...(Array.isArray(workspace.pages) && workspace.pages.length > 0
          ? { pages: workspace.pages, activePageId: workspace.activePageId }
          : {}),
        ...(Array.isArray(workspace.sidebarLayout) &&
        workspace.sidebarLayout.length > 0
          ? {
              sidebarLayout: workspace.sidebarLayout,
              sidebarEnabled: workspace.sidebarEnabled !== false,
            }
          : {}),
        menuId: workspace.menuId || 1,
      },
      widgets,
      providers,
      eventWiring,
    });

    // 4. Bundle theme if workspace has a themeKey
    if (workspace.themeKey) {
      try {
        const themeResult = themeController.listThemesForApplication(
          win,
          appId,
        );
        const themeData = themeResult.themes?.[workspace.themeKey];
        if (themeData) {
          dashboardConfig.theme = {
            key: workspace.themeKey,
            data: themeData,
          };
          if (themeData._registryMeta?.packageName) {
            dashboardConfig.theme.registryPackage =
              themeData._registryMeta.packageName;
          }
        }
      } catch (themeErr) {
        console.warn(
          "[DashboardConfigController] Could not bundle theme for publish:",
          themeErr.message,
        );
      }
    }

    // 5. Validate the config
    const validation = validateDashboardConfig(dashboardConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Generated config is invalid: ${validation.errors.join(", ")}`,
      };
    }

    // 6. Check which widgets exist in the registry (soft warning, not blocking)
    const { fetchRegistryIndex } = require("./registryController");
    let registryPackages = [];
    let registryCheckFailed = false;
    try {
      const index = await fetchRegistryIndex();
      registryPackages = index.packages || [];
    } catch (err) {
      console.warn(
        `[DashboardConfigController] Unable to verify registry: ${err.message}`,
      );
      registryCheckFailed = true;
    }

    let missingFromRegistry = [];
    if (!registryCheckFailed) {
      const registryNames = new Set(registryPackages.map((p) => p.name));
      const registryWidgetNames = new Set();
      for (const pkg of registryPackages) {
        if (pkg.widgets) {
          for (const w of pkg.widgets) {
            if (w.name) registryWidgetNames.add(w.name);
          }
        }
      }
      const missingWidgets = widgets.filter(
        (w) =>
          w.required !== false &&
          !registryNames.has(w.package) &&
          !registryWidgetNames.has(w.package),
      );
      const grouped = {};
      for (const w of missingWidgets) {
        if (!grouped[w.package]) grouped[w.package] = [];
        const widgetName = w.id.includes(".") ? w.id.split(".")[1] : w.id;
        if (!grouped[w.package].includes(widgetName)) {
          grouped[w.package].push(widgetName);
        }
      }
      missingFromRegistry = Object.entries(grouped).map(
        ([pkg, widgetNames]) => ({ package: pkg, widgets: widgetNames }),
      );
    }

    // 7. Resolve registry username for scope
    let registryUsername = options.githubUser || "";
    if (!registryUsername) {
      try {
        const { getRegistryProfile } = require("./registryAuthController");
        const profile = await getRegistryProfile();
        registryUsername = profile?.username || options.authorId || "";
      } catch {
        registryUsername = options.authorId || "";
      }
    }

    // 8. Generate registry manifest
    const manifest = generateRegistryManifest(dashboardConfig, {
      githubUser: registryUsername,
      category: options.category || "general",
      repository: options.repository || "",
      appOrigin: appId,
      visibility: options.visibility || "public",
    });

    // 9. Show save dialog for the publish package
    const sanitizedName = manifest.name;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save Dashboard Package for Registry",
      defaultPath: path.join(
        app.getPath("desktop"),
        `dashboard-${sanitizedName}-v${manifest.version}.zip`,
      ),
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    // 10. Create ZIP with manifest and dashboard config
    const zip = new AdmZip();
    zip.addFile(
      "manifest.json",
      Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
    );
    zip.addFile(
      `${sanitizedName}.dashboard.json`,
      Buffer.from(JSON.stringify(dashboardConfig, null, 2), "utf-8"),
    );
    zip.writeZip(filePath);

    console.log(
      `[DashboardConfigController] Prepared publish package: ${filePath}`,
    );

    // 11. Attempt to publish to registry if authenticated
    let registrySubmission = null;
    try {
      const { getAuthStatus } = require("./registryAuthController");
      const { publishToRegistry } = require("./registryApiController");
      const authStatus = getAuthStatus();

      if (authStatus.authenticated) {
        console.log("[DashboardConfigController] Publishing to registry...");
        registrySubmission = await publishToRegistry(filePath, manifest);
        if (registrySubmission.success) {
          console.log(
            `[DashboardConfigController] Published to registry: ${registrySubmission.registryUrl}`,
          );
        } else {
          console.warn(
            `[DashboardConfigController] Registry publish failed: ${registrySubmission.error}`,
          );
        }
      } else {
        registrySubmission = { success: false, authRequired: true };
      }
    } catch (err) {
      console.warn(
        `[DashboardConfigController] Registry publish error: ${err.message}`,
      );
      registrySubmission = { success: false, error: err.message };
    }

    return {
      success: true,
      filePath,
      manifest,
      config: dashboardConfig,
      warnings:
        missingFromRegistry.length > 0 ? missingFromRegistry : undefined,
      registryCheckFailed: registryCheckFailed || undefined,
      registrySubmission,
    };
  } catch (error) {
    console.error(
      "[DashboardConfigController] Error preparing dashboard for publish:",
      error,
    );
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get a full preview of a dashboard package from the registry.
 * Combines the structured preview data with a compatibility check.
 *
 * @param {string} packageName - Registry package name
 * @param {Object} widgetRegistry - WidgetRegistry instance
 * @returns {Promise<Object>} Preview data with compatibility report
 */
async function getDashboardPreview(packageName, widgetRegistry = null) {
  const {
    buildDashboardPreview,
    checkDashboardCompatibility,
  } = require("../schema/dashboardConfigUtils");
  const { getPackage, fetchRegistryIndex } = require("./registryController");

  const pkg = await getPackage(packageName);
  if (!pkg) {
    return {
      success: false,
      error: `Dashboard package not found: ${packageName}`,
    };
  }

  const preview = buildDashboardPreview(pkg);

  // Get compatibility report
  const installedWidgets = widgetRegistry ? widgetRegistry.getWidgets() : [];
  let registryPackages = [];
  try {
    const index = await fetchRegistryIndex();
    registryPackages = index.packages || [];
  } catch (err) {
    // Non-fatal — preview still works without compatibility
  }

  const compatibility = checkDashboardCompatibility(
    pkg.widgets || [],
    installedWidgets,
    registryPackages,
  );

  return {
    success: true,
    preview,
    compatibility,
  };
}

/**
 * Check installed dashboards for available updates.
 * Reads workspaces, finds those installed from the registry,
 * and compares versions against the current registry index.
 *
 * @param {string} appId - Application identifier
 * @returns {Promise<Object>} Result with updates array
 */
async function checkDashboardUpdatesForApp(appId) {
  const { checkDashboardUpdates } = require("../schema/dashboardConfigUtils");
  const { fetchRegistryIndex } = require("./registryController");

  try {
    const filename = path.join(
      app.getPath("userData"),
      appName,
      appId,
      configFilename,
    );
    const workspaces = getFileContents(filename) || [];

    const index = await fetchRegistryIndex();
    const registryPackages = index.packages || [];

    const updates = checkDashboardUpdates(workspaces, registryPackages);

    return {
      success: true,
      updates,
      totalInstalled: workspaces.filter(
        (w) => w._dashboardConfig?.registryPackage,
      ).length,
    };
  } catch (error) {
    console.error(
      "[DashboardConfigController] Error checking dashboard updates:",
      error,
    );
    return {
      success: false,
      error: error.message,
      updates: [],
    };
  }
}

/**
 * Get a provider setup manifest for a dashboard's requirements.
 * Compares required providers against the user's configured providers.
 *
 * @param {string} appId - Application identifier
 * @param {Array} requiredProviders - Provider requirements from dashboard config
 * @returns {Object} Setup manifest with per-provider status
 */
function getProviderSetupManifest(appId, requiredProviders = []) {
  const {
    buildProviderSetupManifest,
  } = require("../schema/dashboardConfigUtils");
  const { listProviders } = require("./providerController");

  let configuredProviders = [];
  try {
    configuredProviders = listProviders(null, appId) || [];
  } catch (err) {
    console.warn(
      "[DashboardConfigController] Could not list providers:",
      err.message,
    );
  }

  return buildProviderSetupManifest(requiredProviders, configuredProviders);
}

/**
 * Get a publish preview for a dashboard workspace.
 * Returns widget/layout info without creating a ZIP or uploading.
 *
 * @param {string} appId - Application identifier
 * @param {number|string} workspaceId - Workspace to preview
 * @param {Object} widgetRegistry - WidgetRegistry instance (optional)
 * @returns {Object} Preview with dashboardName, widgetCount, widgets, componentNames
 */
function getDashboardPublishPreview(appId, workspaceId, widgetRegistry = null) {
  try {
    const filename = path.join(
      app.getPath("userData"),
      appName,
      appId,
      configFilename,
    );
    const workspacesArray = getFileContents(filename);
    const workspace = workspacesArray.find(
      (w) => w.id === workspaceId || w.id === Number(workspaceId),
    );

    if (!workspace) {
      return { success: false, error: `Workspace not found: ${workspaceId}` };
    }

    const componentNames = collectComponentNamesFromWorkspace(workspace);
    const widgets = buildWidgetDependencies(componentNames, widgetRegistry);

    return {
      success: true,
      dashboardName: workspace.name || workspace.label || "Dashboard",
      widgetCount: componentNames.length,
      widgets: widgets.map((w) => ({ name: w.name, package: w.package })),
      componentNames: [...componentNames],
    };
  } catch (error) {
    console.error(
      "[DashboardConfigController] Error getting publish preview:",
      error,
    );
    return { success: false, error: error.message };
  }
}

module.exports = {
  exportDashboardConfig,
  selectDashboardFile,
  importDashboardConfig,
  installDashboardFromRegistry,
  checkCompatibility,
  prepareDashboardForPublish,
  collectDashboardDependencies,
  getDashboardPublishPlan,
  getDashboardPreview,
  checkDashboardUpdatesForApp,
  getProviderSetupManifest,
  getDashboardPublishPreview,
};
