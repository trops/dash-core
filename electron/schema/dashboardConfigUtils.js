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
 * Strip a `<scope>/` or `@<scope>/` prefix from a potentially-scoped
 * package name. Widgets installed from the registry carry
 * `w.name = "@scope/pkg"` alongside `w.scope = "scope"`; downstream
 * code builds `${scope}/${packageName}` for display and for registry
 * keys, so `packageName` must be the bare name or the scope doubles
 * (e.g. `@trops/@ai-built/pipeline` instead of `@trops/pipeline`).
 *
 * @param {string} fullName Potentially scoped (e.g. "@ai-built/pipeline" or "ai-built/pipeline")
 * @param {string} scope    Scope to strip (e.g. "ai-built" or "@ai-built")
 * @returns {string} The bare package name
 */
function stripScopePrefix(fullName, scope) {
  if (!fullName) return fullName || "";
  if (!scope) return fullName;
  const bareScope = scope.startsWith("@") ? scope.slice(1) : scope;
  const variants = [`@${bareScope}/`, `${bareScope}/`];
  for (const v of variants) {
    if (fullName.startsWith(v)) return fullName.slice(v.length);
  }
  return fullName;
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
  componentNamesOrRefs,
  widgetRegistry = null,
  componentConfigs = null,
) {
  const widgets = [];
  const seen = new Set();

  // Accept both the legacy string-array shape and the new
  // `{component, packageId}` ref shape. Refs carry the exact source
  // package recorded at widget-add time — no guessing needed. Legacy
  // layout items that predate packageId pass `packageId: null` and
  // still fall through to the registry fallback.
  const refs = (componentNamesOrRefs || []).map((entry) =>
    typeof entry === "string"
      ? { component: entry, packageId: null }
      : { component: entry.component, packageId: entry.packageId || null },
  );

  // Pre-index the installed widgets by packageId for O(1) lookup when
  // refs specify one. The secondary map by component name is used for
  // the legacy/fallback path where packageId isn't known. When a
  // shared component appears without a packageId, rank candidates by
  // how many of THIS dashboard's widgets they provide so the
  // best-fit bundle wins over a single-widget package that happens
  // to share the name.
  const installedWidgets = widgetRegistry ? widgetRegistry.getWidgets() : [];
  const byPackageId = new Map();
  const byComponentName = new Map();
  for (const w of installedWidgets) {
    // packageId on the registry entry is usually `@scope/name`; also
    // index by the bare `scope/name` form since callers occasionally
    // strip the @.
    const ids = new Set();
    if (w.packageId) ids.add(w.packageId);
    if (w.name) ids.add(w.name);
    if (w.scope && w.name) {
      const bareScope = String(w.scope).replace(/^@/, "");
      const bareName = stripScopePrefix(w.name, w.scope);
      ids.add(`@${bareScope}/${bareName}`);
      ids.add(`${bareScope}/${bareName}`);
    }
    for (const id of ids) {
      if (id && !byPackageId.has(id)) byPackageId.set(id, w);
    }
    if (Array.isArray(w.componentNames)) {
      for (const cn of w.componentNames) {
        if (!byComponentName.has(cn)) byComponentName.set(cn, []);
        byComponentName.get(cn).push(w);
      }
    }
  }

  const requestedComponentSet = new Set(refs.map((r) => r.component));
  const rankCandidates = (candidates) =>
    [...candidates].sort((a, b) => {
      const aMatches = (a.componentNames || []).filter((n) =>
        requestedComponentSet.has(n),
      ).length;
      const bMatches = (b.componentNames || []).filter((n) =>
        requestedComponentSet.has(n),
      ).length;
      if (aMatches !== bMatches) return bMatches - aMatches;
      return (b.componentNames?.length || 0) - (a.componentNames?.length || 0);
    });

  const applyRegistryMatch = (w, name, resolved) => {
    if (!resolved.scope && w.scope) resolved.scope = w.scope;
    if (!resolved.packageName || resolved.packageName === name) {
      resolved.packageName =
        stripScopePrefix(w.name, w.scope || resolved.scope) || "";
    }
    resolved.version = w.version || "*";
    resolved.author =
      typeof w.author === "string" ? w.author : w.author?.name || "";
  };

  for (const ref of refs) {
    const name = ref.component;
    const dedupeKey = `${name}|${ref.packageId || ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

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

    const resolved = { scope, packageName, version, author };

    // Authoritative path: the layout item told us exactly which
    // package this widget came from. Look it up directly. No guessing.
    let matched = false;
    if (ref.packageId) {
      const w = byPackageId.get(ref.packageId);
      if (w) {
        applyRegistryMatch(w, name, resolved);
        matched = true;
      }
    }

    // Fallback path: no packageId on the layout item (legacy data).
    // Rank candidates by how much of this dashboard they cover so
    // shared-component bundles beat stray singleton packages.
    if (!matched) {
      const candidates = byComponentName.get(name);
      if (Array.isArray(candidates) && candidates.length > 0) {
        const ranked = rankCandidates(candidates);
        applyRegistryMatch(ranked[0], name, resolved);
      }
    }
    scope = resolved.scope;
    packageName = resolved.packageName;
    version = resolved.version;
    author = resolved.author;

    // Fallback: resolve from component configs (built-in widgets)
    if (componentConfigs && componentConfigs[name]) {
      const config = componentConfigs[name];
      if (!scope && config.scope) scope = config.scope;
      if ((!packageName || packageName === name) && config.packageName) {
        packageName = stripScopePrefix(config.packageName, scope);
      }
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
 * @param {"public"|"private"} options.visibility - Initial visibility (default: "public")
 * @returns {Object} Registry manifest object
 */
function generateRegistryManifest(dashboardConfig, options = {}) {
  const name = (dashboardConfig.name || "dashboard")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  const githubUser = options.githubUser || "";
  // Prefer an explicitly-passed version (caller resolved it already,
  // e.g. via resolveNextVersion + bump). Fall back to the dashboard's
  // own version, then a 1.0.0 baseline. The previous hardcoded
  // "1.0.0" meant every republish looked identical to the registry;
  // latestVersion never advanced, so downstream update-check never
  // saw a diff and no notification fired.
  const version = options.version || dashboardConfig.version || "1.0.0";
  const visibility = options.visibility === "private" ? "private" : "public";

  const manifest = {
    githubUser,
    name,
    displayName: dashboardConfig.name || "Dashboard",
    author: dashboardConfig.author?.name || "",
    description: dashboardConfig.description || "",
    version,
    visibility,
    type: "dashboard",
    category: options.category || "general",
    tags: dashboardConfig.tags || [],
    icon: dashboardConfig.icon || "grip",
    downloadUrl: `https://github.com/${githubUser}/dash-registry/releases/download/${githubUser}--${name}--v{version}/dashboard-${name}-v{version}.zip`,
    repository: options.repository || "",
    publishedAt: new Date().toISOString(),
    widgets: (dashboardConfig.widgets || []).map((w) => {
      // Remap local scopes (e.g. `@ai-built/…` for AI-generated widgets)
      // to the caller's published scope. Local conventions are private to
      // the publisher's machine — installers can only resolve packages
      // under the scope they were actually published as.
      const remappedScope =
        options.callerScope && w.scope && w.scope !== options.callerScope
          ? options.callerScope
          : w.scope || "";
      // Packaged id — the scoped "@<scope>/<packageName>" string that
      // the install flow looks up in the registry. Build this from the
      // REMAPPED scope + bare packageName so installers resolve against
      // the scope the widget was actually published as, not the local
      // `@ai-built` convention. Stripping the scope prefix from a
      // potentially-scoped packageName keeps the result canonical.
      const bareName = stripScopePrefix(
        w.packageName || w.package || "",
        remappedScope || w.scope,
      );
      const scopedPackageId = remappedScope
        ? `@${remappedScope.replace(/^@/, "")}/${bareName}`
        : bareName;
      return {
        id: w.id,
        scope: remappedScope,
        packageName: bareName,
        widgetName: w.widgetName || (w.id ? w.id.split(".").pop() : w.package),
        name: w.id ? w.id.split(".").pop() : w.package,
        // `package` is consumed by the install flow as the registry
        // package id (see installDashboardFromRegistry in
        // dashboardConfigController.js). Must carry the remapped
        // scope, otherwise installers look up an @ai-built/... id that
        // only exists on the publisher's machine.
        package: scopedPackageId,
        version: w.version || "*",
        required: w.required !== false,
        author: w.author || "",
      };
    }),
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
  // Index the registry by canonical `@scope/name` so the lookup
  // survives installs that capture scope differently from the
  // registry's raw `name` field. The previous map was keyed by bare
  // `pkg.name`, which misses anytime the installed config recorded
  // `@scope/name` (our new publish flow writes that) or when two
  // users publish the same bare name. Key both forms for safety.
  const registryByKey = new Map();
  const asKey = (scope, name) => {
    if (!name) return null;
    if (!scope) return name;
    const bareScope = String(scope).replace(/^@/, "");
    return `@${bareScope}/${name}`;
  };
  for (const pkg of registryPackages) {
    if (!pkg.name) continue;
    if ((pkg.type || "widget") !== "dashboard") continue;
    const scoped = asKey(pkg.scope, pkg.name);
    if (scoped) registryByKey.set(scoped, pkg);
    // Back-compat: also store under bare name so installed configs
    // that predate the scope-aware write continue to match.
    registryByKey.set(pkg.name, pkg);
  }

  const updates = [];

  for (const ws of workspaces) {
    const config = ws._dashboardConfig;
    if (!config || !config.registryPackage) continue;

    // Lookup chain: try the scoped form first, fall back to bare. The
    // installed config may record either. Scope is stored on the
    // config by the install flow (or set here by the publish persist
    // step we just added).
    const installedScope =
      config.registryScope ||
      (config.registryPackage.startsWith("@")
        ? config.registryPackage.slice(1).split("/")[0]
        : null);
    const installedName = config.registryPackage.includes("/")
      ? config.registryPackage.split("/").pop()
      : config.registryPackage;
    const scopedKey = asKey(installedScope, installedName);

    const registryPkg =
      (scopedKey && registryByKey.get(scopedKey)) ||
      registryByKey.get(config.registryPackage) ||
      registryByKey.get(installedName);
    if (!registryPkg) continue;

    const installedVersion = config.installedVersion || "0.0.0";
    const latestVersion = registryPkg.version || "0.0.0";

    if (installedVersion !== latestVersion) {
      updates.push({
        workspaceId: ws.id,
        workspaceName: ws.name || ws.label || "",
        registryPackage: config.registryPackage,
        registryScope: installedScope,
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

/**
 * Collect unique component names across a workspace's main layout, every
 * page layout, and the sidebar layout. Matches what a user actually sees
 * on screen — `collectComponentNames` only walks a single layout array
 * and misses widgets placed on non-active pages or in the sidebar.
 *
 * @param {Object} workspace - Workspace object ({layout, pages, sidebarLayout})
 * @returns {string[]} Unique component names
 */
function collectComponentNamesFromWorkspace(workspace) {
  const names = new Set();
  const pushAll = (layout) => {
    if (!Array.isArray(layout)) return;
    for (const n of collectComponentNames(layout)) names.add(n);
  };

  pushAll(workspace?.layout);
  pushAll(workspace?.sidebarLayout);
  if (Array.isArray(workspace?.pages)) {
    for (const page of workspace.pages) pushAll(page?.layout);
  }

  return Array.from(names);
}

/**
 * Walk the workspace and return one dependency ref per unique
 * (component, packageId) pair. `packageId` is the exact source
 * package id (e.g. `"@ai-built/pipeline"`) that was recorded on the
 * layout item when the widget was added. Items that predate the
 * packageId field carry `packageId: null`, and the caller falls back
 * to registry-based resolution for those.
 *
 * Unlike `collectComponentNamesFromWorkspace`, this walk is the
 * authoritative source for publish-time attribution — the publish
 * flow no longer needs to guess which installed package provides a
 * shared component when the layout item already says so.
 *
 * @param {Object} workspace - Workspace (layout/pages/sidebarLayout)
 * @returns {Array<{component: string, packageId: string|null}>}
 */
function collectDependencyRefsFromWorkspace(workspace) {
  const byKey = new Map();
  const walk = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const component = item.component;
      if (
        component &&
        component !== "Container" &&
        component !== "LayoutGridContainer"
      ) {
        const packageId = item.packageId || null;
        const key = `${component}|${packageId || ""}`;
        if (!byKey.has(key)) byKey.set(key, { component, packageId });
      }
      // Grid cells may carry a string component name (new widget
      // placed directly in a cell) with no corresponding layout item
      // yet — capture it without a packageId so the fallback path
      // still picks it up.
      if (item.grid && typeof item.grid === "object") {
        for (const [cellKey, cell] of Object.entries(item.grid)) {
          if (!/^\d+\.\d+$/.test(cellKey)) continue;
          if (cell && typeof cell.component === "string") {
            const cellKey2 = `${cell.component}|`;
            if (!byKey.has(cellKey2)) {
              byKey.set(cellKey2, {
                component: cell.component,
                packageId: null,
              });
            }
          }
        }
      }
      if (Array.isArray(item.items)) walk(item.items);
      if (Array.isArray(item.layout)) walk(item.layout);
    }
  };
  walk(workspace?.layout);
  walk(workspace?.sidebarLayout);
  if (Array.isArray(workspace?.pages)) {
    for (const page of workspace.pages) walk(page?.layout);
  }
  return Array.from(byKey.values());
}

/**
 * Extract event wiring across a workspace's main layout, every page
 * layout, and the sidebar layout. Mirrors collectComponentNamesFromWorkspace
 * — the single-layout `extractEventWiring` misses widgets on non-active
 * pages or in the sidebar.
 *
 * @param {Object} workspace - Workspace object
 * @returns {Array} Event wiring array
 */
function extractEventWiringFromWorkspace(workspace) {
  const wiring = [];
  const pushAll = (layout) => {
    if (!Array.isArray(layout)) return;
    for (const entry of extractEventWiring(layout)) wiring.push(entry);
  };

  pushAll(workspace?.layout);
  pushAll(workspace?.sidebarLayout);
  if (Array.isArray(workspace?.pages)) {
    for (const page of workspace.pages) pushAll(page?.layout);
  }

  return wiring;
}

/**
 * Strip publisher-specific personalization (userPrefs + selectedProviders)
 * from every widget instance in a layout-ish structure. Used by the
 * dashboard publish flow so the installer starts with the widget's
 * own defaultValue on every field instead of inheriting the
 * publisher's absolute paths, region tags, credentials, etc.
 *
 * Walks the standard layout shapes that forEachWidget handles:
 *   - top-level `layout` arrays
 *   - `workspace.pages[*].layout`
 *   - `workspace.sidebarLayout`
 *   - `LayoutGridContainer` children stored on `item.items` / `item.layout`
 *
 * Returns a deep copy — never mutates the input workspace.
 *
 * Title-ish defaults (widget.name) are intentionally preserved — they
 * are part of the dashboard template, not personal data. Anything else
 * under userPrefs is dropped; the installer's widget re-reads the
 * `defaultValue` declared in the component's `.dash.js`.
 */
function stripPersonalizationFromWorkspace(workspace) {
  if (!workspace) return workspace;
  const cleanItem = (item) => {
    if (!item || typeof item !== "object") return item;
    // Preserve the layout position + children, but blank out the
    // user-set config values that are tied to the publisher's machine.
    const cleaned = { ...item };
    if ("userPrefs" in cleaned) delete cleaned.userPrefs;
    if ("selectedProviders" in cleaned) delete cleaned.selectedProviders;
    if (Array.isArray(cleaned.items)) {
      cleaned.items = cleaned.items.map(cleanItem);
    }
    if (Array.isArray(cleaned.layout)) {
      cleaned.layout = cleaned.layout.map(cleanItem);
    }
    return cleaned;
  };
  const cleaned = { ...workspace };
  if (Array.isArray(cleaned.layout))
    cleaned.layout = cleaned.layout.map(cleanItem);
  if (Array.isArray(cleaned.sidebarLayout))
    cleaned.sidebarLayout = cleaned.sidebarLayout.map(cleanItem);
  if (Array.isArray(cleaned.pages)) {
    cleaned.pages = cleaned.pages.map((page) =>
      page
        ? {
            ...page,
            ...(Array.isArray(page.layout)
              ? { layout: page.layout.map(cleanItem) }
              : {}),
          }
        : page,
    );
  }
  // Workspace-level selectedProviders map lives at the top level for
  // some older workspaces; drop it too so the installer doesn't get
  // bindings to provider names that don't exist on their machine.
  if ("selectedProviders" in cleaned) delete cleaned.selectedProviders;
  return cleaned;
}

/**
 * Remap each layout item's `packageId` from a local-only scope (e.g.
 * `@ai-built/foo`) to the caller's published scope (`@<callerScope>/foo`)
 * so the installer's ComponentManager — which registers widgets under
 * the published scope — can look them up.
 *
 * Mirrors the scope-remap that `generateRegistryManifest` already does
 * for the dashboard's widget DEPENDENCIES list. Without this, the deps
 * list is correct (`@callerScope/foo`) but the per-instance layout
 * items still say `packageId: "@ai-built/foo"` — every Dependencies
 * tab + publish-flow attribution on the installer's machine misses.
 *
 * Returns a deep copy. Idempotent: items already under the caller
 * scope (or any non-local scope) pass through untouched.
 *
 * @param {Object} workspace
 * @param {string} callerScope - Publisher's registry username (e.g. "trops")
 * @param {string[]} [localOnlyScopes=["ai-built"]] - Scopes that must be remapped
 */
function remapLayoutPackageScopes(
  workspace,
  callerScope,
  localOnlyScopes = ["ai-built"],
) {
  if (!workspace || !callerScope) return workspace;
  const localScopeSet = new Set(
    localOnlyScopes.map((s) => String(s).replace(/^@/, "")),
  );
  const callerScopeBare = String(callerScope).replace(/^@/, "");
  const remapPackageId = (pkgId) => {
    if (typeof pkgId !== "string" || pkgId.length === 0) return pkgId;
    // Match `@<scope>/<rest>` or `<scope>/<rest>`. Tolerant of either form.
    const m = pkgId.match(/^@?([^/]+)\/(.+)$/);
    if (!m) return pkgId;
    const scope = m[1];
    const rest = m[2];
    if (!localScopeSet.has(scope)) return pkgId;
    return `@${callerScopeBare}/${rest}`;
  };
  // Layout items now carry a SCOPED `component` (e.g.
  // "ai-built.pipeline.ProspectListColumn"). On publish we have to
  // rewrite the scope segment to the caller's so the installer can
  // resolve the same component against its registry-installed widget
  // (which lives under "@<caller>/pipeline"). Bare component names
  // (legacy layouts) pass through untouched — ComponentManager's
  // bare-name fallback handles them on the install side.
  const remapComponent = (component) => {
    if (typeof component !== "string" || component.length === 0) {
      return component;
    }
    const parts = component.split(".");
    if (parts.length !== 3) return component;
    const [scope, pkg, comp] = parts;
    if (!localScopeSet.has(scope)) return component;
    return `${callerScopeBare}.${pkg}.${comp}`;
  };
  const remapItem = (item) => {
    if (!item || typeof item !== "object") return item;
    const next = { ...item };
    if (item.packageId) {
      const remapped = remapPackageId(item.packageId);
      if (remapped !== item.packageId) next.packageId = remapped;
    }
    if (item._sourcePackage) {
      const remapped = remapPackageId(item._sourcePackage);
      if (remapped !== item._sourcePackage) next._sourcePackage = remapped;
    }
    if (item.component) {
      const remapped = remapComponent(item.component);
      if (remapped !== item.component) next.component = remapped;
    }
    if (Array.isArray(item.items)) next.items = item.items.map(remapItem);
    if (Array.isArray(item.layout)) next.layout = item.layout.map(remapItem);
    return next;
  };
  const next = { ...workspace };
  if (Array.isArray(next.layout)) next.layout = next.layout.map(remapItem);
  if (Array.isArray(next.sidebarLayout)) {
    next.sidebarLayout = next.sidebarLayout.map(remapItem);
  }
  if (Array.isArray(next.pages)) {
    next.pages = next.pages.map((page) =>
      page && Array.isArray(page.layout)
        ? { ...page, layout: page.layout.map(remapItem) }
        : page,
    );
  }
  return next;
}

/**
 * Defense-in-depth guard: throw if any layout item in `workspace`
 * still references a local-only scope (e.g. `@ai-built/...`).
 *
 * `remapLayoutPackageScopes` rewrites local scopes to the publisher's
 * scope BUT silently no-ops when no `callerScope` is available
 * (failed auth, no profile, no `authorId` fallback). When that
 * happens the publish would otherwise ship a manifest that no
 * installer can resolve — `@ai-built/...` only exists on the
 * publisher's machine.
 *
 * This function is meant to be called immediately after
 * `remapLayoutPackageScopes` on the publish path. It walks layout,
 * sidebarLayout, and every `pages[].layout`, and checks each item's
 * `packageId`, `_sourcePackage`, and scoped `component` field.
 *
 * Throws a single descriptive Error listing every violation (capped
 * at the first 10 to keep messages readable). Pure / side-effect-free
 * on the success path.
 *
 * @param {Object} workspace
 * @param {string[]} [localOnlyScopes=["ai-built"]]
 * @throws {Error} if any local-only scope reference remains
 */
function assertNoLocalScopes(workspace, localOnlyScopes = ["ai-built"]) {
  if (!workspace || typeof workspace !== "object") return;
  const localSet = new Set(
    localOnlyScopes.map((s) => String(s).replace(/^@/, "")),
  );
  const violations = [];

  const checkPackageId = (pkgId, where) => {
    if (typeof pkgId !== "string" || pkgId.length === 0) return;
    const m = pkgId.match(/^@?([^/]+)\//);
    if (m && localSet.has(m[1])) {
      violations.push(`${where}: ${pkgId}`);
    }
  };
  const checkComponent = (component, where) => {
    if (typeof component !== "string" || component.length === 0) return;
    const parts = component.split(".");
    if (parts.length === 3 && localSet.has(parts[0])) {
      violations.push(`${where}: ${component}`);
    }
  };

  const walkItem = (item, path) => {
    if (!item || typeof item !== "object") return;
    const at = `${path}#${item.id ?? item.uuid ?? "?"}`;
    if (item.packageId) checkPackageId(item.packageId, `${at}.packageId`);
    if (item._sourcePackage) {
      checkPackageId(item._sourcePackage, `${at}._sourcePackage`);
    }
    if (item.component) checkComponent(item.component, `${at}.component`);
    if (Array.isArray(item.items)) {
      item.items.forEach((c, i) => walkItem(c, `${at}.items[${i}]`));
    }
    if (Array.isArray(item.layout)) {
      item.layout.forEach((c, i) => walkItem(c, `${at}.layout[${i}]`));
    }
  };

  if (Array.isArray(workspace.layout)) {
    workspace.layout.forEach((item, i) => walkItem(item, `layout[${i}]`));
  }
  if (Array.isArray(workspace.sidebarLayout)) {
    workspace.sidebarLayout.forEach((item, i) =>
      walkItem(item, `sidebarLayout[${i}]`),
    );
  }
  if (Array.isArray(workspace.pages)) {
    workspace.pages.forEach((page, pi) => {
      if (page && Array.isArray(page.layout)) {
        page.layout.forEach((item, i) =>
          walkItem(item, `pages[${pi}].layout[${i}]`),
        );
      }
    });
  }

  if (violations.length === 0) return;
  const scopesList = [...localSet].join(", ");
  const head = violations.slice(0, 10).join("\n  - ");
  const tail =
    violations.length > 10 ? `\n  - ...and ${violations.length - 10} more` : "";
  throw new Error(
    `Refusing to publish: ${violations.length} layout item(s) still reference ` +
      `local-only scope(s) [${scopesList}] after rescoping. This usually ` +
      `means the publisher has no resolved caller scope (registry auth ` +
      `missing, no githubUser, no authorId). Violations:\n  - ${head}${tail}`,
  );
}

module.exports = {
  collectComponentNames,
  collectComponentNamesFromWorkspace,
  collectDependencyRefsFromWorkspace,
  extractEventWiring,
  extractEventWiringFromWorkspace,
  buildWidgetDependencies,
  buildProviderRequirements,
  applyEventWiringToLayout,
  checkDashboardCompatibility,
  generateRegistryManifest,
  buildDashboardPreview,
  checkDashboardUpdates,
  buildProviderSetupManifest,
  checkApiCompatibility,
  stripPersonalizationFromWorkspace,
  remapLayoutPackageScopes,
  assertNoLocalScopes,
};
