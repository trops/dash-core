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

        for (const [eventName, listenerConfig] of Object.entries(
            item.listeners,
        )) {
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
                        typeof w.author === "string"
                            ? w.author
                            : w.author?.name || "";
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
            if (
                w.providers &&
                w.componentNames &&
                w.componentNames.includes(name)
            ) {
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

module.exports = {
    collectComponentNames,
    extractEventWiring,
    buildWidgetDependencies,
    buildProviderRequirements,
};
