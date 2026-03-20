import { useState, useEffect, useCallback } from "react";
import { ComponentManager } from "../ComponentManager";

/**
 * Walk a workspace layout array (possibly nested via LayoutGridContainer
 * children) and collect every `item.component` value.
 */
function collectComponentsFromLayout(layout) {
  const components = [];
  if (!Array.isArray(layout)) return components;
  for (const item of layout) {
    if (item.component) components.push(item.component);
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
          };
        });

      // ── Installed widgets from WidgetRegistry ───────────────
      // Registry entries now include .dash.js fields (icon, providers,
      // workspace, etc.) persisted at install time. Also try enriching
      // from ComponentManager as a fallback.
      let installedWidgets = [];
      if (window.mainApi?.widgets) {
        const list = await window.mainApi.widgets.list();
        installedWidgets = (list || []).map((w) => {
          // Try to find a matching ComponentManager entry:
          // 1) by componentNames stored in the registry entry
          // 2) by _sourcePackage on the CM entry
          const cmKey =
            (w.componentNames || []).find((cn) => cn in cMap) ||
            Object.keys(cMap).find(
              (key) => cMap[key]._sourcePackage === w.name,
            );
          const cm = cmKey ? cMap[cmKey] : null;

          return {
            name: w.name,
            displayName: w.displayName || cm?.name || cmKey || w.name,
            author: w.author || cm?.author || null,
            package: w.package || cm?.package || null,
            description: w.description || cm?.description || null,
            icon: w.icon || cm?.icon || null,
            version: w.version || null,
            path: w.path || null,
            source: "installed",
            providers: w.providers?.length ? w.providers : cm?.providers || [],
            workspace: w.workspace || cm?.workspace || null,
            componentNames: w.componentNames || (cmKey ? [cmKey] : []),
            packageId: w.packageId || w.name,
          };
        });
      }

      // ── Merge: installed wins on name collision ──────────────
      // Also remove builtin entries whose _sourcePackage matches an
      // installed widget name (e.g. builtin "WeatherWidget" with
      // _sourcePackage "weather-widget" is the same as installed
      // "weather-widget").
      const installedNames = new Set(installedWidgets.map((w) => w.name));
      const deduped = builtinWidgets.filter((w) => {
        if (installedNames.has(w.name)) return false;
        const sp = cMap[w.name]?._sourcePackage;
        if (sp && installedNames.has(sp)) return false;
        return true;
      });

      setWidgets([...deduped, ...installedWidgets]);
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
        // Remove matching ComponentManager entries so the widget
        // doesn't reappear as a "builtin" ghost after uninstall.
        const cMap = ComponentManager.componentMap() || {};
        const keysToRemove = Object.keys(cMap).filter(
          (key) => cMap[key]._sourcePackage === widgetName,
        );
        keysToRemove.forEach((key) => delete cMap[key]);

        await window.mainApi.widgets.uninstall(widgetName);
        await refresh();
      } catch (err) {
        console.error("[useInstalledWidgets] Error uninstalling widget:", err);
        throw err;
      }
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { widgets, isLoading, error, uninstallWidget, refresh };
};
