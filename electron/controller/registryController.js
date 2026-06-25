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
const os = require("os");
const { toPackageId } = require("../utils/packageId");
const { getStoredToken, authedFetch } = require("./registryAuthController");

// Default registry API base URL
const DEFAULT_REGISTRY_API_URL = "https://main.d919rwhuzp7rj.amplifyapp.com";

// Cache TTL: 5 minutes
const CACHE_TTL_MS = 5 * 60 * 1000;

// Cache is keyed by userId so anonymous + authenticated results don't mix.
// When a user signs in, their cache entry is empty and gets populated with
// their owned/entitled private packages alongside the public set.
const caches = new Map(); // userId | "anon" -> { data, timestamp }

function getCacheKey() {
  const stored = getStoredToken();
  return stored?.userId || "anon";
}

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
  const cacheKey = getCacheKey();
  const cached = caches.get(cacheKey);

  // Return cached data if still valid
  if (!forceRefresh && cached && now - cached.timestamp < CACHE_TTL_MS) {
    console.log(
      `[RegistryController] Returning cached registry index (key=${cacheKey})`,
    );
    return cached.data;
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
        const response = await authedFetch(registryUrl);
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

      const response = await authedFetch(registryUrl);
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
    caches.set(cacheKey, { data: indexData, timestamp: now });

    console.log(
      `[RegistryController] Loaded ${indexData.packages?.length || 0} packages (key=${cacheKey})`,
    );
    return indexData;
  } catch (error) {
    console.error("[RegistryController] Error fetching registry:", error);

    // Return stale cache if available
    const stale = caches.get(cacheKey);
    if (stale) {
      console.log(
        "[RegistryController] Returning stale cache after fetch error",
      );
      return stale.data;
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

  // Apply category filter (supports single string or comma-separated or array)
  if (filters.category) {
    const cats = Array.isArray(filters.category)
      ? filters.category
      : filters.category.split(",").map((c) => c.trim().toLowerCase());
    packages = packages.filter((pkg) =>
      cats.includes((pkg.category || "").toLowerCase()),
    );
  }

  // Apply author filter
  if (filters.author) {
    packages = packages.filter(
      (pkg) =>
        (pkg.author || "").toLowerCase() === filters.author.toLowerCase(),
    );
  }

  // Apply tag filter (supports single string or comma-separated or array)
  if (filters.tag) {
    const tags = Array.isArray(filters.tag)
      ? filters.tag
      : filters.tag.split(",").map((t) => t.trim().toLowerCase());
    packages = packages.filter((pkg) =>
      (pkg.tags || []).some((t) => tags.includes(t.toLowerCase())),
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
 * Get a specific package by name.
 *
 * Handles multiple naming formats:
 *  - bare name:   "ocean-depth"
 *  - scoped name: "john/ocean-depth" or "@john/ocean-depth"
 *  - displayName: "Ocean Depth"
 *
 * @param {string} packageName - Name of the package (any format)
 * @returns {Promise<Object|null>} Package data or null if not found
 */
async function getPackage(packageName) {
  if (!packageName) return null;

  const index = await fetchRegistryIndex();
  const packages = index.packages || [];

  // 1. Exact match on name
  let pkg = packages.find((p) => p.name === packageName);
  if (pkg) return pkg;

  // 2. If input contains "/", split into scope + name and match both fields
  if (packageName.includes("/")) {
    const parts = packageName.split("/");
    const inputScope = parts[0].replace(/^@/, "");
    const inputName = parts.slice(1).join("/");
    pkg = packages.find(
      (p) =>
        p.name === inputName &&
        (p.scope || "").replace(/^@/, "") === inputScope,
    );
    if (pkg) return pkg;
  }

  // 3. Match by displayName (case-insensitive)
  const lower = packageName.toLowerCase();
  pkg = packages.find((p) => (p.displayName || "").toLowerCase() === lower);
  if (pkg) return pkg;

  // 4. Try bare-name match against scoped registry entries
  //    (registry might store "scope/name" in p.name while caller sends just "name")
  pkg = packages.find((p) => {
    if (p.name && p.name.includes("/")) {
      const bareName = p.name.split("/").pop();
      return bareName === packageName;
    }
    return false;
  });

  return pkg || null;
}

/**
 * Parse an installed widget's id (`@scope/name` or `scope/name` or
 * `name`) into a `{scope, name}` ref the check-versions endpoint
 * accepts. Returns null when no scope is present — the new endpoint
 * needs both fields.
 */
function _parseScopedRef(installedId) {
  if (!installedId || typeof installedId !== "string") return null;
  if (!installedId.includes("/")) return null;
  const stripped = installedId.replace(/^@/, "");
  const parts = stripped.split("/");
  if (parts.length < 2) return null;
  const scope = parts[0];
  const name = parts.slice(1).join("/");
  if (!scope || !name) return null;
  return { scope, name };
}

/**
 * Check for updates to installed widgets.
 *
 * Uses the registry's POST /api/packages/check-versions endpoint, which
 * returns latest-version-by-id regardless of auth/visibility. Critically,
 * this means **private packages the user has installed are checked even
 * when the app launches anonymously** (before sign-in completes / for
 * users who haven't signed in this session). The previous implementation
 * fetched the entire registry index, which is visibility-filtered
 * server-side and so silently hid private packages from anonymous
 * callers — the user's installed-but-private widgets reported "no
 * update available" forever until they manually re-checked after
 * signing in.
 *
 * Bare-name (unscoped) installed widgets can't be queried via the new
 * endpoint (it needs scope+name). For those we fall back to the legacy
 * index-scan. Same fallback covers the transition period while the
 * registry-side endpoint is still being deployed — if the endpoint
 * isn't there yet, we silently degrade to the old behavior.
 *
 * @param {Array<Object>} installedWidgets - Array of { name, version } objects
 * @returns {Promise<Array<Object>>} Widgets with available updates
 */
async function checkUpdates(installedWidgets = []) {
  if (!Array.isArray(installedWidgets) || installedWidgets.length === 0) {
    return [];
  }

  // Bucket installed widgets by whether they have a scope (and so can
  // use the new endpoint) or not (fall back to index scan).
  const scopedRefs = []; // { scope, name, installed }
  const bareInstalled = []; // { name, version }
  for (const installed of installedWidgets) {
    const installedId = installed.packageId || installed.name;
    const ref = _parseScopedRef(installedId);
    if (ref) {
      scopedRefs.push({
        scope: ref.scope,
        name: ref.name,
        installed,
        installedId,
      });
    } else {
      bareInstalled.push(installed);
    }
  }

  const updates = [];

  // --- Path A: /api/packages/resolve (covers scoped refs, anon-friendly) ---
  // The resolve endpoint returns latestVersion per ref for both public
  // packages AND private packages where the registry's entitlement
  // check says the caller is allowed (which today includes anonymous
  // callers for packages with permissive read policies — verified via
  // curl on 2026-05-19). This means installed-but-private widgets show
  // up in the update check even at app launch before the user has
  // signed in, which was the original gap.
  //
  // We try check-versions first (a dash-registry PR adds a tighter
  // endpoint that returns ONLY latestVersion without entitlement
  // gating); if it's not deployed yet, fall back to /resolve. Both
  // produce the same shape for our purposes; resolve carries more
  // metadata but we only read latestVersion.
  if (scopedRefs.length > 0) {
    const registryBase =
      process.env.DASH_REGISTRY_API_URL || DEFAULT_REGISTRY_API_URL;
    const refsBody = JSON.stringify({
      refs: scopedRefs.map((r) => ({ scope: r.scope, name: r.name })),
    });
    let endpointAvailable = true;
    let results = null;
    // Try check-versions first (returns less data, no entitlement
    // dependency); fall back to /resolve if it 404s (registry without
    // the new endpoint deployed).
    for (const endpointPath of [
      "/api/packages/check-versions",
      "/api/packages/resolve",
    ]) {
      const url = `${registryBase}${endpointPath}`;
      try {
        // authedFetch injects the Bearer token and transparently refreshes it
        // on expiry. Auth is optional here but widens what /resolve returns
        // for private packages where ownership matters.
        const response = await authedFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: refsBody,
        });
        if (response.status === 404) {
          // Endpoint not deployed — try the next one.
          continue;
        }
        if (!response.ok) {
          throw new Error(
            `${endpointPath} ${response.status} ${response.statusText}`,
          );
        }
        results = await response.json();
        endpointAvailable = true;
        break;
      } catch (error) {
        console.warn(
          `[RegistryController] ${endpointPath} failed:`,
          error.message,
        );
        endpointAvailable = false;
        // Try next endpoint
      }
    }

    if (endpointAvailable && Array.isArray(results)) {
      // Index results by `scope/name` so we can join back to our
      // scopedRefs list without depending on Promise.all ordering.
      const byKey = new Map();
      for (const r of results) {
        if (r && r.scope && r.name) {
          byKey.set(`${r.scope}/${r.name}`, r);
        }
      }
      for (const ref of scopedRefs) {
        const result = byKey.get(`${ref.scope}/${ref.name}`);
        if (!result || !result.exists) continue;
        if (
          result.latestVersion &&
          result.latestVersion !== ref.installed.version
        ) {
          // Build the download URL deterministically — same shape the
          // existing index serves (`/api/packages/<scope>/<name>/download?version=<v>`).
          // Constructed client-side because check-versions intentionally
          // doesn't return downloadUrl (less to leak; download still
          // gated by visibility/entitlements at /download).
          const downloadUrl = `${registryBase}/api/packages/${encodeURIComponent(
            ref.scope,
          )}/${encodeURIComponent(ref.name)}/download?version=${encodeURIComponent(
            result.latestVersion,
          )}`;
          updates.push({
            name: ref.installed.name,
            currentVersion: ref.installed.version,
            latestVersion: result.latestVersion,
            downloadUrl,
            changelog: null,
          });
        }
      }
    } else {
      // Endpoint unavailable — treat scoped refs as bare for the
      // fallback path so they at least get a public-only check.
      for (const ref of scopedRefs) {
        bareInstalled.push(ref.installed);
      }
    }
  }

  // --- Path B: index scan (bare-name widgets + endpoint fallback) ---
  if (bareInstalled.length > 0) {
    const index = await fetchRegistryIndex();
    for (const installed of bareInstalled) {
      const installedId = installed.packageId || installed.name;
      const pkg = (index.packages || []).find((p) => {
        const registryId = toPackageId(p.scope, p.name);
        if (registryId === installedId) return true;
        if (p.name === installedId) return true;
        return false;
      });
      if (pkg && pkg.version !== installed.version) {
        updates.push({
          name: installed.name,
          currentVersion: installed.version,
          latestVersion: pkg.version,
          downloadUrl: pkg.downloadUrl,
          changelog: pkg.changelog || null,
        });
      }
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

/**
 * Fetch a registry package's source files into a temp directory and return
 * the parsed component + config source (and prebuilt bundle, if present)
 * WITHOUT installing the package into the user's widget library.
 *
 * Used by read-only preview flows (e.g. the Widget Builder's Discover tab)
 * where the user is browsing registry widgets and wants to see them render
 * inline before choosing to install or remix.
 *
 * Multi-widget packages (e.g. @trops/clock contains Analog/Digital/Flip/Text
 * clocks) ship with one .js + .dash.js pair per widget. Pass `componentName`
 * to pick a specific widget — otherwise we return the alphabetically-first
 * widget found, which is almost never what the caller wants for UI previews.
 *
 * @param {string} packageName - Any form accepted by getPackage()
 *   (bare name, scoped "scope/name", or displayName)
 * @param {string} [componentName] - Specific widget inside the package to
 *   return. Matched against file names in `widgets/`. Accepts either a
 *   bare name ("FlipClockWidget") or a dotted scoped id
 *   ("trops.clock.FlipClockWidget") — the last dotted segment is used.
 * @returns {Promise<Object>} {
 *   componentCode, configCode, bundleSource, widgetName,
 *   displayName, description, packageName, scope, downloadUrl
 * }
 */
async function fetchPackageSource(packageName, componentName = null) {
  if (!packageName) {
    throw new Error("fetchPackageSource: packageName is required");
  }

  // adm-zip is only available in the host app's node_modules (dash-electron),
  // so defer loading until the function actually runs.
  const AdmZip = require("adm-zip");
  const { validateZipEntries } = require("../widgetRegistry");

  const pkg = await getPackage(packageName);
  if (!pkg) {
    throw new Error(`Package "${packageName}" not found in the registry`);
  }
  if (!pkg.downloadUrl) {
    throw new Error(`Package "${packageName}" has no downloadUrl`);
  }

  const parsedUrl = new URL(pkg.downloadUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error(
      `Registry downloads must use HTTPS. Refusing to fetch: ${pkg.downloadUrl}`,
    );
  }

  const registryBase =
    process.env.DASH_REGISTRY_API_URL ||
    "https://main.d919rwhuzp7rj.amplifyapp.com";
  // Use authedFetch (Bearer + auto-refresh) only for registry-hosted URLs;
  // external download URLs (e.g. GitHub releases) must NOT receive our token.
  const isRegistryUrl =
    pkg.downloadUrl.includes(registryBase) ||
    pkg.downloadUrl.includes("/api/packages/");
  const response = isRegistryUrl
    ? await authedFetch(pkg.downloadUrl)
    : await fetch(pkg.downloadUrl);
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Authentication required to preview this package");
    }
    throw new Error(`Failed to fetch package: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  let buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("Preview failed: registry returned an empty response");
  }
  if (contentType.includes("text/html")) {
    throw new Error(
      "Preview failed: registry returned an HTML page instead of package data",
    );
  }
  if (contentType.includes("application/json")) {
    const jsonData = JSON.parse(buffer.toString("utf-8"));
    if (jsonData.error) {
      throw new Error(`Preview failed: ${jsonData.error}`);
    }
    if (jsonData.downloadUrl) {
      const zipResponse = await fetch(jsonData.downloadUrl);
      if (!zipResponse.ok) {
        throw new Error(
          `Preview failed: storage returned ${zipResponse.status} ${zipResponse.statusText}`,
        );
      }
      buffer = Buffer.from(await zipResponse.arrayBuffer());
    }
  }

  const zip = new AdmZip(buffer);
  const safeName = (pkg.name || "pkg").replace(/[^a-zA-Z0-9-_]/g, "_");
  const tempDir = path.join(
    os.tmpdir(),
    `dash-registry-preview-${safeName}-${Date.now()}`,
  );

  try {
    validateZipEntries(zip, tempDir);
    zip.extractAllTo(tempDir, true);

    const widgetsDir = path.join(tempDir, "widgets");
    let componentCode = "";
    let configCode = "";
    let widgetName = null;

    if (fs.existsSync(widgetsDir)) {
      const files = fs.readdirSync(widgetsDir);
      const dashFiles = files.filter((f) => f.endsWith(".dash.js"));
      const componentFiles = files.filter(
        (f) => f.endsWith(".js") && !f.endsWith(".dash.js") && f !== "index.js",
      );

      // Normalize componentName hint: accept "FlipClockWidget" or the
      // dotted form "trops.clock.FlipClockWidget" (last segment wins).
      const bareHint =
        typeof componentName === "string" && componentName.length
          ? componentName.split(".").pop()
          : null;

      // Pick the .dash.js pair that matches the hint; fall back to the
      // first file so pre-hint callers still work.
      let configFile = null;
      if (bareHint) {
        configFile = dashFiles.find((f) => f === `${bareHint}.dash.js`);
      }
      if (!configFile) configFile = dashFiles[0];

      if (configFile) {
        configCode = fs.readFileSync(path.join(widgetsDir, configFile), "utf8");
        widgetName = configFile.replace(/\.dash\.js$/, "");
      }

      let componentFile = null;
      if (widgetName) {
        componentFile = componentFiles.find((f) => f === `${widgetName}.js`);
      }
      if (!componentFile && bareHint) {
        componentFile = componentFiles.find((f) => f === `${bareHint}.js`);
      }
      if (!componentFile) componentFile = componentFiles[0];

      if (componentFile) {
        componentCode = fs.readFileSync(
          path.join(widgetsDir, componentFile),
          "utf8",
        );
        if (!widgetName) widgetName = componentFile.replace(/\.js$/, "");
      }
    }

    let bundleSource = null;
    const bundlePath = path.join(tempDir, "dist", "index.cjs.js");
    if (fs.existsSync(bundlePath)) {
      bundleSource = fs.readFileSync(bundlePath, "utf8");
    }

    let dashMeta = {};
    const dashPath = path.join(tempDir, "dash.json");
    if (fs.existsSync(dashPath)) {
      try {
        dashMeta = JSON.parse(fs.readFileSync(dashPath, "utf8"));
      } catch {
        // Ignore — metadata is optional for preview
      }
    }

    return {
      componentCode,
      configCode,
      bundleSource,
      widgetName,
      displayName: pkg.displayName || dashMeta.displayName || widgetName,
      description: pkg.description || dashMeta.description || "",
      packageName: pkg.name,
      scope: pkg.scope,
      downloadUrl: pkg.downloadUrl,
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(
        `[RegistryController] Failed to clean up preview temp dir ${tempDir}:`,
        err.message,
      );
    }
  }
}

/**
 * Fetch the `dash.permissions` block from a registry package WITHOUT
 * installing it. Powers the pre-install preflight: the update flow
 * uses this to learn which MCP/fs/network grants a new package
 * version requires before downloading the install. The user then
 * approves the delta (declared - already-granted) and the install
 * proceeds knowing nothing will surprise them after the fact.
 *
 * Returns `{ packageId, version, permissions }` where `permissions`
 * is the `dash.permissions` blob from package.json (or null if the
 * package declares none). Throws on network / unzip / parse errors —
 * callers should treat a throw as "couldn't preflight; prompt anyway
 * post-install via the existing flow" rather than blocking the
 * update on a transient registry hiccup.
 *
 * @param {string} packageName
 * @returns {Promise<{packageId: string, version: string|null, permissions: object|null}>}
 */
async function fetchPackageManifest(packageName) {
  if (!packageName) {
    throw new Error("fetchPackageManifest: packageName is required");
  }

  const AdmZip = require("adm-zip");
  const { validateZipEntries } = require("../widgetRegistry");

  const pkg = await getPackage(packageName);
  if (!pkg) {
    throw new Error(`Package "${packageName}" not found in the registry`);
  }
  if (!pkg.downloadUrl) {
    throw new Error(`Package "${packageName}" has no downloadUrl`);
  }

  const parsedUrl = new URL(pkg.downloadUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error(
      `Registry downloads must use HTTPS. Refusing to fetch: ${pkg.downloadUrl}`,
    );
  }

  const registryBase =
    process.env.DASH_REGISTRY_API_URL ||
    "https://main.d919rwhuzp7rj.amplifyapp.com";
  // Use authedFetch (Bearer + auto-refresh) only for registry-hosted URLs;
  // external download URLs (e.g. GitHub releases) must NOT receive our token.
  const isRegistryUrl =
    pkg.downloadUrl.includes(registryBase) ||
    pkg.downloadUrl.includes("/api/packages/");
  const response = isRegistryUrl
    ? await authedFetch(pkg.downloadUrl)
    : await fetch(pkg.downloadUrl);
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Authentication required to fetch this package manifest");
    }
    throw new Error(`Failed to fetch package manifest: ${response.statusText}`);
  }
  const contentType = response.headers.get("content-type") || "";
  let buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("Manifest fetch failed: registry returned an empty body");
  }
  if (contentType.includes("application/json")) {
    const jsonData = JSON.parse(buffer.toString("utf-8"));
    if (jsonData.error) {
      throw new Error(`Manifest fetch failed: ${jsonData.error}`);
    }
    if (jsonData.downloadUrl) {
      const zipResponse = await fetch(jsonData.downloadUrl);
      if (!zipResponse.ok) {
        throw new Error(
          `Manifest fetch failed: storage returned ${zipResponse.status} ${zipResponse.statusText}`,
        );
      }
      buffer = Buffer.from(await zipResponse.arrayBuffer());
    }
  }

  const zip = new AdmZip(buffer);
  const safeName = (pkg.name || "pkg").replace(/[^a-zA-Z0-9-_]/g, "_");
  const tempDir = path.join(
    os.tmpdir(),
    `dash-registry-manifest-${safeName}-${Date.now()}`,
  );

  try {
    validateZipEntries(zip, tempDir);
    // Only need package.json — extract that single entry instead of
    // the whole zip to keep this cheap (the full extract in
    // fetchPackageSource is the right call for previews, but
    // pre-install preflight is hot path during a 22-widget batch
    // update so trimming N×(unzip-everything) helps).
    const pkgJsonEntry = zip.getEntries().find((e) => {
      const name = e.entryName.replace(/\\/g, "/");
      return name === "package.json" || name.endsWith("/package.json");
    });
    if (!pkgJsonEntry) {
      // No package.json in the zip — treat as "no declared
      // permissions" rather than throwing. Callers fall through to
      // the post-install consent path.
      return {
        packageId: toPackageId(pkg.scope, pkg.name),
        version: pkg.version || null,
        permissions: null,
      };
    }
    const pkgJsonText = zip.readAsText(pkgJsonEntry);
    let parsed;
    try {
      parsed = JSON.parse(pkgJsonText);
    } catch (e) {
      throw new Error(
        `Manifest fetch failed: invalid package.json (${e.message})`,
      );
    }
    return {
      packageId: toPackageId(pkg.scope, pkg.name),
      version: pkg.version || parsed.version || null,
      permissions: parsed.dash?.permissions || null,
    };
  } finally {
    // tempDir was never actually created (we read in-memory via
    // zip.readAsText), but validateZipEntries computes paths against
    // it. Keep the symmetric cleanup defensively in case future
    // edits switch back to extractAllTo.
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {
      // non-fatal
    }
  }
}

module.exports = {
  fetchRegistryIndex,
  searchRegistry,
  searchDashboards,
  searchThemes,
  getPackage,
  checkUpdates,
  fetchPackageSource,
  fetchPackageManifest,
};
