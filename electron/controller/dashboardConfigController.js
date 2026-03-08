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
  extractEventWiring,
  buildWidgetDependencies,
  buildProviderRequirements,
  applyEventWiringToLayout,
} = require("../schema/dashboardConfigUtils");
const { searchRegistry, getPackage } = require("./registryController");

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

    // 2. Collect components, extract wiring, resolve deps
    const componentNames = collectComponentNames(layout);
    const eventWiring = extractEventWiring(layout);
    const widgets = buildWidgetDependencies(componentNames, widgetRegistry);
    const providers = buildProviderRequirements(componentNames, widgetRegistry);

    // 3. Build the dashboard config
    const dashboardConfig = applyDefaults({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: workspace.name || workspace.label || "Exported Dashboard",
      description: options.description || "",
      author: {
        name: options.authorName || "",
        id: options.authorId || "",
      },
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
        menuId: workspace.menuId || 1,
      },
      widgets,
      providers,
      eventWiring,
    });

    // 4. Validate the generated config
    const validation = validateDashboardConfig(dashboardConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Generated config is invalid: ${validation.errors.join(", ")}`,
      };
    }

    // 5. Show save dialog
    const sanitizedName = (workspace.name || "dashboard")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export Dashboard as ZIP",
      defaultPath: path.join(app.getPath("desktop"), `${sanitizedName}.zip`),
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    // 6. Create ZIP with the config
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
 * Import a dashboard from a ZIP file containing a .dashboard.json config.
 *
 * Steps:
 * 1. Show native file picker for .zip selection
 * 2. Extract and validate .dashboard.json
 * 3. Auto-install missing widgets from registry
 * 4. Create workspace in workspaces.json
 * 5. Apply event wiring to layout
 * 6. Mark imported dashboard shareable: false
 *
 * @param {BrowserWindow} win - The main window (for dialog)
 * @param {string} appId - Application identifier
 * @param {Object} widgetRegistry - WidgetRegistry instance (needs getWidgets(), downloadWidget())
 * @returns {Promise<Object>} Result with success, workspace, and import summary
 */
async function importDashboardConfig(win, appId, widgetRegistry = null) {
  try {
    // 1. Show file picker
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Import Dashboard Configuration",
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      properties: ["openFile"],
    });

    if (canceled || !filePaths || !filePaths.length) {
      return { success: false, canceled: true };
    }

    const zipPath = filePaths[0];

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

    // 3. Auto-install missing widgets from registry
    const installSummary = {
      installed: [],
      alreadyInstalled: [],
      failed: [],
    };

    if (
      widgetRegistry &&
      dashboardConfig.widgets &&
      dashboardConfig.widgets.length
    ) {
      const installedWidgets = widgetRegistry.getWidgets();
      const installedPackages = new Set(installedWidgets.map((w) => w.name));

      for (const widgetDep of dashboardConfig.widgets) {
        const packageName = widgetDep.package;

        if (installedPackages.has(packageName)) {
          installSummary.alreadyInstalled.push(packageName);
          continue;
        }

        // Try to find the widget in the registry and install it
        try {
          const registryPkg = await getPackage(packageName);
          if (registryPkg && registryPkg.downloadUrl) {
            await widgetRegistry.downloadWidget(
              packageName,
              registryPkg.downloadUrl,
              registryPkg.dashConfigUrl || null,
            );
            installSummary.installed.push(packageName);
            installedPackages.add(packageName);
          } else {
            installSummary.failed.push({
              package: packageName,
              reason: "Not found in registry",
            });
          }
        } catch (installError) {
          installSummary.failed.push({
            package: packageName,
            reason: installError.message,
          });
        }
      }
    }

    // 4. Build workspace from config
    const workspace = dashboardConfig.workspace;

    if (!workspace) {
      return {
        success: false,
        error: "Dashboard config has no workspace data",
      };
    }

    // Generate a unique ID for the imported workspace
    workspace.id = Date.now();

    // 5. Apply event wiring to layout
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

    // 6. Mark as not shareable (imported dashboards cannot be re-published)
    workspace._dashboardConfig = {
      shareable: false,
      importedFrom: dashboardConfig.name,
      importedAt: new Date().toISOString(),
      originalAuthor: dashboardConfig.author,
      schemaVersion: dashboardConfig.schemaVersion,
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
      `[DashboardConfigController] Imported dashboard "${dashboardConfig.name}" as workspace ${workspace.id}`,
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
      },
    };
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

module.exports = {
  exportDashboardConfig,
  importDashboardConfig,
};
