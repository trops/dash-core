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
 * @returns {Array} Widget dependency objects for the dashboard config
 */
function buildWidgetDependencies(componentNames, widgetRegistry = null) {
  const widgets = [];
  const seen = new Set();

  for (const name of componentNames) {
    if (seen.has(name)) continue;
    seen.add(name);

    let packageName = "";
    let version = "*";
    let author = "";

    // Try to resolve from widget registry
    if (widgetRegistry) {
      const installedWidgets = widgetRegistry.getWidgets();
      for (const w of installedWidgets) {
        if (w.componentNames && w.componentNames.includes(name)) {
          packageName = w.name || "";
          version = w.version || "*";
          author =
            typeof w.author === "string" ? w.author : w.author?.name || "";
          break;
        }
      }
    }

    widgets.push({
      id: packageName ? `${packageName}.${name}` : name,
      package: packageName || name,
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
  const installedByName = new Map();
  for (const w of installedWidgets) {
    if (w.name) {
      installedByName.set(w.name, w);
    }
  }

  const registryByName = new Map();
  for (const p of registryPackages) {
    if (p.name) {
      registryByName.set(p.name, p);
    }
  }

  const widgets = [];
  let installedCount = 0;
  let toInstallCount = 0;
  let unavailableCount = 0;

  for (const dep of dashboardWidgets) {
    const packageName = dep.package;
    const required = dep.required !== false;
    const installed = installedByName.get(packageName);

    if (installed) {
      installedCount++;
      widgets.push({
        package: packageName,
        required,
        status: "installed",
        installedVersion: installed.version || null,
        requiredVersion: dep.version || "*",
      });
    } else if (registryByName.has(packageName)) {
      toInstallCount++;
      const registryPkg = registryByName.get(packageName);
      widgets.push({
        package: packageName,
        required,
        status: "to-install",
        availableVersion: registryPkg.version || null,
        requiredVersion: dep.version || "*",
      });
    } else {
      unavailableCount++;
      widgets.push({
        package: packageName,
        required,
        status: "unavailable",
        requiredVersion: dep.version || "*",
      });
    }
  }

  const hasUnavailableRequired = widgets.some(
    (w) => w.status === "unavailable" && w.required,
  );

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
 * @returns {Object} Registry manifest object
 */
function generateRegistryManifest(dashboardConfig, options = {}) {
  const name = (dashboardConfig.name || "dashboard")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  const githubUser = options.githubUser || "";
  const version = dashboardConfig.workspace?.version
    ? `1.0.${dashboardConfig.workspace.version}`
    : "1.0.0";

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
    downloadUrl: `https://github.com/${githubUser}/dash-registry/releases/download/${githubUser}--${name}--v{version}/${name}-v{version}.zip`,
    repository: options.repository || "",
    publishedAt: new Date().toISOString(),
    widgets: (dashboardConfig.widgets || []).map((w) => ({
      id: w.id,
      name: w.id ? w.id.split(".").pop() : w.package,
      package: w.package,
      version: w.version || "*",
      required: w.required !== false,
      author: w.author || "",
    })),
    providers: dashboardConfig.providers || [],
    eventWiring: dashboardConfig.eventWiring || [],
  };

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
    author: typeof source.author === "object"
      ? source.author.name || ""
      : source.author || "",
    authorId: typeof source.author === "object"
      ? source.author.id || ""
      : "",
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
    summary: {
      widgetCount: (source.widgets || []).length,
      eventCount: (source.eventWiring || []).length,
      providerCount: (source.providers || []).length,
      requiredWidgets: (source.widgets || []).filter((w) => w.required !== false).length,
      optionalWidgets: (source.widgets || []).filter((w) => w.required === false).length,
    },
  };

  return preview;
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
};
