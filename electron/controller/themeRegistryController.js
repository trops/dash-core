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
  clearToken,
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
 * @param {Object} options - Publish options { authorName, description, tags, scope, visibility }
 * @returns {Object} Registry manifest
 */
function generateThemeRegistryManifest(themeData, themeKey, options = {}) {
  const humanName = themeData.name || themeKey;
  const sanitizedName = sanitizeName(humanName);
  const colors = extractColors(themeData);
  const visibility = options.visibility === "private" ? "private" : "public";
  // Prefer an explicitly-resolved version (caller already bumped),
  // then the theme's own stored version, then the 1.0.0 baseline.
  // The old hardcoded 1.0.0 meant republishes silently clobbered the
  // registry record — update notifications never fired downstream.
  const version = options.version || themeData.version || "1.0.0";

  return {
    scope: options.scope || "",
    name: sanitizedName,
    displayName: humanName,
    author:
      options.authorName || themeData.author || options.fallbackAuthor || "",
    description: options.description || "",
    version,
    visibility,
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
    const { resolveNextVersion } = require("../schema/widgetPublishManifest");
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

    // Resolve version: prefer explicit, then bump the theme's stored
    // version, then start at 1.0.0. Without this themes always
    // published as 1.0.0 and update-check could never diff.
    const previousVersion = themeData.version || "1.0.0";
    const nextVersion = resolveNextVersion(previousVersion, {
      bump: options.bump,
      version: options.version,
    });

    // Author fallback chain (F7): explicit → theme data → registry
    // profile displayName/username → blank. Matches the widget
    // author-normalization shape so ai-built / scaffolded themes
    // don't ship to the registry with a blank author field.
    const resolvedAuthor =
      options.authorName ||
      themeData.author ||
      profile?.displayName ||
      profile?.username ||
      "";

    // Generate manifest
    const manifest = generateThemeRegistryManifest(themeData, themeKey, {
      ...options,
      scope,
      appOrigin: appId,
      version: nextVersion,
      authorName: resolvedAuthor,
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
      // Persist the resolved version + author back onto the theme so
      // the NEXT publish picks up from here. Without this, the
      // publisher would be bumping from 1.0.0 every time and the
      // manifest's author normalization would be re-applied every
      // run (OK but confusing).
      if (registryResult?.success) {
        try {
          const updatedTheme = {
            ...themeData,
            version: nextVersion,
            author: resolvedAuthor || themeData.author,
            _registryMeta: {
              ...(themeData._registryMeta || {}),
              packageName: `${scope}/${manifest.name}`,
              scope,
              lastPublishedAt: new Date().toISOString(),
              lastPublishedVersion: nextVersion,
            },
          };
          themeController.saveThemeForApplication(win, appId, {
            key: themeKey,
            theme: updatedTheme,
          });
        } catch (persistErr) {
          console.warn(
            `[ThemeRegistryController] Version persist failed (continuing): ${persistErr.message}`,
          );
        }
      }
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
  const TAG = "[ThemeInstall]";
  try {
    // Stage 1: Package lookup
    console.log(`${TAG} [1/5 Package Lookup] input="${packageName}"`);
    const pkg = await registryController.getPackage(packageName);
    if (!pkg) {
      console.log(`${TAG} [1/5 Package Lookup] FAIL — package not found`);
      return {
        success: false,
        error: `Package lookup failed: "${packageName}" was not found in the registry index. The package may have been removed or the name may be incorrect.`,
      };
    }
    console.log(
      `${TAG} [1/5 Package Lookup] resolved scope="${pkg.scope}" name="${pkg.name}" version="${pkg.version || "1.0.0"}"`,
    );

    // Stage 2: URL construction — keep scope as-is (encodeURIComponent handles @)
    const registryBaseUrl =
      process.env.DASH_REGISTRY_API_URL ||
      "https://main.d919rwhuzp7rj.amplifyapp.com";
    const urlScope = pkg.scope || "";
    const urlName = pkg.name || "";
    const urlVersion = pkg.version || "1.0.0";
    if (!urlName) {
      console.log(
        `${TAG} [2/5 URL Construction] FAIL — missing name="${urlName}"`,
      );
      return {
        success: false,
        error: `Download failed: package is missing a name field. The registry entry may be corrupt.`,
      };
    }
    const scopePath = urlScope ? `${encodeURIComponent(urlScope)}/` : "";
    const downloadUrl = `${registryBaseUrl}/api/packages/${scopePath}${encodeURIComponent(urlName)}/download?version=${encodeURIComponent(urlVersion)}`;
    console.log(`${TAG} [2/5 URL Construction] url="${downloadUrl}"`);

    // Stage 3: Download
    const auth = getStoredToken();
    if (!auth) {
      console.log(`${TAG} [3/5 Download] FAIL — no stored auth token`);
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

    let response;
    try {
      response = await fetch(downloadUrl, { headers });
    } catch (fetchErr) {
      console.log(
        `${TAG} [3/5 Download] FAIL — network error: ${fetchErr.message}`,
      );
      return {
        success: false,
        error: `Download failed: could not reach the registry (${fetchErr.message}). Check your internet connection.`,
      };
    }
    console.log(
      `${TAG} [3/5 Download] status=${response.status} contentType="${response.headers.get("content-type") || "unknown"}"`,
    );
    if (response.status === 401) {
      clearToken();
      return {
        success: false,
        error: "Authentication expired. Please sign in again.",
        authRequired: true,
      };
    }
    if (response.status === 404) {
      return {
        success: false,
        error: `Download failed: the registry returned 404 for scope="${urlScope}" name="${urlName}" version="${urlVersion}". The package version may not exist.`,
      };
    }
    if (!response.ok) {
      return {
        success: false,
        error: `Download failed: registry returned ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const arrayBuffer = await response.arrayBuffer();
    let zipBuffer = Buffer.from(arrayBuffer);
    console.log(`${TAG} [3/5 Download] size=${zipBuffer.length} bytes`);

    if (zipBuffer.length === 0) {
      return {
        success: false,
        error: "Download failed: registry returned an empty response.",
      };
    }

    // Reject HTML error pages
    if (contentType.includes("text/html")) {
      const body = zipBuffer.toString("utf-8").slice(0, 200);
      console.log(`${TAG} [3/5 Download] FAIL — HTML response: ${body}`);
      return {
        success: false,
        error: `Download failed: registry returned an HTML page instead of theme data.`,
      };
    }

    // Stage 4: Extract theme data (JSON or ZIP)
    let themeData;

    if (contentType.includes("application/json")) {
      // Registry returns JSON with a downloadUrl pointing to the actual ZIP
      console.log(
        `${TAG} [3/5 Download] JSON response — checking for downloadUrl`,
      );
      let jsonData;
      try {
        jsonData = JSON.parse(zipBuffer.toString("utf-8"));
      } catch (parseErr) {
        return {
          success: false,
          error: `Download failed: registry returned invalid JSON (${parseErr.message}).`,
        };
      }
      if (jsonData.error) {
        console.log(
          `${TAG} [3/5 Download] FAIL — JSON error: ${jsonData.error}`,
        );
        return {
          success: false,
          error: `Download failed: ${jsonData.error}`,
        };
      }
      if (jsonData.downloadUrl) {
        // Follow the pre-signed URL to get the actual ZIP
        console.log(`${TAG} [3/5 Download] following downloadUrl to fetch ZIP`);
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
        const zipArrayBuffer = await zipResponse.arrayBuffer();
        zipBuffer = Buffer.from(zipArrayBuffer);
        console.log(
          `${TAG} [3/5 Download] ZIP fetched, size=${zipBuffer.length} bytes`,
        );
        if (zipBuffer.length === 0) {
          return {
            success: false,
            error: "Download failed: storage returned an empty ZIP file.",
          };
        }
      } else {
        // No downloadUrl — treat as direct theme data
        console.log(
          `${TAG} [4/5 Extract] JSON response with no downloadUrl — using as theme data`,
        );
        themeData = jsonData.data || jsonData.theme || jsonData;
      }
    }

    if (!themeData) {
      // ZIP response — extract .theme.json from archive
      let zip;
      try {
        zip = new AdmZip(zipBuffer);
      } catch (zipErr) {
        console.log(
          `${TAG} [4/5 ZIP Extraction] FAIL — invalid ZIP: ${zipErr.message}`,
        );
        return {
          success: false,
          error: `ZIP extraction failed: the downloaded file is not a valid ZIP archive (${zipErr.message}).`,
        };
      }
      const entries = zip.getEntries();
      const entryNames = entries.map((e) => e.entryName);
      const themeEntry = entries.find((entry) =>
        entry.entryName.endsWith(".theme.json"),
      );
      console.log(
        `${TAG} [4/5 ZIP Extraction] files=[${entryNames.join(", ")}] hasThemeJson=${!!themeEntry}`,
      );

      if (!themeEntry) {
        console.log(
          `${TAG} [4/5 ZIP Extraction] FAIL — no .theme.json in archive`,
        );
        return {
          success: false,
          error: `ZIP extraction failed: no .theme.json file found in archive. Files present: [${entryNames.join(", ")}]`,
        };
      }

      // Validate entry path (security: prevent path traversal)
      if (
        themeEntry.entryName.includes("..") ||
        path.isAbsolute(themeEntry.entryName)
      ) {
        return {
          success: false,
          error:
            "ZIP extraction failed: invalid file path detected in archive.",
        };
      }

      // Parse theme data from ZIP entry
      const themeJson = themeEntry.getData().toString("utf-8");
      try {
        themeData = JSON.parse(themeJson);
      } catch (parseErr) {
        return {
          success: false,
          error: `ZIP extraction failed: ${themeEntry.entryName} contains invalid JSON (${parseErr.message}).`,
        };
      }
    }

    // Add registry metadata
    themeData._registryMeta = {
      source: "registry",
      packageName,
      installedAt: new Date().toISOString(),
    };

    // Stage 5: Theme save
    const themeKey = pkg.displayName || pkg.name;
    console.log(
      `${TAG} [5/5 Theme Save] themeKey="${themeKey}" hasName=${!!themeData.name} hasColors=${!!(themeData.colors || themeData.primary)}`,
    );

    const saveResult = themeController.saveThemeForApplication(
      win,
      appId,
      themeKey,
      themeData,
    );

    if (saveResult.error) {
      console.log(`${TAG} [5/5 Theme Save] FAIL — ${saveResult.message}`);
      return {
        success: false,
        error: `Theme save failed: ${saveResult.message}`,
      };
    }

    console.log(`${TAG} [5/5 Theme Save] SUCCESS — installed "${themeKey}"`);

    return {
      success: true,
      themeKey,
      theme: themeData,
      themes: saveResult.themes,
    };
  } catch (err) {
    console.error(`${TAG} Unexpected error:`, err);
    return {
      success: false,
      error: `Unexpected error during theme install: ${err.message}`,
    };
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

/**
 * Check installed themes for available updates against the registry.
 *
 * Reads every theme from the app's theme file, picks the ones that
 * carry a `_registryMeta.packageName` (i.e. were installed from the
 * registry, not locally created), resolves each against the registry
 * index by `@scope/name` (with a bare-name fallback), and returns a
 * diff record for each stale theme.
 *
 * Mirrors `checkDashboardUpdatesForApp` — callable standalone, works
 * the same way on the renderer side.
 *
 * @param {BrowserWindow} win
 * @param {string} appId
 * @returns {Promise<{success, updates, totalInstalled, error?}>}
 */
async function checkThemeUpdatesForApp(win, appId) {
  try {
    const { fetchRegistryIndex } = require("./registryController");
    const themesResult = themeController.listThemesForApplication(win, appId);
    if (themesResult.error) {
      return {
        success: false,
        error: themesResult.message || "Failed to read themes",
        updates: [],
      };
    }
    const themes = themesResult.themes || {};

    // Filter to registry-installed themes only.
    const installed = [];
    for (const [themeKey, themeData] of Object.entries(themes)) {
      const meta = themeData?._registryMeta;
      if (!meta?.packageName) continue;
      installed.push({
        themeKey,
        packageName: meta.packageName,
        scope: meta.scope || null,
        version: themeData.version || meta.lastPublishedVersion || "0.0.0",
      });
    }

    if (installed.length === 0) {
      return { success: true, updates: [], totalInstalled: 0 };
    }

    const index = await fetchRegistryIndex();
    const packages = (index.packages || []).filter(
      (p) => (p.type || "widget") === "theme",
    );

    // Index registry packages by scoped + bare key, same pattern as
    // dashboard update check.
    const registryByKey = new Map();
    for (const pkg of packages) {
      if (!pkg.name) continue;
      if (pkg.scope) {
        const bareScope = String(pkg.scope).replace(/^@/, "");
        registryByKey.set(`@${bareScope}/${pkg.name}`, pkg);
      }
      registryByKey.set(pkg.name, pkg);
    }

    const updates = [];
    for (const inst of installed) {
      const scope = inst.scope
        ? String(inst.scope).replace(/^@/, "")
        : inst.packageName.startsWith("@")
          ? inst.packageName.slice(1).split("/")[0]
          : null;
      const bareName = inst.packageName.includes("/")
        ? inst.packageName.split("/").pop()
        : inst.packageName;
      const scopedKey = scope ? `@${scope}/${bareName}` : null;
      const registryPkg =
        (scopedKey && registryByKey.get(scopedKey)) ||
        registryByKey.get(inst.packageName) ||
        registryByKey.get(bareName);
      if (!registryPkg) continue;

      const latestVersion = registryPkg.version || "0.0.0";
      if (inst.version !== latestVersion) {
        updates.push({
          themeKey: inst.themeKey,
          packageName: inst.packageName,
          scope,
          installedVersion: inst.version,
          latestVersion,
          downloadUrl: registryPkg.downloadUrl || null,
        });
      }
    }

    return {
      success: true,
      updates,
      totalInstalled: installed.length,
    };
  } catch (err) {
    console.error(
      "[ThemeRegistryController] Error checking theme updates:",
      err,
    );
    return { success: false, error: err.message, updates: [] };
  }
}

module.exports = {
  prepareThemeForPublish,
  installThemeFromRegistry,
  getThemePublishPreview,
  generateThemeRegistryManifest,
  extractColors,
  checkThemeUpdatesForApp,
};
