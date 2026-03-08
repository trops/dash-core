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
} = require("../schema/dashboardConfigUtils");

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
        const providers = buildProviderRequirements(
            componentNames,
            widgetRegistry,
        );

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
            defaultPath: path.join(
                app.getPath("desktop"),
                `${sanitizedName}.zip`,
            ),
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

module.exports = {
    exportDashboardConfig,
};
