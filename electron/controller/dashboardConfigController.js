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
// The publish step reads each pinned widget's package.json for its
// permissions (it never ran before: every dep came out unpinned).
const fs = require("fs");
const AdmZip = require("adm-zip");
const { getFileContents } = require("../utils/file");
const { getAppFilePath } = require("../utils/appPaths");
const { filterToActive } = require("../profile/profileMembership");
const {
  validateDashboardConfig,
  applyDefaults,
  CURRENT_SCHEMA_VERSION,
} = require("../schema/dashboardConfigValidator");
const {
  collectComponentNames,
  collectComponentNamesFromWorkspace,
  collectDependencyRefsFromWorkspace,
  extractEventWiring,
  extractEventWiringFromWorkspace,
  buildWidgetDependencies,
  buildProviderRequirements,
  applyEventWiringToLayout,
  stripPersonalizationFromWorkspace,
  keepPersonalization,
  publishScopeOf,
  localScopesOf,
  remapLayoutPackageScopes,
  assertNoLocalScopes,
} = require("../schema/dashboardConfigUtils");
const { searchRegistry, getPackage } = require("./registryController");
const {
  registryDownloadFetch,
  downloadRefusal,
} = require("../registryDownload");
const themeController = require("./themeController");
const {
  makeRegistryRef,
  withoutRegistryRef,
  readRegistryRef,
  normalizePackageRef,
} = require("../registry/packageRef");
const {
  resolveForInstall,
  packageDownloadUrl,
  isOwnScope,
  EXACT_VERSION,
  planPackagePublish,
} = require("../registry/registryPackages");

const configFilename = "workspaces.json";

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
    const filename = getAppFilePath(appId, configFilename);
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

    // The dashboard's bots, as a team (create-entry 5a, US-027) — unless
    // left out. Their result listeners leave the layout and travel by role.
    const teamExport =
      options.includeBots === false
        ? { team: null, workspace, notIncluded: [] }
        : teamForExport(workspace, options);

    // Strip publisher-specific personalization (userPrefs,
    // selectedProviders) so the exported file carries a clean
    // template, not one pre-filled with the publisher's paths.
    const sharedWorkspace = stripPersonalizationFromWorkspace(
      teamExport.workspace,
    );
    const layout = sharedWorkspace.layout || [];

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
        ...(Array.isArray(sharedWorkspace.pages) &&
        sharedWorkspace.pages.length > 0
          ? {
              pages: sharedWorkspace.pages,
              activePageId: workspace.activePageId,
            }
          : {}),
        ...(Array.isArray(sharedWorkspace.sidebarLayout) &&
        sharedWorkspace.sidebarLayout.length > 0
          ? {
              sidebarLayout: sharedWorkspace.sidebarLayout,
              sidebarEnabled: workspace.sidebarEnabled !== false,
            }
          : {}),
        menuId: workspace.menuId || 1,
      },
      widgets,
      providers,
      eventWiring,
      ...(teamExport.team ? { team: teamExport.team } : {}),
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
            data: withoutRegistryRef(themeData),
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
      bots: teamExport.team ? teamExport.team.members.length : 0,
      notIncluded: teamExport.notIncluded,
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
    // Build a canonical id set — `@scope/name` — so lookups survive
    // the publisher/installer having the widget under different
    // keys. The widget-registry entry carries `w.packageId`,
    // `w.name`, and `w.scope`; the dashboard dep carries
    // `dep.package` (now scope-remapped at publish time). Seeding
    // every form we've seen avoids silent "missing widget" misses
    // on bare-vs-scoped mismatch.
    const canonicalId = (w) => {
      if (w?.packageId) return w.packageId;
      if (w?.scope && w?.name) {
        const scope = String(w.scope).replace(/^@/, "");
        const bareName = String(w.name).replace(new RegExp(`^@?${scope}/`), "");
        return `@${scope}/${bareName}`;
      }
      return w?.name || null;
    };
    const installedPackages = new Set();
    for (const w of installedWidgets) {
      const id = canonicalId(w);
      if (id) installedPackages.add(id);
      // Back-compat: keep bare name in the set too, so older
      // dashboard configs (pre-scope-remap) still match.
      if (w?.name) installedPackages.add(w.name);
    }

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

      // Try both the fully-scoped id and a bare-name fallback — the
      // installed set holds both forms, but the dashboard dep may
      // carry either shape. Without this, a widget stored locally as
      // `@trops/pipeline` and referenced as `pipeline` (or vice
      // versa) silently flagged as "failed" even though it was
      // installed.
      const isInstalled =
        installedPackages.has(packageName) ||
        (packageName?.includes("/") &&
          installedPackages.has(packageName.split("/").pop())) ||
        (packageName &&
          !packageName.startsWith("@") &&
          installedPackages.has(`@${packageName}`));
      if (isInstalled) {
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
        // The version the dashboard was published with, when the caller
        // asks for exact versions (a profile); otherwise the latest, so a
        // gallery install doesn't start out with old widgets.
        const exactUrl =
          options.exactWidgetVersions &&
          registryPkg &&
          EXACT_VERSION.test(String(widgetDep.version || ""))
            ? packageDownloadUrl(
                registryPkg.scope
                  ? { scope: registryPkg.scope, name: registryPkg.name }
                  : packageName,
                widgetDep.version,
              )
            : null;
        if (registryPkg && (exactUrl || registryPkg.downloadUrl)) {
          let config = null;
          if (exactUrl) {
            try {
              config = await widgetRegistry.downloadWidget(
                packageName,
                exactUrl,
              );
            } catch (exactErr) {
              // That version is gone (or private): the latest instead.
              if (!registryPkg.downloadUrl) throw exactErr;
              console.warn(
                `[DashboardConfigController] ${packageName}@${widgetDep.version} didn't install (${exactErr.message}); installing the latest`,
              );
            }
          }
          if (!config) {
            config = await widgetRegistry.downloadWidget(
              packageName,
              registryPkg.downloadUrl,
              registryPkg.dashConfigUrl || null,
            );
          }
          installSummary.installed.push({ packageName, config });
          installedPackages.add(packageName);
          // Also add the canonical form so a subsequent dep that
          // references it under a different shape still hits.
          const installedCanonical = canonicalId(config);
          if (installedCanonical) installedPackages.add(installedCanonical);
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
  // A theme the registry wouldn't install isn't bound to the dashboard.
  let themeFailed = false;
  let registryThemeKey = null;
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

          // Without the publisher's record of where their copy came from.
          const themeData = withoutRegistryRef({ ...bundledTheme.data });
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
            const themeResult = await installThemeFromRegistry(
              win,
              appId,
              bundledTheme.registryPackage,
            );
            // It answers a refusal (e.g. sign in) instead of throwing; it
            // was reported "installed" anyway.
            if (themeResult && themeResult.success === false) {
              throw new Error(themeResult.error || "The theme didn't install");
            }
            // Where it went (not over a different theme with that name).
            if (themeResult && themeResult.themeKey) {
              registryThemeKey = themeResult.themeKey;
            }
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
            themeFailed = true;
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
        // Bind the workspace to the theme, unless it didn't install
        if (!themeFailed) themeInstalled = registryThemeKey || themeKey;
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

  // Into an existing dashboard (an update, or loading a profile): it keeps
  // its id — so folders, profiles and links still point at it — its name,
  // folder and theme, and the widget settings made on this computer (a
  // published dashboard carries none).
  let existing = null;
  if (
    options.intoWorkspaceId !== undefined &&
    options.intoWorkspaceId !== null
  ) {
    const all = getFileContents(getAppFilePath(appId, "workspaces.json")) || [];
    // Ids are numbers here but may arrive as strings (a profile file).
    existing =
      all.find((w) => w && String(w.id) === String(options.intoWorkspaceId)) ||
      null;
    if (!existing) {
      return {
        success: false,
        error: "The dashboard to update isn't on this computer.",
      };
    }
    Object.assign(workspace, keepPersonalization(workspace, existing), {
      id: existing.id,
      name: existing.name,
      menuId: existing.menuId,
      themeKey: existing.themeKey,
    });
  } else {
    // Generate a unique ID for the imported workspace
    workspace.id = Date.now();
  }

  // Apply name/menuId/themeKey overrides if provided
  if (options.name) workspace.name = options.name;
  if (options.menuId !== undefined) workspace.menuId = options.menuId;
  if (options.themeKey !== undefined) workspace.themeKey = options.themeKey;

  // Set themeKey from bundled theme if it was installed and no override
  // given (an existing dashboard keeps its own)
  if (themeInstalled && options.themeKey === undefined && !existing) {
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

  // 5. Mark as not shareable (someone else's dashboard can't be published
  //    again); one from the user's own account can.
  workspace._dashboardConfig = {
    shareable: !!options.ownPackage,
    source,
    importedFrom: dashboardConfig.name,
    importedAt: new Date().toISOString(),
    originalAuthor: dashboardConfig.author,
    schemaVersion: dashboardConfig.schemaVersion,
    registryPackage: options.registryPackage || null,
    installedVersion: options.installedVersion || null,
  };
  // Which registry package this is ("@scope/name" + version); a dashboard
  // imported from a file has none.
  // (Set to undefined rather than deleted, so an update in place doesn't
  // keep the old one; it isn't written.)
  workspace.registryRef = options.registryRef || undefined;

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

  // The dashboard's bots (create-entry 5a, US-027): created paused, wired
  // to this dashboard's widgets and to each other.
  // `withTeam: false` leaves them out (a profile installs its bots as their
  // own packages); updating a dashboard in place never adds them again.
  let botsSummary = null;
  if (dashboardConfig.team && options.withTeam !== false && !existing) {
    botsSummary = installTeamForImport(workspace.id, dashboardConfig.team);
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
      bots: botsSummary,
    },
  };
}

/** The dashboard's team for export, via the bot controller (when it runs). */
function teamForExport(workspace, options = {}) {
  try {
    const botController = require("./botController");
    if (!botController._ready)
      return { team: null, workspace, notIncluded: [] };
    return botController.teamForDashboard(workspace, {
      description: options.description,
    });
  } catch (err) {
    console.warn("[DashboardConfigController] Bots not exported:", err.message);
    return {
      team: null,
      workspace,
      notIncluded: [`the dashboard's bots (${err.message})`],
    };
  }
}

/**
 * Install an imported dashboard's team: { installed, unwired, droppedWiring }
 * or { error } — the dashboard itself is already saved either way.
 */
function installTeamForImport(workspaceId, team) {
  try {
    const botController = require("./botController");
    if (!botController._ready) {
      return { error: "Bots aren't available right now." };
    }
    return botController.installDashboardTeam(workspaceId, team);
  } catch (err) {
    return { error: err.message };
  }
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
/**
 * Download a dashboard package from the registry and check it — the
 * shared first half of install, also used to read a starter without
 * installing it (create-entry 5b).
 * @returns {Promise<{ success: true, registryPkg, dashboardConfig } |
 *   { success: false, error, authRequired? }>}
 */
async function downloadDashboardPackage(
  packageName,
  { purpose = null, version = null } = {},
) {
  // 1. Look up the dashboard package in the registry — at an exact
  //    version when asked (a profile lists exact versions), else the latest
  const resolved = await resolveForInstall(
    packageName,
    { kinds: ["dashboard"], version },
    {
      getPackage,
      refreshIndex: () =>
        require("./registryController").fetchRegistryIndex?.(true),
    },
  );
  if (resolved.error) {
    return {
      success: false,
      error: `Couldn't install the dashboard: ${resolved.error}`,
    };
  }
  const registryPkg = resolved.pkg;

  // 2. Construct download URL via /api/packages/.../download endpoint
  //    (matches theme download flow in themeRegistryController.js)
  const registryBaseUrl =
    process.env.DASH_REGISTRY_API_URL ||
    "https://main.d919rwhuzp7rj.amplifyapp.com";
  const downloadUrl = `${registryBaseUrl}/api/packages/${encodeURIComponent(registryPkg.scope)}/${encodeURIComponent(registryPkg.name)}/download?version=${encodeURIComponent(registryPkg.version)}`;

  console.log(
    `[DashboardConfigController] Fetching dashboard from: ${downloadUrl}`,
  );

  // Download the ZIP: signed in or not (public dashboards need no sign-in).
  const { response, expired } = await registryDownloadFetch(downloadUrl, {
    purpose,
  });
  const refusal = downloadRefusal(response, { expired });
  if (refusal) return { success: false, ...refusal };
  if (!response.ok) {
    return {
      success: false,
      error: `Failed to download dashboard: ${response.status} ${response.statusText}`,
    };
  }

  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();
  let zipBuffer = Buffer.from(arrayBuffer);
  // The publisher's signing details, from the registry's JSON answer.
  let signingMeta = {};

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
      signingMeta = {
        zipSignature: jsonData.zipSignature || null,
        publisherCert: jsonData.publisherCert || null,
        publisherKeyId: jsonData.publisherKeyId || null,
        publisherFingerprint: jsonData.publisherFingerprint || null,
      };
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

  // Verify the publisher's signature before opening the zip, like themes,
  // bots and widgets (strict refuses; the default, warn, logs and goes on).
  try {
    const {
      verifyDownloadedPackage,
    } = require("../security/verifyRegistryInstall");
    const verified = await verifyDownloadedPackage({
      zipBuffer,
      zipSignature: signingMeta.zipSignature,
      publisherCert: signingMeta.publisherCert,
      publisherKeyId: signingMeta.publisherKeyId,
      publisherFingerprint: signingMeta.publisherFingerprint,
    });
    if (!verified.verified && verified.mode === "warn") {
      console.warn(
        `[DashboardConfigController] Installing unverified dashboard "${packageName}" — ${verified.reason}`,
      );
    }
  } catch (verifyErr) {
    return {
      success: false,
      error: `Install verification failed: ${verifyErr.message || verifyErr}`,
    };
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

  return { success: true, registryPkg, dashboardConfig };
}

// Configs read without installing, for this session (starters, 5b).
const packageConfigCache = new Map();

/**
 * A registry dashboard package's .dashboard.json, checked but not installed
 * (create-entry 5b: starter thumbnails and Remix). Cached for the session.
 */
async function getDashboardPackageConfig(packageName) {
  if (packageConfigCache.has(packageName)) {
    return packageConfigCache.get(packageName);
  }
  try {
    // Read for a starter card or Remix, not installed.
    const res = await downloadDashboardPackage(packageName, {
      purpose: "preview",
    });
    const out = res.success
      ? { success: true, config: res.dashboardConfig }
      : { success: false, error: res.error, authRequired: !!res.authRequired };
    if (out.success) packageConfigCache.set(packageName, out);
    return out;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function installDashboardFromRegistry(
  win,
  appId,
  packageName,
  widgetRegistry = null,
  installOptions = {},
) {
  try {
    // installOptions.version: an exact version (else the latest).
    const downloaded = await downloadDashboardPackage(packageName, {
      version: installOptions.version || null,
    });
    if (!downloaded.success) return downloaded;
    const { registryPkg, dashboardConfig } = downloaded;

    // 6. Delegate to shared import pipeline. User overrides (name /
    // menuId from the install-time options modal) are forwarded so
    // the workspace is named + filed where the user wants it.
    return await processDashboardConfig(
      win,
      appId,
      dashboardConfig,
      widgetRegistry,
      {
        source: "registry",
        registryPackage: packageName,
        installedVersion: registryPkg.version || null,
        registryRef: makeRegistryRef({
          package: { scope: registryPkg.scope, name: registryPkg.name },
          kind: "dashboard",
          version: registryPkg.version,
          origin: "installed",
        }),
        name: installOptions.name,
        menuId: installOptions.menuId,
        themeKey: installOptions.themeKey,
        intoWorkspaceId: installOptions.intoWorkspaceId,
        withTeam: installOptions.withTeam,
        exactWidgetVersions: !!installOptions.exactWidgetVersions,
        ownPackage: isOwnScope(registryPkg.scope),
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
    const filename = getAppFilePath(appId, configFilename);
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

    // 2. Collect dependency refs — each carries the exact packageId
    //    recorded on the layout item when the widget was added, so
    //    publish attribution is authoritative instead of heuristic.
    const refs = collectDependencyRefsFromWorkspace(workspace);

    // 3. Resolve widget refs (scope, packageName, widgetName, version)
    const deps = buildWidgetDependencies(
      refs,
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
    const planLocalScopes = localScopesOf(
      widgetRegistry ? widgetRegistry.getWidgets() || [] : [],
      callerScope,
    );

    // `@ai-built` widgets publish under the caller's name; anyone else's
    // stays under its author's (it's installed from there).
    const publishScopeFor = (w) => {
      if (!w.scope || !w.packageName) return null;
      return publishScopeOf(w.scope, callerScope, planLocalScopes) || null;
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

    // Scopes that only exist on the publisher's machine and aren't
    // resolvable from the registry as-is. Any dep under one of these
    // scopes MUST be republished under the caller's scope for the
    // dashboard's widget refs to work on another machine. The modal
    // uses this flag to auto-check + lock such rows.
    const LOCAL_ONLY_SCOPES = new Set(["ai-built", "@ai-built"]);

    const widgets = deps.widgets.map((w) => {
      const publishScope = publishScopeFor(w);
      const key =
        publishScope && w.packageName
          ? `${publishScope}/${w.packageName}`
          : null;
      const isLocalOnlyScope =
        !!w.scope && LOCAL_ONLY_SCOPES.has(String(w.scope).replace(/^@/, ""));
      return {
        ...w,
        publishScope,
        registry: key ? resolvedByKey.get(key) || null : null,
        // True when this widget cannot be installed as-is under its
        // local scope — the dashboard publish MUST republish it under
        // the caller's scope alongside the dashboard itself. The
        // modal treats this as mandatory rather than opt-in.
        requiresRepublish: isLocalOnlyScope,
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
  let headlessTmpDir = null;
  try {
    const {
      generateRegistryManifest,
    } = require("../schema/dashboardConfigUtils");
    const { resolveNextVersion } = require("../schema/widgetPublishManifest");

    // 1. Read workspace
    const filename = getAppFilePath(appId, configFilename);
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

    // 2. Check shareable flag — someone else's imported dashboard can't be
    //    published; one installed from the user's own account can (older
    //    installs of it were marked not shareable too)
    const fromOwnAccount = (() => {
      const ref = readRegistryRef("dashboard", workspace);
      const parsed = ref && normalizePackageRef(ref.package);
      return !!parsed && isOwnScope(parsed.scope);
    })();
    if (
      workspace._dashboardConfig &&
      workspace._dashboardConfig.shareable === false &&
      !fromOwnAccount
    ) {
      return {
        success: false,
        error:
          "This dashboard was imported and cannot be published. Only dashboards you created can be shared.",
      };
    }

    // Resolve the version this publish will ship. Previous publishes
    // store the last version on workspace._dashboardConfig.version; new
    // dashboards start at 1.0.0. Caller may pass `options.version`
    // (explicit) or `options.bump` ("patch"/"minor"/"major"). Without
    // this, every dashboard republish used a hardcoded 1.0.0 — the
    // registry never saw a new version, so the update-check never
    // fired a notification for installers.
    const previousVersion = workspace._dashboardConfig?.version || "1.0.0";
    // (Without a dialog — `headless` — the name and version come from the
    // registry instead: planPackagePublish below.)
    let nextVersion = resolveNextVersion(previousVersion, {
      bump: options.bump,
      version: options.version,
    });

    // Strip publisher-specific personalization (userPrefs,
    // selectedProviders) from every widget instance before we snapshot
    // the workspace into the dashboardConfig. Without this, every
    // installer inherits the publisher's absolute filesystem paths,
    // region tags, and provider bindings as their "defaults" — a
    // widget's own `defaultValue` on each field never gets a chance.
    // Layout position, ordering, nested containers, and any title text
    // are preserved (they're part of the template, not personal).
    // The dashboard's bots go along unless left out (create-entry 5a-2,
    // US-027 AC2) — the same as Export ZIP.
    const teamExport =
      options.includeBots === false
        ? { team: null, workspace, notIncluded: [] }
        : teamForExport(workspace, options);
    let sharedWorkspace = stripPersonalizationFromWorkspace(
      teamExport.workspace,
    );

    // Remap layout-item `packageId` from any local-only scope (e.g.
    // `@ai-built/foo`) to the publisher's scope (`@<callerScope>/foo`).
    // The widget-deps array in the dashboard manifest already gets
    // remapped (see generateRegistryManifest), but the per-instance
    // `packageId` on the layout items themselves was being shipped
    // as-is — so installers' ComponentManager (which registers
    // widgets under the published scope) couldn't reverse-look-up by
    // `packageId` on a layout item, breaking the Dependencies tab and
    // the publish-flow attribution on chained republishes.
    let resolvedCallerScope = options.callerScope || options.githubUser || "";
    if (!resolvedCallerScope) {
      try {
        const { getRegistryProfile } = require("./registryAuthController");
        const profile = await getRegistryProfile();
        resolvedCallerScope = profile?.username || options.authorId || "";
      } catch {
        resolvedCallerScope = options.authorId || "";
      }
    }
    // Scopes that exist only here — `@ai-built` and widgets built on this
    // computer — go out under the publisher's name; a widget installed
    // from someone else's account keeps theirs.
    const localScopes = localScopesOf(
      widgetRegistry ? widgetRegistry.getWidgets() || [] : [],
      resolvedCallerScope,
    );
    if (resolvedCallerScope) {
      sharedWorkspace = remapLayoutPackageScopes(
        sharedWorkspace,
        resolvedCallerScope,
        localScopes,
      );
    }

    // Publishing without a dialog (a profile's dashboards): signed in,
    // under a name picked automatically — this dashboard's own package, or
    // a free one — at the next version the registry doesn't have.
    let headlessPlan = null;
    if (options.headless) {
      const { getAuthStatus } = require("./registryAuthController");
      if (!getAuthStatus().authenticated || !resolvedCallerScope) {
        return {
          success: false,
          authRequired: true,
          error: "Sign in to publish.",
        };
      }
      headlessPlan = await planPackagePublish({
        kind: "dashboard",
        record: workspace,
        displayName: workspace.name || workspace.label || "Dashboard",
        localVersion: workspace._dashboardConfig?.version || null,
        username: resolvedCallerScope,
      });
      if (headlessPlan.error) {
        return { success: false, error: headlessPlan.error };
      }
      nextVersion = headlessPlan.version;
    }
    // Defense in depth: if remap was a no-op (no resolved caller scope)
    // OR if a code path slipped a local-scope reference in after the
    // remap, fail loudly instead of shipping a manifest no installer
    // can resolve. `@ai-built/...` only exists on the publisher's
    // machine — letting it through silently produces "package not
    // found" errors at install time, which is the harder failure mode
    // to debug.
    assertNoLocalScopes(sharedWorkspace);
    const layout = sharedWorkspace.layout || [];

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

    // Each layout item's own packageId says which installed package (and
    // so which version) it came from — the same refs the dependency plan
    // uses. Bare component names can't be matched to a package's version
    // (layouts store scoped ids), so every dep came out unpinned and the
    // version-pin guard below refused the publish.
    const widgets = buildWidgetDependencies(
      collectDependencyRefsFromWorkspace(workspace),
      widgetRegistry,
      componentConfigs,
    );
    const providers = buildProviderRequirements(componentNames, widgetRegistry);

    const dashboardConfig = applyDefaults({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: workspace.name || workspace.label || "Dashboard",
      description: options.description || "",
      // Package version (semver). Distinct from workspace.version
      // (schema revision, integer). Persisted on the workspace after a
      // successful publish so the next publish resolves from here.
      version: nextVersion,
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
        ...(Array.isArray(sharedWorkspace.pages) &&
        sharedWorkspace.pages.length > 0
          ? {
              pages: sharedWorkspace.pages,
              activePageId: workspace.activePageId,
            }
          : {}),
        ...(Array.isArray(sharedWorkspace.sidebarLayout) &&
        sharedWorkspace.sidebarLayout.length > 0
          ? {
              sidebarLayout: sharedWorkspace.sidebarLayout,
              sidebarEnabled: workspace.sidebarEnabled !== false,
            }
          : {}),
        menuId: workspace.menuId || 1,
      },
      widgets,
      providers,
      eventWiring,
      ...(teamExport.team ? { team: teamExport.team } : {}),
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
            data: withoutRegistryRef(themeData),
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
    // 7. Resolve registry username for scope (needed by the missing-widget
    //    check so we look up each dep under the caller's actual scope,
    //    not the local scope from the package.json).
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

    // Check each widget dep's existence in the registry via the dynamic
    // resolve endpoint (static registry-index.json lags behind freshly-
    // published packages). Auth-scoped so private packages owned by the
    // caller surface as existing.
    let missingFromRegistry = [];
    let registryCheckFailed = false;
    try {
      const { resolvePackages } = require("./registryApiController");
      const seen = new Set();
      const refs = [];
      for (const w of widgets) {
        if (w.required === false) continue;
        const name = w.package || w.packageName;
        // Resolve under the scope it's published as: the caller's for an
        // `@ai-built` widget, else its own author's.
        const scope =
          publishScopeOf(w.scope, registryUsername, localScopes) ||
          registryUsername;
        if (!scope || !name) continue;
        const key = `${scope}/${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({ scope, name });
      }
      if (refs.length > 0) {
        const res = await resolvePackages(refs);
        if (!res.success) {
          registryCheckFailed = true;
        } else {
          const existsByKey = new Map();
          for (const r of res.resolved || []) {
            existsByKey.set(`${r.scope}/${r.name}`, r.exists);
          }
          const grouped = {};
          for (const w of widgets) {
            if (w.required === false) continue;
            const name = w.package || w.packageName;
            if (!name) continue;
            const resolveKey = `${
              publishScopeOf(w.scope, registryUsername, localScopes) ||
              registryUsername
            }/${name}`;
            const exists = existsByKey.get(resolveKey);
            if (exists) continue;
            const widgetName = w.id?.includes(".")
              ? w.id.split(".")[1]
              : w.id || name;
            if (!grouped[name]) grouped[name] = [];
            if (!grouped[name].includes(widgetName)) {
              grouped[name].push(widgetName);
            }
          }
          missingFromRegistry = Object.entries(grouped).map(
            ([pkg, widgetNames]) => ({ package: pkg, widgets: widgetNames }),
          );
        }
      }
    } catch (err) {
      console.warn(
        `[DashboardConfigController] Unable to verify registry: ${err.message}`,
      );
      registryCheckFailed = true;
    }

    // Slice 13c: collect each widget's local `dash.permissions.mcp`
    // block and pair it with the version on disk. This array becomes
    // the source-of-truth for both the per-widget `permissions` field
    // on each manifest.widgets[] entry AND the top-level aggregated
    // `manifest.permissions` block. Includes third-party widgets too
    // — every dashboard dependency lives under widgets/ on the
    // publisher's machine, scanner pipeline (slice 13a/b) keeps each
    // package.json's permissions block fresh.
    const widgetPermissions = [];
    const installedWidgets = widgetRegistry
      ? widgetRegistry.getWidgets() || []
      : [];
    const unpinnedDeps = [];
    for (const w of dashboardConfig.widgets || []) {
      // `@ai-built` goes out under the publisher's name; anyone else's
      // widget keeps its author's scope.
      const remappedScope = publishScopeOf(
        w.scope,
        resolvedCallerScope,
        localScopes,
      );
      const bareName = (w.packageName || w.package || "").replace(
        /^@[^/]+\//,
        "",
      );
      const scopedPackageId = remappedScope
        ? `@${String(remappedScope).replace(/^@/, "")}/${bareName}`
        : bareName;
      // Version-pin guard: refuse to publish a dashboard whose widget
      // dep has no concrete version. Otherwise the permissions block
      // we ship would be computed against one version while installers
      // resolve `*` to potentially-newer versions with a different
      // tool surface.
      if (!w.version || w.version === "*") {
        unpinnedDeps.push(scopedPackageId);
        continue;
      }
      // Find the installed copy by trying a few aliases — registry
      // entries are usually `@scope/name`, but local conventions
      // sometimes elide the @.
      const match = installedWidgets.find((iw) => {
        if (!iw) return false;
        const candidates = new Set();
        if (iw.packageId) candidates.add(iw.packageId);
        if (iw.name) candidates.add(iw.name);
        return (
          candidates.has(scopedPackageId) ||
          candidates.has(`${remappedScope}/${bareName}`) ||
          candidates.has(bareName)
        );
      });
      if (!match || !match.path) continue;
      const pkgJsonPath = path.join(match.path, "package.json");
      if (!fs.existsSync(pkgJsonPath)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        const perms = pkg?.dash?.permissions?.mcp;
        if (perms && typeof perms === "object") {
          widgetPermissions.push({
            packageId: scopedPackageId,
            version: w.version,
            permissions: perms,
          });
        }
      } catch (e) {
        console.warn(
          `[DashboardConfigController] Could not read permissions from ${pkgJsonPath}:`,
          e.message,
        );
      }
    }
    if (unpinnedDeps.length > 0) {
      return {
        success: false,
        error: `Cannot publish dashboard with unpinned widget versions: ${unpinnedDeps.join(", ")}. Reinstall these widgets from the registry to lock their versions before publishing.`,
      };
    }
    // Without a dialog there's no one to warn: a dashboard whose widgets
    // the registry can't supply wouldn't load anywhere else, so it isn't
    // published (its widgets go first).
    if (headlessPlan && (registryCheckFailed || missingFromRegistry.length)) {
      return {
        success: false,
        error: registryCheckFailed
          ? "Couldn't check the dashboard's widgets with the registry right now."
          : `These widgets aren't in the registry yet: ${missingFromRegistry
              .map((m) => m.package)
              .join(", ")}`,
        missingFromRegistry,
      };
    }

    // 8. Generate registry manifest — pass callerScope so local-only
    //    scopes (e.g. `@ai-built/…`) get rewritten to the publisher's
    //    actual registry scope on the way out.
    const manifest = generateRegistryManifest(dashboardConfig, {
      githubUser: registryUsername,
      callerScope: registryUsername,
      localScopes,
      category: options.category || "general",
      repository: options.repository || "",
      appOrigin: appId,
      visibility: headlessPlan
        ? headlessPlan.visibility
        : options.visibility || "public",
      // An existing package keeps its visibility (none is sent).
      keepVisibility: !!(headlessPlan && headlessPlan.exists),
      packageName: headlessPlan ? headlessPlan.name : undefined,
      version: nextVersion,
      widgetPermissions,
    });

    // 9. Where the package zip goes: the user picks, or (headless) a temp
    //    file that's removed once it's sent
    const sanitizedName = manifest.name;
    let filePath;
    if (headlessPlan) {
      const tmpDir = fs.mkdtempSync(
        path.join(app.getPath("temp"), "dash-publish-"),
      );
      headlessTmpDir = tmpDir;
      filePath = path.join(
        tmpDir,
        `dashboard-${sanitizedName}-v${manifest.version}.zip`,
      );
    } else {
      const picked = await dialog.showSaveDialog(win, {
        title: "Save Dashboard Package for Registry",
        defaultPath: path.join(
          app.getPath("desktop"),
          `dashboard-${sanitizedName}-v${manifest.version}.zip`,
        ),
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      });
      if (picked.canceled || !picked.filePath) {
        return { success: false, canceled: true };
      }
      filePath = picked.filePath;
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
          // Persist the resolved next version back onto the workspace
          // so the NEXT publish resolves from it. Without this, the
          // publisher would have to re-enter the same version every
          // time (or keep bumping from 1.0.0, masking that the
          // registry already advanced).
          try {
            const workspaceController = require("./workspaceController");
            const nextWorkspace = {
              ...workspace,
              _dashboardConfig: {
                ...(workspace._dashboardConfig || {}),
                version: nextVersion,
                registryPackage: manifest.name,
                registryScope: manifest.scope || manifest.githubUser,
              },
            };
            const registryRef = makeRegistryRef({
              package: {
                scope: manifest.scope || manifest.githubUser,
                name: manifest.name,
              },
              kind: "dashboard",
              version: nextVersion,
              origin: "published",
            });
            if (registryRef) nextWorkspace.registryRef = registryRef;
            else delete nextWorkspace.registryRef;
            workspaceController.saveWorkspaceForApplication(
              win,
              appId,
              nextWorkspace,
            );
          } catch (persistErr) {
            // Non-fatal — registry is the source of truth for
            // latestVersion, so the next publish can still resolve
            // against it if this workspace write fails.
            console.warn(
              `[DashboardConfigController] Version persistence failed (continuing): ${persistErr.message}`,
            );
          }
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

    if (headlessPlan) {
      // Nothing is left behind on disk; the outcome is the registry's.
      try {
        fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
      } catch (_e) {
        // a leftover temp file is harmless
      }
      const ok = !!(registrySubmission && registrySubmission.success);
      return {
        success: ok,
        ...(ok
          ? {}
          : {
              error:
                (registrySubmission && registrySubmission.error) ||
                "The registry didn't accept the dashboard.",
              authRequired: !!(
                registrySubmission && registrySubmission.authRequired
              ),
            }),
        package: headlessPlan.package,
        version: nextVersion,
        renamed: headlessPlan.renamed,
        visibility: headlessPlan.exists ? "unchanged" : "private",
        registrySubmission,
      };
    }

    return {
      success: true,
      filePath,
      manifest,
      config: dashboardConfig,
      bots: teamExport.team ? teamExport.team.members.length : 0,
      notIncluded: teamExport.notIncluded,
      warnings:
        missingFromRegistry.length > 0 ? missingFromRegistry : undefined,
      registryCheckFailed: registryCheckFailed || undefined,
      registrySubmission,
    };
  } catch (error) {
    // A headless publish that failed partway leaves no temp folder.
    if (headlessTmpDir) {
      try {
        fs.rmSync(headlessTmpDir, { recursive: true, force: true });
      } catch (_e) {
        // harmless
      }
    }
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
    const filename = getAppFilePath(appId, configFilename);
    const workspaces = filterToActive(
      appId,
      "dashboards",
      getFileContents(filename) || [],
      (w) => w.id,
    );

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
    const filename = getAppFilePath(appId, configFilename);
    const workspacesArray = getFileContents(filename);
    const workspace = workspacesArray.find(
      (w) => w.id === workspaceId || w.id === Number(workspaceId),
    );

    if (!workspace) {
      return { success: false, error: `Workspace not found: ${workspaceId}` };
    }

    const componentNames = collectComponentNamesFromWorkspace(workspace);
    const widgets = buildWidgetDependencies(componentNames, widgetRegistry);
    // Its bots, as they'd be published (create-entry 5a-2).
    const teamExport = teamForExport(workspace);
    const { describeTeam } = require("../bots/teamManifest");

    return {
      success: true,
      dashboardName: workspace.name || workspace.label || "Dashboard",
      widgetCount: componentNames.length,
      widgets: widgets.map((w) => ({ name: w.name, package: w.package })),
      componentNames: [...componentNames],
      bots: teamExport.team ? describeTeam(teamExport.team) : [],
      botsNotIncluded: teamExport.notIncluded || [],
    };
  } catch (error) {
    console.error(
      "[DashboardConfigController] Error getting publish preview:",
      error,
    );
    return { success: false, error: error.message };
  }
}

/**
 * Publish a dashboard to the user's account without asking (a profile's
 * dashboards, dash-profiles v2): no save dialog, the name picked
 * automatically (planPackagePublish), private when new, and — unless
 * `includeBots: true` — without its bots, which publish as their own
 * packages.
 *
 * @returns {Promise<{success: boolean, package?: string, version?: string,
 *   renamed?: boolean, error?: string, missingFromRegistry?: Array}>}
 */
function publishDashboardHeadless(
  appId,
  workspaceId,
  options = {},
  widgetRegistry = null,
) {
  return prepareDashboardForPublish(
    null,
    appId,
    workspaceId,
    {
      description: options.description,
      tags: options.tags,
      icon: options.icon,
      authorName: options.authorName,
      authorId: options.authorId,
      componentConfigs: options.componentConfigs,
      includeBots: options.includeBots === true,
      headless: true,
    },
    widgetRegistry,
  );
}

module.exports = {
  exportDashboardConfig,
  selectDashboardFile,
  importDashboardConfig,
  installDashboardFromRegistry,
  checkCompatibility,
  prepareDashboardForPublish,
  publishDashboardHeadless,
  collectDashboardDependencies,
  getDashboardPublishPlan,
  getDashboardPreview,
  checkDashboardUpdatesForApp,
  getProviderSetupManifest,
  getDashboardPublishPreview,
  getDashboardPackageConfig,
};
