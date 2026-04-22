/**
 * providerResolution.js
 *
 * Shared helpers for walking a workspace and figuring out which widgets
 * have required providers that are still unresolved after the 3-layer
 * resolution (widget → workspace → app-default → null). Used by:
 *
 *   - DashboardConfigModal to render the Providers tab
 *   - DashboardStage toolbar to show the unresolved-count badge
 *
 * Both places need the same answer, so keep the logic here to avoid drift
 * with the resolution inside `useMcpProvider` / `useWebSocketProvider`.
 */

/**
 * Resolve which provider name a given widget instance would bind to for
 * the given provider type. Mirrors the 3-layer chain in useMcpProvider
 * and useWebSocketProvider exactly:
 *
 *   1. widget-level override    (layoutItem.selectedProviders[type])
 *   2. workspace-level binding  (workspace.selectedProviders[id][type])
 *   3. app default              (any provider of matching type flagged
 *                                `isDefaultForType` in appProviders)
 *   4. null                     (truly unresolved)
 */
export function resolveProviderName({
    providerType,
    layoutItem,
    widgetId,
    workspace,
    appProviders,
}) {
    // 1. Widget-level
    const widgetLevel = layoutItem?.selectedProviders?.[providerType];
    if (widgetLevel) return widgetLevel;

    // 2. Workspace-level
    const workspaceLevel =
        widgetId && workspace?.selectedProviders?.[widgetId]?.[providerType];
    if (workspaceLevel) return workspaceLevel;

    // 3. App default — appProviders is either a map keyed by name or an
    //    array. Support both because different callers shape it either way.
    if (appProviders) {
        if (Array.isArray(appProviders)) {
            for (const data of appProviders) {
                if (
                    data?.type === providerType &&
                    data?.isDefaultForType === true
                ) {
                    return data.name;
                }
            }
        } else if (typeof appProviders === "object") {
            for (const [name, data] of Object.entries(appProviders)) {
                if (
                    data?.type === providerType &&
                    data?.isDefaultForType === true
                ) {
                    return name;
                }
            }
        }
    }

    return null;
}

/**
 * Walk every layout container in a workspace and yield each widget
 * instance with its concrete layout item. Handles the main layout,
 * per-page layouts, the sidebar, and nested LayoutGridContainers whose
 * children are stored on `items`/`layout`.
 *
 * Deduplicates by object identity AND by stable id so that shared
 * references across pages (or two structurally-distinct items that
 * carry the same uuidString / id, which is the wiring key) are
 * visited exactly once. Pipeline-style workspaces re-reference the
 * same widget objects across page layouts; without this dedupe the
 * Providers/Listeners tabs render one row per reference.
 */
export function forEachWidget(workspace, visit) {
    if (!workspace) return;

    const visitedObjects = new WeakSet();
    const visitedIds = new Set();

    const stableId = (item) =>
        item?.uuidString ||
        item?.uuid ||
        (item?.component != null && item?.id != null
            ? `${item.component}|${item.id}`
            : null);

    const walk = (items) => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
            if (!item || typeof item !== "object") continue;
            // A "widget" is any layout item with a component name.
            // Containers can have both a component name AND nested items
            // (e.g. LayoutGridContainer), so still recurse.
            if (item.component) {
                const id = stableId(item);
                const alreadyByRef = visitedObjects.has(item);
                const alreadyById = id != null && visitedIds.has(id);
                if (!alreadyByRef && !alreadyById) {
                    visitedObjects.add(item);
                    if (id != null) visitedIds.add(id);
                    visit(item);
                }
            }
            if (Array.isArray(item.items)) walk(item.items);
            if (Array.isArray(item.layout)) walk(item.layout);
        }
    };

    walk(workspace.layout);
    if (Array.isArray(workspace.pages)) {
        for (const page of workspace.pages) walk(page?.layout);
    }
    walk(workspace.sidebarLayout);
}

/**
 * Compute the list of unresolved required providers across a workspace.
 *
 * @param {object} args
 * @param {object} args.workspace       The workspace (with layout/pages/sidebarLayout/selectedProviders).
 * @param {object|Array} args.appProviders
 *   Map keyed by provider name, or an array of provider objects. Each
 *   entry has at least `{ type, isDefaultForType }`.
 * @param {(componentName: string) => Array<{type, required?, providerClass?}>} args.getWidgetRequirements
 *   Returns the `providers: [...]` declaration from the component's
 *   `.dash.js` (via `ComponentManager.componentMap()[name].providers`).
 *
 * @returns {Array<{ widgetId, component, providerType, providerClass, layoutItem }>}
 *   One entry per (widget instance, required provider type) that lacks
 *   a binding.
 */
export function getUnresolvedProviders({
    workspace,
    appProviders,
    getWidgetRequirements,
}) {
    if (!workspace || typeof getWidgetRequirements !== "function") return [];

    const unresolved = [];

    forEachWidget(workspace, (item) => {
        const requirements = getWidgetRequirements(item.component) || [];
        if (!Array.isArray(requirements) || requirements.length === 0) return;

        const widgetId =
            item.uuidString || item.uuid || item.id || null;

        for (const req of requirements) {
            if (!req || !req.type) continue;
            if (req.required === false) continue; // optional, skip

            const name = resolveProviderName({
                providerType: req.type,
                layoutItem: item,
                widgetId,
                workspace,
                appProviders,
            });
            if (!name) {
                unresolved.push({
                    widgetId,
                    component: item.component,
                    providerType: req.type,
                    providerClass: req.providerClass || null,
                    layoutItem: item,
                });
            }
        }
    });

    return unresolved;
}

/**
 * Group an unresolved-provider list (or any `{widget, providerType}` list)
 * by provider type, so the Providers tab can render one row per unique
 * type with N widgets beneath.
 */
export function groupByProviderType(unresolved) {
    const byType = new Map();
    for (const u of unresolved || []) {
        if (!u?.providerType) continue;
        if (!byType.has(u.providerType)) byType.set(u.providerType, []);
        byType.get(u.providerType).push(u);
    }
    return byType;
}

/**
 * Summarize every widget in the workspace that requires ANY provider,
 * regardless of whether it's already resolved. Drives the Providers tab's
 * "show per-widget overrides" expansion — the modal lists all widgets so
 * the user can change an explicit override even for types that are
 * already resolved via the app default.
 */
export function getAllProviderBindings({
    workspace,
    appProviders,
    getWidgetRequirements,
}) {
    if (!workspace || typeof getWidgetRequirements !== "function") return [];

    const bindings = [];

    forEachWidget(workspace, (item) => {
        const requirements = getWidgetRequirements(item.component) || [];
        if (!Array.isArray(requirements) || requirements.length === 0) return;

        const widgetId = item.uuidString || item.uuid || item.id || null;

        for (const req of requirements) {
            if (!req || !req.type) continue;
            const name = resolveProviderName({
                providerType: req.type,
                layoutItem: item,
                widgetId,
                workspace,
                appProviders,
            });
            bindings.push({
                widgetId,
                component: item.component,
                providerType: req.type,
                providerClass: req.providerClass || null,
                required: req.required !== false,
                resolvedProviderName: name,
                layoutItem: item,
            });
        }
    });

    return bindings;
}
