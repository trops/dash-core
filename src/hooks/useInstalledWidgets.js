import { useState, useEffect, useCallback } from "react";
import { ComponentManager } from "../ComponentManager";
import { useWidgetRegistryVersion } from "./useWidgetRegistryVersion";

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
            kind: "installed",
            draftId: null,
            providers: config.providers || [],
            workspace: config.workspace || null,
            componentNames: [key],
            scopedId: key,
          };
        });

      // ── Drafts (in-progress widgets from the AI Builder) ─────
      // Drafts on disk look like installed packages — their dirs
      // sit under @ai-built/<name>-draft-<shortId>/ alongside real
      // installs. We surface them as `kind: "draft"` so consumers
      // (dashboard picker, Settings → Widgets) can render them
      // distinctly (Resume/Delete affordances) or filter them out.
      // The match is `packageDir`-based when available (canonical)
      // and falls back to a `-draft-` name-pattern check so legacy
      // drafts without the on-disk metadata still get classified.
      let draftsByPackageDir = new Map();
      let draftShortIdToId = new Map();
      if (window.mainApi?.drafts?.list) {
        try {
          const allDrafts = (await window.mainApi.drafts.list()) || [];
          for (const d of allDrafts) {
            if (d?.packageDir) draftsByPackageDir.set(d.packageDir, d);
            if (d?.id) {
              const shortId = String(d.id)
                .replace(/^draft-/, "")
                .slice(0, 8);
              if (shortId) draftShortIdToId.set(shortId, d.id);
            }
          }
        } catch (draftErr) {
          // Best-effort — if drafts list fails, all widgets render
          // as kind="installed" and the user just loses the draft
          // distinction for this load. Not a hard failure.
          console.warn("[useInstalledWidgets] drafts.list failed:", draftErr);
        }
      }

      function classifyWidget(reg, fallbackName) {
        const name = reg?.name || fallbackName || "";
        const path = reg?.path || "";
        // 1. Match against drafts metadata by packageDir (canonical).
        if (path && draftsByPackageDir.has(path)) {
          return { kind: "draft", draftId: draftsByPackageDir.get(path).id };
        }
        // 2. Fallback: the dir name follows `<base>-draft-<shortId>`;
        //    pluck the shortId and look it up in the drafts list.
        const m = String(name).match(/-draft-([A-Za-z0-9]+)$/);
        if (m) {
          const shortId = m[1].slice(0, 8);
          const draftId = draftShortIdToId.get(shortId) || null;
          return { kind: "draft", draftId };
        }
        return { kind: "installed", draftId: null };
      }

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
          const classification = classifyWidget(reg, config._sourcePackage);
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
            kind: classification.kind,
            draftId: classification.draftId,
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
        .map((w) => {
          const classification = classifyWidget(w, w.name);
          return {
            name: w.name,
            displayName: w.displayName || w.name,
            author: w.author || null,
            package: w.package || null,
            description: w.description || null,
            icon: w.icon || null,
            version: w.version || null,
            path: w.path || null,
            source: "installed",
            kind: classification.kind,
            draftId: classification.draftId,
            providers: w.providers || [],
            workspace: w.workspace || null,
            componentNames: w.componentNames || [],
            packageId: w.packageId || w.name,
            scopedId: w.name,
          };
        });

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

  const widgetRegistryVersion = useWidgetRegistryVersion();
  useEffect(() => {
    refresh();
  }, [refresh, widgetRegistryVersion]);

  return { widgets, isLoading, error, uninstallWidget, refresh };
};
