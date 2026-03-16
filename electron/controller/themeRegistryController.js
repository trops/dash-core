/**
 * themeRegistryController.js
 *
 * Handles publishing themes to and installing themes from the Dash registry.
 * Mirrors dashboardConfigController patterns for ZIP creation, manifest generation,
 * and registry interaction.
 */
const fs = require("fs");
const path = require("path");
const { app, dialog } = require("electron");
const AdmZip = require("adm-zip");

const themeController = require("./themeController");
const registryController = require("./registryController");
const registryApiController = require("./registryApiController");
const {
  getAuthStatus,
  getRegistryProfile,
  getStoredToken,
} = require("./registryAuthController");

const appName = "Dashboard";

/**
 * Sanitize a name for use as a filename (lowercase, hyphens only).
 */
function sanitizeName(name) {
  return (name || "theme")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Generate a registry manifest for a theme package.
 *
 * @param {Object} themeData - The raw theme object
 * @param {string} themeKey - The theme key/name
 * @param {Object} options - Publish options { authorName, description, tags, scope }
 * @returns {Object} Registry manifest
 */
function generateThemeRegistryManifest(themeData, themeKey, options = {}) {
  const humanName = themeData.name || themeKey;
  const sanitizedName = sanitizeName(humanName);
  const colors = extractColors(themeData);

  return {
    scope: options.scope || "",
    name: sanitizedName,
    displayName: humanName,
    author: options.authorName || "",
    description: options.description || "",
    version: "1.0.0",
    type: "theme",
    category: "general",
    tags: options.tags || [],
    icon: "palette",
    colors,
    appOrigin: options.appOrigin || "",
    publishedAt: new Date().toISOString(),
  };
}

const {
  TAILWIND_COLORS,
  toDisplayColor,
} = require("../../src/utils/colorUtils");

/**
 * Extract primary/secondary/tertiary/neutral colors from a theme object.
 * Theme objects store colors in various structures; this normalizes them.
 * Converts Tailwind color family names to hex values for display.
 */
function extractColors(themeData) {
  const colors = {
    primary: "",
    secondary: "",
    tertiary: "",
    neutral: "",
  };

  if (!themeData) return colors;

  // Direct color fields
  if (themeData.primary) colors.primary = themeData.primary;
  if (themeData.secondary) colors.secondary = themeData.secondary;
  if (themeData.tertiary) colors.tertiary = themeData.tertiary;
  if (themeData.neutral) colors.neutral = themeData.neutral;

  // Nested under "colors" key
  if (themeData.colors) {
    if (themeData.colors.primary) colors.primary = themeData.colors.primary;
    if (themeData.colors.secondary)
      colors.secondary = themeData.colors.secondary;
    if (themeData.colors.tertiary) colors.tertiary = themeData.colors.tertiary;
    if (themeData.colors.neutral) colors.neutral = themeData.colors.neutral;
  }

  // Convert Tailwind names to hex
  colors.primary = toDisplayColor(colors.primary);
  colors.secondary = toDisplayColor(colors.secondary);
  colors.tertiary = toDisplayColor(colors.tertiary);
  colors.neutral = toDisplayColor(colors.neutral);

  return colors;
}

/**
 * Prepare a theme for publishing to the registry.
 *
 * Reads the theme from themes.json, generates a manifest, creates a ZIP,
 * and publishes via the registry API.
 *
 * @param {BrowserWindow} win - The sender window
 * @param {string} appId - Application identifier
 * @param {string} themeKey - Key of the theme to publish
 * @param {Object} options - { authorName, description, tags }
 * @returns {Object} Result with success, manifest, registryResult
 */
async function prepareThemeForPublish(win, appId, themeKey, options = {}) {
  try {
    // Read the theme data
    const themesResult = themeController.listThemesForApplication(win, appId);
    if (themesResult.error) {
      return {
        success: false,
        error: "Failed to read themes: " + themesResult.message,
      };
    }

    const themeData = themesResult.themes[themeKey];
    if (!themeData) {
      return { success: false, error: `Theme "${themeKey}" not found` };
    }

    // Get auth status and profile for scope
    const auth = getAuthStatus();
    if (!auth.authenticated) {
      return {
        success: false,
        error: "Not authenticated with registry",
        authRequired: true,
      };
    }
    const profile = await getRegistryProfile();
    const scope = profile?.username || options.scope || "";
    if (!scope) {
      return {
        success: false,
        error: "Could not determine registry username",
        authRequired: true,
      };
    }

    // Generate manifest
    const manifest = generateThemeRegistryManifest(themeData, themeKey, {
      ...options,
      scope,
      appOrigin: appId,
    });

    // Validate colors
    if (
      !manifest.colors.primary ||
      !manifest.colors.secondary ||
      !manifest.colors.tertiary
    ) {
      return {
        success: false,
        error:
          "Theme must have primary, secondary, and tertiary colors defined",
      };
    }

    // Show save dialog
    const sanitizedName = sanitizeName(themeKey);
    const defaultFilename = `theme-${sanitizedName}-v${manifest.version}.zip`;

    const saveResult = await dialog.showSaveDialog(win, {
      title: "Save Theme Package",
      defaultPath: defaultFilename,
      filters: [{ name: "ZIP Files", extensions: ["zip"] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, error: "Save canceled" };
    }

    const filePath = saveResult.filePath;

    // Create ZIP with manifest.json + {name}.theme.json
    const zip = new AdmZip();
    zip.addFile(
      "manifest.json",
      Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
    );
    zip.addFile(
      `${sanitizedName}.theme.json`,
      Buffer.from(JSON.stringify(themeData, null, 2), "utf-8"),
    );
    zip.writeZip(filePath);

    console.log("[ThemeRegistryController] ZIP created at:", filePath);

    // Attempt to publish to registry
    let registryResult = null;
    if (auth.authenticated) {
      registryResult = await registryApiController.publishToRegistry(
        filePath,
        manifest,
      );
      console.log(
        "[ThemeRegistryController] Registry publish result:",
        registryResult,
      );
    }

    return {
      success: true,
      manifest,
      filePath,
      registryResult,
    };
  } catch (err) {
    console.error(
      "[ThemeRegistryController] Error preparing theme for publish:",
      err,
    );
    return { success: false, error: err.message };
  }
}

/**
 * Install a theme from the registry.
 *
 * Looks up the theme package, downloads the ZIP, extracts the .theme.json,
 * and saves it via themeController.
 *
 * @param {BrowserWindow} win - The sender window
 * @param {string} appId - Application identifier
 * @param {string} packageName - Registry package name (e.g., "username/ocean-depth")
 * @returns {Object} Result with success, themeKey, theme
 */
async function installThemeFromRegistry(win, appId, packageName) {
  try {
    // Look up the package
    const pkg = await registryController.getPackage(packageName);
    if (!pkg) {
      return {
        success: false,
        error: `Theme package "${packageName}" not found in registry`,
      };
    }

    // Construct download URL from package metadata using the working registry base
    const registryBaseUrl =
      process.env.DASH_REGISTRY_API_URL ||
      "https://main.d919rwhuzp7rj.amplifyapp.com";
    const downloadUrl = `${registryBaseUrl}/api/packages/${encodeURIComponent(pkg.scope)}/${encodeURIComponent(pkg.name)}/download?version=${encodeURIComponent(pkg.version || "1.0.0")}`;

    console.log(
      "[ThemeRegistryController] Downloading theme from:",
      downloadUrl,
    );

    // Download the ZIP (with auth header)
    const headers = {};
    const auth = getStoredToken();
    if (auth?.token) {
      headers["Authorization"] = `Bearer ${auth.token}`;
    }
    const response = await fetch(downloadUrl, { headers });
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to download theme: ${response.status} ${response.statusText}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuffer);

    // Extract .theme.json from ZIP
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    const themeEntry = entries.find((entry) =>
      entry.entryName.endsWith(".theme.json"),
    );

    if (!themeEntry) {
      return {
        success: false,
        error: "ZIP does not contain a .theme.json file",
      };
    }

    // Validate entry path (security: prevent path traversal)
    if (
      themeEntry.entryName.includes("..") ||
      path.isAbsolute(themeEntry.entryName)
    ) {
      return { success: false, error: "Invalid file path in ZIP" };
    }

    // Parse theme data
    const themeJson = themeEntry.getData().toString("utf-8");
    let themeData;
    try {
      themeData = JSON.parse(themeJson);
    } catch (parseErr) {
      return {
        success: false,
        error: "Invalid JSON in theme file: " + parseErr.message,
      };
    }

    // Add registry metadata
    themeData._registryMeta = {
      source: "registry",
      packageName,
      installedAt: new Date().toISOString(),
    };

    // Determine theme key from package display name or name
    const themeKey = pkg.displayName || pkg.name;

    // Save via themeController
    const saveResult = themeController.saveThemeForApplication(
      win,
      appId,
      themeKey,
      themeData,
    );

    if (saveResult.error) {
      return {
        success: false,
        error: "Failed to save theme: " + saveResult.message,
      };
    }

    console.log("[ThemeRegistryController] Theme installed:", themeKey);

    return {
      success: true,
      themeKey,
      theme: themeData,
      themes: saveResult.themes,
    };
  } catch (err) {
    console.error("[ThemeRegistryController] Error installing theme:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Get a preview of theme data for the publish modal.
 *
 * @param {string} appId - Application identifier
 * @param {string} themeKey - Theme key
 * @returns {Object} Preview data with theme name, colors, etc.
 */
function getThemePublishPreview(appId, themeKey) {
  try {
    const themesResult = themeController.listThemesForApplication(null, appId);
    if (themesResult.error) {
      return {
        success: false,
        error: "Failed to read themes: " + themesResult.message,
      };
    }

    const themeData = themesResult.themes[themeKey];
    if (!themeData) {
      return { success: false, error: `Theme "${themeKey}" not found` };
    }

    const colors = extractColors(themeData);

    return {
      success: true,
      themeName: themeKey,
      colors,
      hasRegistryMeta: !!themeData._registryMeta,
    };
  } catch (err) {
    console.error("[ThemeRegistryController] Error getting preview:", err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  prepareThemeForPublish,
  installThemeFromRegistry,
  getThemePublishPreview,
  generateThemeRegistryManifest,
  extractColors,
};
