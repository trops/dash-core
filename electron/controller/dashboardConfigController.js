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

    // Delegate to shared import pipeline
    return await processDashboardConfig(
      win,
      appId,
      dashboardConfig,
      widgetRegistry,
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

  // 2. Build workspace from config
  const workspace = { ...dashboardConfig.workspace };

  if (!workspace || !workspace.layout) {
    return {
      success: false,
      error: "Dashboard config has no workspace data",
    };
  }

  // Generate a unique ID for the imported workspace
  workspace.id = Date.now();

  // 3. Apply event wiring to layout
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

  // 4. Mark as not shareable (imported dashboards cannot be re-published)
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

    if (!registryPkg.downloadUrl) {
      return {
        success: false,
        error: `Dashboard package has no download URL: ${packageName}`,
      };
    }

    // 2. Resolve the download URL and fetch the ZIP
    const version = registryPkg.version || "1.0.0";
    let downloadUrl = registryPkg.downloadUrl;
    downloadUrl = downloadUrl.replace("{version}", version);
    downloadUrl = downloadUrl.replace("{name}", packageName);

    // Enforce HTTPS
    const parsedUrl = new URL(downloadUrl);
    if (parsedUrl.protocol !== "https:") {
      return {
        success: false,
        error: `Dashboard downloads must use HTTPS. Refusing: ${downloadUrl}`,
      };
    }

    console.log(
      `[DashboardConfigController] Fetching dashboard from: ${downloadUrl}`,
    );

    const response = await fetch(downloadUrl);
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to download dashboard: ${response.status} ${response.statusText}`,
      };
    }

    const buffer = await response.arrayBuffer();
    const zip = new AdmZip(Buffer.from(buffer));

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
  const { checkDashboardCompatibility } = require("../schema/dashboardConfigUtils");
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
    const { generateRegistryManifest } = require("../schema/dashboardConfigUtils");

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
    if (workspace._dashboardConfig && workspace._dashboardConfig.shareable === false) {
      return {
        success: false,
        error: "This dashboard was imported and cannot be published. Only dashboards you created can be shared.",
      };
    }

    const layout = workspace.layout || [];

    // 3. Build the dashboard config (reuse export logic)
    const componentNames = collectComponentNames(layout);
    const eventWiring = extractEventWiring(layout);
    const widgets = buildWidgetDependencies(componentNames, widgetRegistry);
    const providers = buildProviderRequirements(componentNames, widgetRegistry);

    const dashboardConfig = applyDefaults({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: workspace.name || workspace.label || "Dashboard",
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

    // 4. Validate the config
    const validation = validateDashboardConfig(dashboardConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Generated config is invalid: ${validation.errors.join(", ")}`,
      };
    }

    // 5. Verify all widgets exist in the registry
    const { fetchRegistryIndex } = require("./registryController");
    let registryPackages = [];
    try {
      const index = await fetchRegistryIndex();
      registryPackages = index.packages || [];
    } catch (err) {
      return {
        success: false,
        error: `Cannot verify widgets in registry: ${err.message}`,
      };
    }

    const registryNames = new Set(registryPackages.map((p) => p.name));
    const missingFromRegistry = widgets
      .filter((w) => w.required !== false && !registryNames.has(w.package))
      .map((w) => w.package);

    if (missingFromRegistry.length > 0) {
      return {
        success: false,
        error: `Required widgets not found in registry: ${missingFromRegistry.join(", ")}. Publish them first.`,
      };
    }

    // 6. Generate registry manifest
    const manifest = generateRegistryManifest(dashboardConfig, {
      githubUser: options.githubUser || options.authorId || "",
      category: options.category || "general",
      repository: options.repository || "",
    });

    // 7. Show save dialog for the publish package
    const sanitizedName = manifest.name;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save Dashboard Package for Registry",
      defaultPath: path.join(
        app.getPath("desktop"),
        `${sanitizedName}-v${manifest.version}.zip`,
      ),
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    // 8. Create ZIP with manifest and dashboard config
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));
    zip.addFile(
      `${sanitizedName}.dashboard.json`,
      Buffer.from(JSON.stringify(dashboardConfig, null, 2), "utf-8"),
    );
    zip.writeZip(filePath);

    console.log(
      `[DashboardConfigController] Prepared publish package: ${filePath}`,
    );

    return {
      success: true,
      filePath,
      manifest,
      config: dashboardConfig,
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
  const { buildDashboardPreview, checkDashboardCompatibility } =
    require("../schema/dashboardConfigUtils");
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
      totalInstalled: workspaces.filter((w) => w._dashboardConfig?.registryPackage).length,
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
  const { buildProviderSetupManifest } = require("../schema/dashboardConfigUtils");
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

module.exports = {
  exportDashboardConfig,
  importDashboardConfig,
  installDashboardFromRegistry,
  checkCompatibility,
  prepareDashboardForPublish,
  getDashboardPreview,
  checkDashboardUpdatesForApp,
  getProviderSetupManifest,
};
