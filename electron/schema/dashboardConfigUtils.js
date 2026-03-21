/**
 * dashboardConfigUtils.js
 *
 * Pure utility functions for dashboard config export/import.
 * No Electron dependencies — safe to test and reuse anywhere.
 */

/**
 * Collect all widget component names from a workspace layout.
 * Walks the layout tree and grid cells to find all placed components.
 *
 * @param {Array} layout - The workspace layout array
 * @returns {string[]} Unique component names
 */
function collectComponentNames(layout) {
  const components = new Set();

  for (const item of layout) {
    // Direct component reference
    if (item.component && item.type === "widget") {
      components.add(item.component);
    }

    // Grid cells
    if (item.grid) {
      for (const [key, cell] of Object.entries(item.grid)) {
        // Grid cells are keyed as "row.col" (e.g., "1.1", "2.3")
        if (/^\d+\.\d+$/.test(key) && cell && cell.component) {
          // cell.component can be a string (component name) or a number (layout item id)
          if (typeof cell.component === "string") {
            components.add(cell.component);
          }
        }
      }
    }
  }

  // Also check child items that reference components via grid
  // The layout is a flat array — items with type "widget" have a component name
  for (const item of layout) {
    if (
      item.component &&
      item.component !== "LayoutGridContainer" &&
      item.component !== "Container"
    ) {
      components.add(item.component);
    }
  }

  // Remove container components — these are layout containers, not widgets
  components.delete("LayoutGridContainer");
  components.delete("Container");

  return Array.from(components);
}

/**
 * Extract event wiring from a workspace layout.
 * Reads the `listeners` property from layout items and converts
 * them to the dashboard config eventWiring format.
 *
 * LayoutModel.listeners format:
 *   { "eventName": { "sourceWidget": "handlerName" } }
 *   or
 *   { "eventName": "SourceWidget" }
 *
 * Dashboard config eventWiring format:
 *   [{ source: { widget, event }, target: { widget, handler } }]
 *
 * @param {Array} layout - The workspace layout array
 * @returns {Array} Event wiring array
 */
function extractEventWiring(layout) {
  const wiring = [];

  for (const item of layout) {
    if (!item.listeners || typeof item.listeners !== "object") continue;

    const targetWidget = item.component;
    if (!targetWidget) continue;

    for (const [eventName, listenerConfig] of Object.entries(item.listeners)) {
      if (typeof listenerConfig === "string") {
        // Simple format: "SourceWidget"
        wiring.push({
          source: { widget: listenerConfig, event: eventName },
          target: { widget: targetWidget, handler: eventName },
        });
      } else if (
        typeof listenerConfig === "object" &&
        listenerConfig !== null
      ) {
        // Object format: { "SourceWidget": "handlerName" }
        for (const [sourceKey, handlerValue] of Object.entries(
          listenerConfig,
        )) {
          const parts = sourceKey.split(".");
          const sourceWidget = parts[0];

          let handler = eventName;
          if (typeof handlerValue === "string") {
            handler = handlerValue;
          }

          wiring.push({
            source: { widget: sourceWidget, event: eventName },
            target: { widget: targetWidget, handler },
          });
        }
      }
    }
  }

  return wiring;
}

/**
 * Build the widget dependencies array from component names and
 * installed widget metadata.
 *
 * @param {string[]} componentNames - Widget component names from layout
 * @param {Object} widgetRegistry - WidgetRegistry instance (optional, needs getWidgets())
 * @param {Object} componentConfigs - Map of component name → .dash.js config (optional, for built-in widgets)
 * @returns {Array} Widget dependency objects for the dashboard config
 */
function buildWidgetDependencies(
  componentNames,
  widgetRegistry = null,
  componentConfigs = null,
) {
  const widgets = [];
  const seen = new Set();

  for (const name of componentNames) {
    if (seen.has(name)) continue;
    seen.add(name);

    let scope = "";
    let packageName = "";
    let widgetName = name;
    let version = "*";
    let author = "";

    // Check if name is already a scoped ID (scope.packageName.widgetName)
    const parts = name.split(".");
    if (parts.length === 3) {
      scope = parts[0];
      packageName = parts[1];
      widgetName = parts[2];
    }

    // Try to resolve from widget registry
    if (widgetRegistry) {
      const installedWidgets = widgetRegistry.getWidgets();
      for (const w of installedWidgets) {
        if (w.componentNames && w.componentNames.includes(name)) {
          if (!scope && w.scope) scope = w.scope;
          if (!packageName || packageName === name) packageName = w.name || "";
          version = w.version || "*";
          author =
            typeof w.author === "string" ? w.author : w.author?.name || "";
          break;
        }
      }
    }

    // Fallback: resolve from component configs (built-in widgets)
    if (componentConfigs && componentConfigs[name]) {
      const config = componentConfigs[name];
      if (!scope && config.scope) scope = config.scope;
      if ((!packageName || packageName === name) && config.packageName)
        packageName = config.packageName;
      if (config.id && !scope) {
        const idParts = config.id.split(".");
        if (idParts.length === 3) {
          scope = idParts[0];
          packageName = idParts[1];
        }
      }
    }

    // Final fallback: if widget name looks like a scoped id, parse it
    if (!packageName || packageName === name) {
      const idParts = name.split(".");
      if (idParts.length === 3) {
        scope = scope || idParts[0];
        packageName = idParts[1];
        widgetName = idParts[2];
      }
    }

    const id =
      scope && packageName && widgetName
        ? `${scope}.${packageName}.${widgetName}`
        : packageName
          ? `${packageName}.${widgetName}`
          : widgetName;

    widgets.push({
      id,
      scope: scope || "",
      packageName: packageName || widgetName,
      widgetName,
      package: packageName || widgetName,
      version,
      required: true,
      author: author || "",
    });
  }

  return widgets;
}

/**
 * Aggregate provider requirements from installed widget configs.
 *
 * @param {string[]} componentNames - Widget component names from layout
 * @param {Object} widgetRegistry - WidgetRegistry instance (optional, needs getWidgets())
 * @returns {Array} Provider requirement objects for the dashboard config
 */
function buildProviderRequirements(componentNames, widgetRegistry = null) {
  const providerMap = new Map();

  if (!widgetRegistry) return [];

  const installedWidgets = widgetRegistry.getWidgets();

  for (const name of componentNames) {
    for (const w of installedWidgets) {
      if (w.providers && w.componentNames && w.componentNames.includes(name)) {
        for (const p of w.providers) {
          const key = `${p.type}:${p.providerClass}`;
          if (!providerMap.has(key)) {
            providerMap.set(key, {
              type: p.type,
              providerClass: p.providerClass,
              required: p.required !== false,
              usedBy: [],
            });
          }
          const entry = providerMap.get(key);
          if (!entry.usedBy.includes(name)) {
            entry.usedBy.push(name);
          }
        }
      }
    }
  }

  return Array.from(providerMap.values());
}

/**
 * Apply event wiring from a dashboard config to a workspace layout.
 * Converts the dashboard config `eventWiring` array back into
 * LayoutModel `listeners` format on the appropriate layout items.
 *
 * This is the reverse of `extractEventWiring`.
 *
 * Dashboard config eventWiring format:
 *   [{ source: { widget, event }, target: { widget, handler } }]
 *
 * LayoutModel.listeners format:
 *   { "eventName": { "SourceWidget": "handlerName" } }
 *
 * @param {Array} layout - The workspace layout array (mutated in place)
 * @param {Array} eventWiring - Event wiring array from dashboard config
 * @returns {Array} The modified layout array
 */
function applyEventWiringToLayout(layout, eventWiring) {
  if (!eventWiring || !eventWiring.length) return layout;

  // Build a map of target widget -> listeners object
  // Each wiring entry: { source: { widget, event }, target: { widget, handler } }
  const listenersByTarget = new Map();

  for (const wire of eventWiring) {
    const targetWidget = wire.target?.widget;
    const sourceWidget = wire.source?.widget;
    const eventName = wire.source?.event;
    const handler = wire.target?.handler;

    if (!targetWidget || !sourceWidget || !eventName) continue;

    if (!listenersByTarget.has(targetWidget)) {
      listenersByTarget.set(targetWidget, {});
    }

    const listeners = listenersByTarget.get(targetWidget);

    if (!listeners[eventName]) {
      listeners[eventName] = {};
    }

    // Use handler value, defaulting to the event name
    listeners[eventName][sourceWidget] = handler || eventName;
  }

  // Apply listeners to matching layout items
  for (const item of layout) {
    if (!item.component) continue;

    const listeners = listenersByTarget.get(item.component);
    if (listeners) {
      // Merge with any existing listeners
      item.listeners = { ...(item.listeners || {}), ...listeners };
    }
  }

  return layout;
}

/**
 * Check compatibility of a dashboard config against installed widgets.
 * Returns a per-widget status report indicating what's installed,
 * what needs to be installed, and what's unavailable.
 *
 * @param {Array} dashboardWidgets - Widget deps from dashboard config (widgets array)
 * @param {Array} installedWidgets - Currently installed widget metadata (from widgetRegistry.getWidgets())
 * @param {Array} registryPackages - Available packages from registry index (optional)
 * @returns {Object} Compatibility report
 */
function checkDashboardCompatibility(
  dashboardWidgets = [],
  installedWidgets = [],
  registryPackages = [],
) {
  // Build lookup maps using composite keys (scope.packageName.componentName)
  const installedByKey = new Map();
  const installedByName = new Map();
  for (const w of installedWidgets) {
    if (w.name) {
      installedByName.set(w.name, w);
    }
    if (w.scope && w.name && w.componentNames) {
      for (const cn of w.componentNames) {
        installedByKey.set(`${w.scope}.${w.name}.${cn}`, w);
      }
    }
  }

  const registryByName = new Map();
  for (const p of registryPackages) {
    if (p.name) {
      registryByName.set(p.name, p);
    }
  }

  const widgets = {};
  let installedCount = 0;
  let toInstallCount = 0;
  let unavailableCount = 0;
  let hasUnavailableRequired = false;

  for (const dep of dashboardWidgets) {
    // Build composite key for scoped matching
    const key =
      dep.scope && dep.packageName && dep.widgetName
        ? `${dep.scope}.${dep.packageName}.${dep.widgetName}`
        : null;
    const packageName = dep.package || dep.packageName || "";
    const required = dep.required !== false;

    // Try composite key first, then fall back to package name
    const installed = key
      ? installedByKey.get(key) || installedByName.get(packageName)
      : installedByName.get(packageName);

    // Use the dep's id or key for the status map
    const statusKey = dep.id || key || packageName;

    if (installed) {
      installedCount++;
      widgets[statusKey] = "installed";
    } else if (registryByName.has(packageName)) {
      toInstallCount++;
      widgets[statusKey] = "available";
    } else {
      unavailableCount++;
      widgets[statusKey] = "unavailable";
      if (required) {
        hasUnavailableRequired = true;
      }
    }
  }

  return {
    compatible: !hasUnavailableRequired,
    summary: {
      total: dashboardWidgets.length,
      installed: installedCount,
      toInstall: toInstallCount,
      unavailable: unavailableCount,
    },
    widgets,
  };
}

const { toDisplayColor } = require("../../src/utils/colorUtils");

/**
 * Generate a registry manifest from a dashboard config.
 * Converts the internal .dashboard.json format into the registry
 * manifest.json format used by dash-registry.
 *
 * @param {Object} dashboardConfig - Validated dashboard config object
 * @param {Object} options - Publishing options
 * @param {string} options.githubUser - GitHub username / org for the package scope
 * @param {string} options.category - Registry category (default: "general")
 * @param {string} options.repository - Repository URL (optional)
 * @param {string} options.appOrigin - Originating app package name (optional)
 * @returns {Object} Registry manifest object
 */
function generateRegistryManifest(dashboardConfig, options = {}) {
  const name = (dashboardConfig.name || "dashboard")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  const githubUser = options.githubUser || "";
  const version = "1.0.0";

  const manifest = {
    githubUser,
    name,
    displayName: dashboardConfig.name || "Dashboard",
    author: dashboardConfig.author?.name || "",
    description: dashboardConfig.description || "",
    version,
    type: "dashboard",
    category: options.category || "general",
    tags: dashboardConfig.tags || [],
    icon: dashboardConfig.icon || "grip",
    downloadUrl: `https://github.com/${githubUser}/dash-registry/releases/download/${githubUser}--${name}--v{version}/dashboard-${name}-v{version}.zip`,
    repository: options.repository || "",
    publishedAt: new Date().toISOString(),
    widgets: (dashboardConfig.widgets || []).map((w) => ({
      id: w.id,
      scope: w.scope || "",
      packageName: w.packageName || w.package || "",
      widgetName: w.widgetName || (w.id ? w.id.split(".").pop() : w.package),
      name: w.id ? w.id.split(".").pop() : w.package,
      package: w.package,
      version: w.version || "*",
      required: w.required !== false,
      author: w.author || "",
    })),
    providers: dashboardConfig.providers || [],
    eventWiring: dashboardConfig.eventWiring || [],
  };

  if (options.appOrigin || dashboardConfig.appOrigin) {
    manifest.appOrigin = options.appOrigin || dashboardConfig.appOrigin;
  }

  // Include theme metadata if dashboard bundles a theme
  if (dashboardConfig.theme) {
    manifest.theme = {
      key: dashboardConfig.theme.key || "",
      name: dashboardConfig.theme.data?.name || dashboardConfig.theme.key || "",
    };
    if (dashboardConfig.theme.registryPackage) {
      manifest.theme.registryPackage = dashboardConfig.theme.registryPackage;
    }
    // Extract color values for display (convert Tailwind names to hex)
    const td = dashboardConfig.theme.data;
    if (td) {
      const colors = {};
      if (td.primary || td.colors?.primary)
        colors.primary = toDisplayColor(td.primary || td.colors.primary);
      if (td.secondary || td.colors?.secondary)
        colors.secondary = toDisplayColor(td.secondary || td.colors.secondary);
      if (td.tertiary || td.colors?.tertiary)
        colors.tertiary = toDisplayColor(td.tertiary || td.colors.tertiary);
      if (Object.keys(colors).length > 0) {
        manifest.theme.colors = colors;
      }
    }
  }

  return manifest;
}

/**
 * Build a structured preview object from a dashboard registry package
 * or dashboard config. Provides all data needed for a rich preview UI.
 *
 * @param {Object} source - Registry package manifest or dashboard config
 * @returns {Object} Structured preview with metadata, widgets, wiring, providers
 */
function buildDashboardPreview(source) {
  const preview = {
    name: source.displayName || source.name || "Dashboard",
    description: source.description || "",
    author:
      typeof source.author === "object"
        ? source.author.name || ""
        : source.author || "",
    authorId: typeof source.author === "object" ? source.author.id || "" : "",
    version: source.version || "",
    icon: source.icon || "grip",
    tags: source.tags || [],
    screenshots: source.screenshots || [],
    publishedAt: source.publishedAt || null,
    category: source.category || "general",
    widgets: (source.widgets || []).map((w) => ({
      name: w.name || w.id || w.package || "",
      package: w.package || "",
      version: w.version || "*",
      required: w.required !== false,
      author: w.author || "",
    })),
    eventWiring: (source.eventWiring || []).map((wire) => ({
      raw: wire,
      summary: `${wire.source?.widget || "?"}.${wire.source?.event || "?"} → ${wire.target?.widget || "?"}.${wire.target?.handler || wire.source?.event || "?"}`,
    })),
    providers: (source.providers || []).map((p) => ({
      type: p.type || "",
      providerClass: p.providerClass || "",
      required: p.required !== false,
      usedBy: p.usedBy || [],
    })),
    appOrigin: source.appOrigin || null,
    summary: {
      widgetCount: (source.widgets || []).length,
      eventCount: (source.eventWiring || []).length,
      providerCount: (source.providers || []).length,
      requiredWidgets: (source.widgets || []).filter(
        (w) => w.required !== false,
      ).length,
      optionalWidgets: (source.widgets || []).filter(
        (w) => w.required === false,
      ).length,
    },
  };

  return preview;
}

/**
 * Check installed dashboards for available updates in the registry.
 *
 * Compares the `_dashboardConfig.installedVersion` of each workspace
 * against the current version in the registry.
 *
 * @param {Array} workspaces - All workspaces from workspaces.json
 * @param {Array} registryPackages - Packages from registry index
 * @returns {Array} Update records with workspace info and version comparison
 */
function checkDashboardUpdates(workspaces = [], registryPackages = []) {
  const registryByName = new Map();
  for (const pkg of registryPackages) {
    if (pkg.name && (pkg.type || "widget") === "dashboard") {
      registryByName.set(pkg.name, pkg);
    }
  }

  const updates = [];

  for (const ws of workspaces) {
    const config = ws._dashboardConfig;
    if (!config || !config.registryPackage) continue;

    const registryPkg = registryByName.get(config.registryPackage);
    if (!registryPkg) continue;

    const installedVersion = config.installedVersion || "0.0.0";
    const latestVersion = registryPkg.version || "0.0.0";

    if (installedVersion !== latestVersion) {
      updates.push({
        workspaceId: ws.id,
        workspaceName: ws.name || ws.label || "",
        registryPackage: config.registryPackage,
        installedVersion,
        latestVersion,
        importedAt: config.importedAt || null,
      });
    }
  }

  return updates;
}

/**
 * Build a provider setup manifest for a dashboard's requirements.
 * Compares required providers against configured providers,
 * returning status (configured/needs-setup) for each.
 *
 * @param {Array} requiredProviders - Provider requirements from dashboard config
 * @param {Array} configuredProviders - User's configured providers (from providerController)
 * @returns {Object} Setup manifest with per-provider status
 */
function buildProviderSetupManifest(
  requiredProviders = [],
  configuredProviders = [],
) {
  const configuredByType = new Map();
  for (const p of configuredProviders) {
    const key = p.type || p.name || "";
    if (key) {
      configuredByType.set(key.toLowerCase(), p);
    }
  }

  const providers = requiredProviders.map((req) => {
    const typeKey = (req.type || "").toLowerCase();
    const configured = configuredByType.get(typeKey);

    return {
      type: req.type || "",
      providerClass: req.providerClass || "",
      required: req.required !== false,
      usedBy: req.usedBy || [],
      status: configured ? "configured" : "needs-setup",
      configuredProvider: configured || null,
    };
  });

  const configuredCount = providers.filter(
    (p) => p.status === "configured",
  ).length;
  const needsSetupCount = providers.filter(
    (p) => p.status === "needs-setup",
  ).length;

  return {
    allConfigured: needsSetupCount === 0,
    summary: {
      total: providers.length,
      configured: configuredCount,
      needsSetup: needsSetupCount,
    },
    providers,
  };
}

/**
 * Check API compatibility of a package against the app's capabilities.
 * Extracts providers with providerClass "api" and checks whether
 * each required API namespace is present in the app's capability set.
 *
 * @param {Array} providers - Provider requirements (from widget config or package manifest)
 * @param {string[]} appCapabilities - API namespaces the app exposes (e.g., Object.keys(window.mainApi))
 * @returns {Object} Compatibility report
 */
function checkApiCompatibility(providers = [], appCapabilities = []) {
  const capSet = new Set(appCapabilities.map((c) => c.toLowerCase()));

  const apiProviders = providers.filter((p) => p.providerClass === "api");

  if (apiProviders.length === 0) {
    return { compatible: true, missingApis: [], requiredApis: [] };
  }

  const requiredApis = apiProviders
    .filter((p) => p.required !== false)
    .map((p) => p.type);
  const missingApis = requiredApis.filter(
    (api) => !capSet.has(api.toLowerCase()),
  );

  return {
    compatible: missingApis.length === 0,
    missingApis,
    requiredApis,
  };
}

module.exports = {
  collectComponentNames,
  extractEventWiring,
  buildWidgetDependencies,
  buildProviderRequirements,
  applyEventWiringToLayout,
  checkDashboardCompatibility,
  generateRegistryManifest,
  buildDashboardPreview,
  checkDashboardUpdates,
  buildProviderSetupManifest,
  checkApiCompatibility,
};
