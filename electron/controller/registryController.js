/**
 * registryController.js
 *
 * Manages fetching, caching, and searching the remote widget registry index.
 * Runs in the Electron main process.
 *
 * Responsibilities:
 * - Fetch and cache the remote registry-index.json with 5-min TTL
 * - Search/filter across both packages and individual widgets
 * - Support two-level browsing: packages (bundles) and widgets within packages
 */

const path = require("path");
const fs = require("fs");

// Default registry API base URL
const DEFAULT_REGISTRY_API_URL = "https://main.d919rwhuzp7rj.amplifyapp.com";

// Cache TTL: 5 minutes
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedIndex = null;
let cacheTimestamp = 0;

/**
 * Get the local test registry path for dev mode
 */
function getTestRegistryPath() {
  return path.join(__dirname, "..", "registry", "test-registry-index.json");
}

/**
 * Check if running in development mode
 */
function isDev() {
  return (
    process.defaultApp ||
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "dev"
  );
}

/**
 * Fetch the registry index from remote URL or local file (dev mode)
 * Caches the result for CACHE_TTL_MS milliseconds.
 *
 * @param {boolean} forceRefresh - Bypass cache and fetch fresh data
 * @returns {Promise<Object>} The registry index
 */
async function fetchRegistryIndex(forceRefresh = false) {
  const now = Date.now();

  // Return cached data if still valid
  if (!forceRefresh && cachedIndex && now - cacheTimestamp < CACHE_TTL_MS) {
    console.log("[RegistryController] Returning cached registry index");
    return cachedIndex;
  }

  try {
    let indexData;

    if (isDev()) {
      // In dev mode, try local test file first
      const testPath = getTestRegistryPath();
      if (fs.existsSync(testPath)) {
        console.log(
          "[RegistryController] Loading test registry from:",
          testPath,
        );
        const raw = fs.readFileSync(testPath, "utf8");
        indexData = JSON.parse(raw);
      } else {
        // Fall back to API (supports DASH_REGISTRY_URL as full-URL override)
        const registryUrl =
          process.env.DASH_REGISTRY_URL ||
          `${process.env.DASH_REGISTRY_API_URL || DEFAULT_REGISTRY_API_URL}/api/packages`;
        console.log(
          "[RegistryController] Fetching registry from:",
          registryUrl,
        );
        const response = await fetch(registryUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch registry: ${response.status} ${response.statusText}`,
          );
        }
        indexData = await response.json();
      }
    } else {
      // In production, fetch from API
      const registryUrl =
        process.env.DASH_REGISTRY_URL ||
        `${process.env.DASH_REGISTRY_API_URL || DEFAULT_REGISTRY_API_URL}/api/packages`;
      console.log("[RegistryController] Fetching registry from:", registryUrl);

      const response = await fetch(registryUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch registry: ${response.status} ${response.statusText}`,
        );
      }
      indexData = await response.json();
    }

    // Normalize: ensure `version` exists on each package (API uses `latestVersion`)
    if (indexData.packages) {
      indexData.packages = indexData.packages.map((pkg) => ({
        ...pkg,
        version: pkg.version || pkg.latestVersion || "0.0.0",
      }));
    }

    // Cache the result
    cachedIndex = indexData;
    cacheTimestamp = now;

    console.log(
      `[RegistryController] Loaded ${indexData.packages?.length || 0} packages`,
    );
    return indexData;
  } catch (error) {
    console.error("[RegistryController] Error fetching registry:", error);

    // Return stale cache if available
    if (cachedIndex) {
      console.log(
        "[RegistryController] Returning stale cache after fetch error",
      );
      return cachedIndex;
    }

    throw error;
  }
}

/**
 * Search the registry across packages and individual widgets
 *
 * @param {string} query - Search query string
 * @param {Object} filters - Optional filters
 * @param {string} filters.category - Filter by category
 * @param {string} filters.author - Filter by author
 * @param {string} filters.tag - Filter by tag
 * @param {string} filters.type - Filter by package type ("widget" or "dashboard")
 * @param {string[]} filters.compatibleWidgets - Only return dashboards whose required widgets are all in this list
 * @param {string[]} filters.appCapabilities - Only return packages whose required API providers are all in this list
 * @returns {Promise<Object>} { packages: [...], totalWidgets: number }
 */
async function searchRegistry(query = "", filters = {}) {
  const index = await fetchRegistryIndex();
  let packages = index.packages || [];

  // Apply type filter — packages without an explicit type default to "widget"
  if (filters.type) {
    const typeLower = filters.type.toLowerCase();
    packages = packages.filter(
      (pkg) => (pkg.type || "widget").toLowerCase() === typeLower,
    );
  }

  // Apply search query
  if (query) {
    const q = query.toLowerCase();
    packages = packages.filter((pkg) => {
      // Match against package-level fields
      const packageMatch =
        (pkg.name || "").toLowerCase().includes(q) ||
        (pkg.displayName || "").toLowerCase().includes(q) ||
        (pkg.description || "").toLowerCase().includes(q) ||
        (pkg.author || "").toLowerCase().includes(q) ||
        (pkg.tags || []).some((t) => t.toLowerCase().includes(q));

      // Match against individual widgets within the package
      const widgetMatch = (pkg.widgets || []).some(
        (w) =>
          (w.name || "").toLowerCase().includes(q) ||
          (w.displayName || "").toLowerCase().includes(q) ||
          (w.description || "").toLowerCase().includes(q),
      );

      return packageMatch || widgetMatch;
    });
  }

  // Apply category filter
  if (filters.category) {
    packages = packages.filter(
      (pkg) =>
        (pkg.category || "").toLowerCase() === filters.category.toLowerCase(),
    );
  }

  // Apply author filter
  if (filters.author) {
    packages = packages.filter(
      (pkg) =>
        (pkg.author || "").toLowerCase() === filters.author.toLowerCase(),
    );
  }

  // Apply tag filter
  if (filters.tag) {
    const tagLower = filters.tag.toLowerCase();
    packages = packages.filter((pkg) =>
      (pkg.tags || []).some((t) => t.toLowerCase() === tagLower),
    );
  }

  // Apply compatibility filter — only dashboards whose required widgets
  // are all present in the user's installed widget list
  if (filters.compatibleWidgets && filters.compatibleWidgets.length) {
    const installedSet = new Set(
      filters.compatibleWidgets.map((w) => w.toLowerCase()),
    );
    packages = packages.filter((pkg) => {
      const requiredWidgets = (pkg.widgets || []).filter(
        (w) => w.required !== false,
      );
      return requiredWidgets.every(
        (w) =>
          installedSet.has((w.package || "").toLowerCase()) ||
          installedSet.has((w.name || "").toLowerCase()),
      );
    });
  }

  // Apply API capability filter — only return packages whose required
  // "api" providers are all present in the app's capability set
  if (filters.appCapabilities && filters.appCapabilities.length) {
    const capSet = new Set(filters.appCapabilities.map((c) => c.toLowerCase()));
    packages = packages.filter((pkg) => {
      // Collect all "api" provider requirements from package-level and widget-level providers
      const apiProviders = [];

      // Package-level providers
      for (const p of pkg.providers || []) {
        if (p.providerClass === "api" && p.required !== false) {
          apiProviders.push(p.type);
        }
      }

      // Widget-level providers
      for (const w of pkg.widgets || []) {
        for (const p of w.providers || []) {
          if (p.providerClass === "api" && p.required !== false) {
            apiProviders.push(p.type);
          }
        }
      }

      // Package is compatible if all required API namespaces are present
      return apiProviders.every((api) => capSet.has(api.toLowerCase()));
    });
  }

  // Count total widgets across matched packages
  const totalWidgets = packages.reduce(
    (sum, pkg) => sum + (pkg.widgets || []).length,
    0,
  );

  return { packages, totalWidgets };
}

/**
 * Get a specific package by name
 *
 * @param {string} packageName - Name of the package
 * @returns {Promise<Object|null>} Package data or null if not found
 */
async function getPackage(packageName) {
  const index = await fetchRegistryIndex();
  const pkg = (index.packages || []).find((p) => p.name === packageName);
  return pkg || null;
}

/**
 * Check for updates to installed widgets
 *
 * @param {Array<Object>} installedWidgets - Array of { name, version } objects
 * @returns {Promise<Array<Object>>} Widgets with available updates
 */
async function checkUpdates(installedWidgets = []) {
  const index = await fetchRegistryIndex();
  const updates = [];

  for (const installed of installedWidgets) {
    const pkg = (index.packages || []).find((p) => p.name === installed.name);
    if (pkg && pkg.version !== installed.version) {
      updates.push({
        name: pkg.name,
        currentVersion: installed.version,
        latestVersion: pkg.version,
        downloadUrl: pkg.downloadUrl,
        changelog: pkg.changelog || null,
      });
    }
  }

  return updates;
}

/**
 * Search the registry for dashboard packages only.
 * Convenience wrapper around searchRegistry with type: "dashboard".
 *
 * @param {string} query - Search query string
 * @param {Object} filters - Optional filters (category, author, tag, compatibleWidgets)
 * @returns {Promise<Object>} { packages: [...], totalWidgets: number }
 */
async function searchDashboards(query = "", filters = {}) {
  return searchRegistry(query, { ...filters, type: "dashboard" });
}

/**
 * Search the registry for theme packages only.
 * Convenience wrapper around searchRegistry with type: "theme".
 *
 * @param {string} query - Search query string
 * @param {Object} filters - Optional filters (category, author, tag)
 * @returns {Promise<Object>} { packages: [...], totalWidgets: number }
 */
async function searchThemes(query = "", filters = {}) {
  return searchRegistry(query, { ...filters, type: "theme" });
}

module.exports = {
  fetchRegistryIndex,
  searchRegistry,
  searchDashboards,
  searchThemes,
  getPackage,
  checkUpdates,
};
