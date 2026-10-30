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
  makeRegistryRef,
  readRegistryRef,
  normalizePackageRef,
} = require("../registry/packageRef");
const {
  resolveForInstall,
  themeKeyFor,
  planPackagePublish,
  getPackageInfo,
  nextFreeVersion,
} = require("../registry/registryPackages");
const { remixOrigin, checkRemix } = require("../registry/remix");
const { publishFingerprint } = require("../registry/fingerprint");
const {
  getAuthStatus,
  getRegistryProfile,
} = require("./registryAuthController");
const {
  registryDownloadFetch,
  downloadRefusal,
} = require("../registryDownload");

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
  // A name picked for it (its own package, or a free one), else a slug.
  const sanitizedName = options.packageName || sanitizeName(humanName);
  const colors = extractColors(themeData);
  // `keepVisibility`: an existing package keeps its visibility (none sent).
  const visibility = options.keepVisibility
    ? undefined
    : options.visibility === "private"
      ? "private"
      : "public";
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
    ...(visibility ? { visibility } : {}),
    type: "theme",
    category: "general",
    tags: options.tags || [],
    icon: "palette",
    colors,
    appOrigin: options.appOrigin || "",
    publishedAt: new Date().toISOString(),
    // Remixes (registry 1.9.0): the original this copies, and whether this
    // one may be remixed (sent only when the user chose).
    ...(options.remixedFrom ? { remixedFrom: options.remixedFrom } : {}),
    ...(typeof options.allowRemix === "boolean"
      ? { allowRemix: options.allowRemix }
      : {}),
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
  let headlessTmpDir = null;
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
    let nextVersion = resolveNextVersion(previousVersion, {
      bump: options.bump,
      version: options.version,
    });

    // Without a dialog (`headless`, a profile's themes): the name is picked
    // automatically — this theme's own package or a free one — and the
    // version is the next the registry doesn't have.
    let headlessPlan = null;
    let ownPackageName = null;
    if (options.headless) {
      headlessPlan = await planPackagePublish({
        kind: "theme",
        record: themeData,
        displayName: themeData.name || themeKey,
        localVersion: themeData.version || null,
        username: scope,
      });
      if (headlessPlan.error) {
        return { success: false, error: headlessPlan.error };
      }
      nextVersion = headlessPlan.version;
    } else if (!options.version) {
      // Republishing this theme's own package: never a version the
      // registry already has (it refuses those, and the Publish dialog
      // doesn't bump by default). Only its own package — a different theme
      // that happens to share the name gets the registry's refusal, not a
      // quiet new version of the other theme.
      const ref = readRegistryRef("theme", themeData);
      const own = ref && normalizePackageRef(ref.package);
      // This theme's own package under the user's scope — even renamed
      // since (theme change leftovers: Publish the update updates it).
      if (own && own.scope.toLowerCase() === String(scope).toLowerCase()) {
        ownPackageName = options.packageName ? null : own.name.toLowerCase();
        const name = options.packageName || own.name.toLowerCase();
        const info = await getPackageInfo({ scope, name });
        if (info && typeof info === "object") {
          nextVersion = nextFreeVersion(nextVersion, info);
        }
      }
    }

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

    // A copy of someone else's theme is published as a remix of it,
    // credited — unless its author doesn't allow remixes.
    const remix = await checkRemix(remixOrigin("theme", themeData, scope));
    if (remix.error) return { success: false, error: remix.error };
    const remixedFrom = remix.remixedFrom;

    // Generate manifest
    const manifest = generateThemeRegistryManifest(themeData, themeKey, {
      ...options,
      scope,
      appOrigin: appId,
      version: nextVersion,
      authorName: resolvedAuthor,
      remixedFrom: remix.remixedFrom,
      ...(ownPackageName ? { packageName: ownPackageName } : {}),
      ...(headlessPlan
        ? {
            packageName: headlessPlan.name,
            visibility: headlessPlan.visibility,
            keepVisibility: headlessPlan.exists,
          }
        : {}),
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

    // Where the zip goes: the user picks, or (headless) a temp file that's
    // removed once it's sent
    const sanitizedName = sanitizeName(themeKey);
    const defaultFilename = `theme-${sanitizedName}-v${manifest.version}.zip`;
    let filePath;
    if (headlessPlan) {
      const tmpDir = fs.mkdtempSync(
        path.join(app.getPath("temp"), "dash-publish-"),
      );
      headlessTmpDir = tmpDir;
      filePath = path.join(tmpDir, defaultFilename);
    } else {
      const saveResult = await dialog.showSaveDialog(win, {
        title: "Save Theme Package",
        defaultPath: defaultFilename,
        filters: [{ name: "ZIP Files", extensions: ["zip"] }],
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: "Save canceled" };
      }
      filePath = saveResult.filePath;
    }

    // Create ZIP with manifest.json + {name}.theme.json
    const zip = new AdmZip();
    zip.addFile(
      "manifest.json",
      Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
    );
    // The theme as published: at the version being published (it used to
    // carry the previous one, so installers' version checks were off by
    // one), and without the publisher's record of where their copy came
    // from (the installer records its own).
    const {
      registryRef: _ownRef,
      remixedFrom: _ownRemix,
      ...ownTheme
    } = themeData;
    const publishedTheme = {
      ...ownTheme,
      version: nextVersion,
      ...(resolvedAuthor ? { author: resolvedAuthor } : {}),
    };
    zip.addFile(
      `${sanitizedName}.theme.json`,
      Buffer.from(JSON.stringify(publishedTheme, null, 2), "utf-8"),
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
          const registryRef = makeRegistryRef({
            package: { scope, name: manifest.name },
            kind: "theme",
            version: nextVersion,
            origin: "published",
            contentHash: publishFingerprint("theme", themeData),
          });
          if (registryRef) updatedTheme.registryRef = registryRef;
          else delete updatedTheme.registryRef;
          // A remix remembers its original: a later publish — even under
          // another name — is still a remix of it (and checked against it).
          if (remixedFrom) {
            updatedTheme.remixedFrom = {
              package: `${remixedFrom.scope}/${remixedFrom.name}`,
              version: remixedFrom.version,
            };
          }

          themeController.saveThemeForApplication(
            win,
            appId,
            themeKey,
            updatedTheme,
          );
        } catch (persistErr) {
          console.warn(
            `[ThemeRegistryController] Version persist failed (continuing): ${persistErr.message}`,
          );
        }
      }
    }

    if (headlessPlan) {
      try {
        fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
      } catch (_e) {
        // a leftover temp file is harmless
      }
      const ok = !!(registryResult && registryResult.success);
      return {
        success: ok,
        ...(ok
          ? {}
          : {
              error:
                (registryResult && registryResult.error) ||
                "The registry didn't accept the theme.",
            }),
        package: headlessPlan.package,
        version: nextVersion,
        renamed: headlessPlan.renamed,
        visibility: headlessPlan.exists ? "unchanged" : "private",
        registryResult,
      };
    }

    return {
      success: true,
      manifest,
      filePath,
      registryResult,
    };
  } catch (err) {
    // A headless publish that failed partway leaves no temp folder.
    if (headlessTmpDir) {
      try {
        fs.rmSync(headlessTmpDir, { recursive: true, force: true });
      } catch (_e) {
        // harmless
      }
    }
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
async function installThemeFromRegistry(win, appId, packageName, options = {}) {
  const TAG = "[ThemeInstall]";
  try {
    // Stage 1: Package lookup — at an exact version when asked
    // (options.version; a profile lists exact versions), else the latest
    console.log(`${TAG} [1/5 Package Lookup] input="${packageName}"`);
    const resolved = await resolveForInstall(
      packageName,
      { kinds: ["theme"], version: options.version || null },
      {
        getPackage: (ref) => registryController.getPackage(ref),
        refreshIndex: () => registryController.fetchRegistryIndex?.(true),
      },
    );
    if (resolved.error) {
      console.log(`${TAG} [1/5 Package Lookup] FAIL — ${resolved.error}`);
      return {
        success: false,
        error: `Package lookup failed: ${resolved.error} The package may have been removed or the name may be incorrect.`,
      };
    }
    const pkg = resolved.pkg;
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

    // Stage 3: Download (signed out too: public themes need no sign-in)
    let response;
    let expired = false;
    try {
      ({ response, expired } = await registryDownloadFetch(downloadUrl));
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
    const refusal = downloadRefusal(response, { expired });
    if (refusal) return { success: false, ...refusal };
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
    let signingMeta = null;

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
        // Phase 1C signing metadata accompanies the downloadUrl
        // since dash-registry v1.5.27. Captured here and verified
        // below, before the ZIP is extracted.
        signingMeta = {
          zipSignature: jsonData.zipSignature || null,
          publisherCert: jsonData.publisherCert || null,
          publisherKeyId: jsonData.publisherKeyId || null,
          publisherFingerprint: jsonData.publisherFingerprint || null,
        };
      } else {
        // No downloadUrl — treat as direct theme data
        console.log(
          `${TAG} [4/5 Extract] JSON response with no downloadUrl — using as theme data`,
        );
        themeData = jsonData.data || jsonData.theme || jsonData;
      }
    }

    if (!themeData) {
      // Phase 1C: verify signature + cert + revocation before
      // touching the ZIP. In `off` mode this is a no-op; in `warn`
      // (default during rollout) failures log + proceed; in `strict`
      // failures throw and we return an error response.
      try {
        const {
          verifyDownloadedPackage,
        } = require("../security/verifyRegistryInstall");
        const verifyResult = await verifyDownloadedPackage({
          zipBuffer,
          zipSignature: signingMeta ? signingMeta.zipSignature : null,
          publisherCert: signingMeta ? signingMeta.publisherCert : null,
          publisherKeyId: signingMeta ? signingMeta.publisherKeyId : null,
          publisherFingerprint: signingMeta
            ? signingMeta.publisherFingerprint
            : null,
        });
        if (!verifyResult.verified && verifyResult.mode === "warn") {
          console.warn(
            `${TAG} [Verify] Installing unverified theme "${packageName}" — ` +
              `reason: ${verifyResult.reason}. Set ` +
              `DASH_REGISTRY_VERIFY_SIGNED_INSTALL=strict to refuse.`,
          );
        }
      } catch (verifyErr) {
        console.log(`${TAG} [Verify] FAIL — ${verifyErr.message || verifyErr}`);
        return {
          success: false,
          error: `Install verification failed: ${verifyErr.message || verifyErr}`,
        };
      }

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
    // The version downloaded (the theme's own `version` can lag behind it).
    const registryRef = makeRegistryRef({
      package: { scope: pkg.scope, name: pkg.name },
      kind: "theme",
      version: urlVersion,
      origin: "installed",
      contentHash: publishFingerprint("theme", themeData),
    });
    // An install is the registry's package, not a copy of something.
    delete themeData.remixedFrom;
    if (registryRef) themeData.registryRef = registryRef;
    else delete themeData.registryRef;

    // Stage 5: Theme save — over the theme already installed from this
    // package (an update), never over a different theme with the same name
    const existingThemes =
      themeController.listThemesForApplication(win, appId)?.themes || {};
    const themeKey = themeKeyFor(
      existingThemes,
      { scope: pkg.scope, name: pkg.name },
      pkg.displayName || pkg.name,
    );
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
async function getThemePublishPreview(appId, themeKey) {
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

    // Published already (theme change leftovers): its version and whether
    // it's public or private, so an update keeps it — checked: false when
    // the registry couldn't be asked.
    let published = null;
    try {
      const { themePublished } = require("../../src/utils/themeStanding");
      let username = null;
      try {
        username =
          require("./registryAuthController").getStoredUsername() || null;
      } catch (_e) {
        username = null;
      }
      const pub = themePublished(themeData, { username });
      if (pub) {
        const info = await getPackageInfo(pub.package, {
          authFailuresUnreachable: true,
        });
        const known = !!info && typeof info === "object";
        const version = (known && info.latestVersion) || pub.version || null;
        published = {
          package: pub.package,
          version,
          visibility: known ? info.visibility || null : null,
          nextVersion: known ? nextFreeVersion(version || "1.0.0", info) : null,
          checked: known,
          // Not there any more (or not yours to see): publishing makes it.
          gone: info === null,
        };
      }
    } catch (_e) {
      published = null;
    }

    return {
      success: true,
      themeName: themeKey,
      colors,
      hasRegistryMeta: !!themeData._registryMeta,
      published,
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

/**
 * Publish a theme to the user's account without asking (a profile's
 * themes, dash-profiles v2): no save dialog, its name picked automatically,
 * private when new, at the next version the registry doesn't have.
 */
function publishThemeHeadless(appId, themeKey, options = {}) {
  return prepareThemeForPublish(null, appId, themeKey, {
    authorName: options.authorName,
    description: options.description,
    tags: options.tags,
    allowRemix: options.allowRemix,
    headless: true,
  });
}

module.exports = {
  prepareThemeForPublish,
  publishThemeHeadless,
  installThemeFromRegistry,
  getThemePublishPreview,
  generateThemeRegistryManifest,
  extractColors,
  checkThemeUpdatesForApp,
};
