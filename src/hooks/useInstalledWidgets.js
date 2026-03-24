import { useState, useEffect, useCallback } from "react";
import { ComponentManager } from "../ComponentManager";

/**
 * Walk a workspace layout and collect widget component keys that are
 * actively referenced by grid cells. Ignores orphaned layout items
 * (items not referenced by any grid cell) so they don't trigger false
 * "missing widget" warnings.
 */
export function collectComponentsFromLayout(layout) {
  const components = [];
  if (!Array.isArray(layout)) return components;

  // Collect IDs of layout items that are actively referenced by grid cells
  const activeItemIds = new Set();
  for (const item of layout) {
    if (item.grid && typeof item.grid === "object") {
      for (const key of Object.keys(item.grid)) {
        const cell = item.grid[key];
        if (cell && typeof cell === "object" && cell.component) {
          activeItemIds.add(cell.component);
        }
      }
    }
  }

  for (const item of layout) {
    if (!item.component) continue;
    // Skip layout containers — they are always resolvable
    if (
      item.component === "LayoutGridContainer" ||
      item.component === "Container" ||
      item.component === "LayoutContainer"
    )
      continue;
    // When grid containers exist, only collect items referenced by a grid cell
    if (activeItemIds.size > 0 && !activeItemIds.has(item.id)) continue;
    components.push(item.component);
    if (Array.isArray(item.children)) {
      components.push(...collectComponentsFromLayout(item.children));
    }
  }
  return components;
}

/**
 * Check which workspaces use any of the given component names.
 *
 * @param {string[]} componentNames – CM keys the widget package registers
 * @param {object[]} workspaces     – workspace objects with .layout arrays
 * @returns {{ workspaceId: string, workspaceName: string, count: number }[]}
 */
export function findWidgetUsage(componentNames, workspaces) {
  if (!componentNames?.length || !workspaces?.length) return [];
  const nameSet = new Set(componentNames);
  const results = [];
  for (const ws of workspaces) {
    const comps = collectComponentsFromLayout(ws.layout);
    const count = comps.filter((c) => nameSet.has(c)).length;
    if (count > 0) {
      results.push({
        workspaceId: ws.id,
        workspaceName: ws.name || ws.id,
        count,
      });
    }
  }
  return results;
}

/**
 * useInstalledWidgets — hook for listing and managing installed widgets.
 *
 * Merges built-in widgets (from ComponentManager) with externally installed
 * widgets (from WidgetRegistry via mainApi). Both sources are normalized to
 * a common shape. Built-in widgets are listed first.
 *
 * Returns:
 *   widgets       – array of widget configs (built-in + installed)
 *   isLoading     – true while fetching
 *   error         – error message string (or null)
 *   uninstallWidget(name) – uninstall a widget by name
 *   refresh()     – manually refresh the list
 */
export const useInstalledWidgets = () => {
  const [widgets, setWidgets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // ── Built-in widgets from ComponentManager ──────────────
      const cMap = ComponentManager.componentMap() || {};
      const builtinWidgets = Object.keys(cMap)
        .filter((key) => cMap[key].type === "widget")
        .filter((key) => !cMap[key]._sourcePackage)
        .map((key) => {
          const config = cMap[key];
          return {
            name: key,
            displayName: config.name || key,
            author: config.author || null,
            package: config.package || null,
            description: config.description || null,
            icon: config.icon || null,
            version: null,
            path: null,
            source: "builtin",
            providers: config.providers || [],
            workspace: config.workspace || null,
            componentNames: [key],
            scopedId: key,
          };
        });

      // ── Installed widgets from ComponentManager + Registry ───
      // CM entries with _sourcePackage are registry-installed widgets.
      // Show each as an individual "installed" entry, enriched with
      // registry-level metadata (version, path, packageId).
      let registryByName = {};
      if (window.mainApi?.widgets) {
        const list = await window.mainApi.widgets.list();
        (list || []).forEach((w) => {
          registryByName[w.packageId || w.name] = w;
        });
      }

      const installedFromCM = Object.keys(cMap)
        .filter(
          (key) => cMap[key].type === "widget" && !!cMap[key]._sourcePackage,
        )
        .map((key) => {
          const config = cMap[key];
          const reg = registryByName[config._sourcePackage] || {};
          return {
            name: key,
            displayName: config.name || key,
            author: config.author || reg.author || null,
            package: config.package || null,
            description: config.description || null,
            icon: config.icon || null,
            version: reg.version || null,
            path: reg.path || null,
            source: "installed",
            providers: config.providers || [],
            workspace: config.workspace || null,
            componentNames: [key],
            packageId: reg.packageId || config._sourcePackage,
            scopedId: key,
          };
        });

      // Fallback: registry packages whose components never loaded
      // into CM (e.g. compile failure). Show the package-level entry.
      const cmSourcePackages = new Set(
        Object.values(cMap)
          .filter((c) => c._sourcePackage)
          .map((c) => c._sourcePackage),
      );
      const fallbackInstalled = Object.values(registryByName)
        .filter((w) => !cmSourcePackages.has(w.name))
        .map((w) => ({
          name: w.name,
          displayName: w.displayName || w.name,
          author: w.author || null,
          package: w.package || null,
          description: w.description || null,
          icon: w.icon || null,
          version: w.version || null,
          path: w.path || null,
          source: "installed",
          providers: w.providers || [],
          workspace: w.workspace || null,
          componentNames: w.componentNames || [],
          packageId: w.packageId || w.name,
          scopedId: w.name,
        }));

      setWidgets([...builtinWidgets, ...installedFromCM, ...fallbackInstalled]);
    } catch (err) {
      console.error("[useInstalledWidgets] Error listing widgets:", err);
      setError(err.message || "Failed to load widgets");
      setWidgets([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const uninstallWidget = useCallback(
    async (widgetName) => {
      if (!window.mainApi?.widgets) return;
      try {
        // Resolve packageId — widgetName may be a CM key (e.g. "AnalogClockWidget")
        // but the registry is keyed by scoped package ID (e.g. "@trops/clock").
        const widget = widgets.find((w) => w.name === widgetName);
        const packageId = widget?.packageId || widgetName;

        // Remove matching ComponentManager entries so the widget
        // doesn't reappear as a "builtin" ghost after uninstall.
        const cMap = ComponentManager.componentMap() || {};
        const keysToRemove = Object.keys(cMap).filter(
          (key) => cMap[key]._sourcePackage === packageId,
        );
        keysToRemove.forEach((key) => delete cMap[key]);

        await window.mainApi.widgets.uninstall(packageId);
        await refresh();
      } catch (err) {
        console.error("[useInstalledWidgets] Error uninstalling widget:", err);
        throw err;
      }
    },
    [refresh, widgets],
  );

  useEffect(() => {
    refresh();
    const handleWidgetsUpdated = () => refresh();
    window.addEventListener("dash:widgets-updated", handleWidgetsUpdated);
    return () =>
      window.removeEventListener("dash:widgets-updated", handleWidgetsUpdated);
  }, [refresh]);

  return { widgets, isLoading, error, uninstallWidget, refresh };
};
