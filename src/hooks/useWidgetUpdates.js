import { useState, useEffect, useCallback, useRef } from "react";

/**
 * useWidgetUpdates — checks the registry for newer versions of installed widgets
 * and provides a one-click update function.
 *
 * @param {Array} installedWidgets - Widgets from useInstalledWidgets()
 * @param {Function} onUpdated - Callback after a successful update (e.g. refresh)
 * @returns {{ updates: Map, isChecking: boolean, updateWidget: Function, isUpdating: string|null }}
 */
export function useWidgetUpdates(installedWidgets = [], onUpdated) {
  const [updates, setUpdates] = useState(new Map());
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(null);
  const checkedRef = useRef(false);

  // Check for updates once when installed widgets are available
  useEffect(() => {
    if (checkedRef.current) return;
    const installed = installedWidgets.filter(
      (w) => w.source === "installed" && w.version,
    );
    if (installed.length === 0) return;

    checkedRef.current = true;
    setIsChecking(true);

    const payload = installed.map((w) => ({
      name: w.name,
      version: w.version,
    }));

    window.mainApi?.registry
      ?.checkUpdates(payload)
      .then((results) => {
        if (Array.isArray(results) && results.length > 0) {
          const map = new Map();
          results.forEach((r) => map.set(r.name, r));
          setUpdates(map);
        }
      })
      .catch((err) => {
        console.warn("[useWidgetUpdates] Check failed:", err.message);
      })
      .finally(() => {
        setIsChecking(false);
      });
  }, [installedWidgets]);

  // Update a single widget by downloading the latest version
  const updateWidget = useCallback(
    async (name) => {
      const info = updates.get(name);
      if (!info || !info.downloadUrl) return;

      setIsUpdating(name);
      try {
        const resolvedUrl = info.downloadUrl
          .replace(/\{version\}/g, info.latestVersion)
          .replace(/\{name\}/g, name);

        await window.mainApi.widgets.install(name, resolvedUrl);

        // Remove from updates map on success
        setUpdates((prev) => {
          const next = new Map(prev);
          next.delete(name);
          return next;
        });

        if (onUpdated) onUpdated();
      } catch (err) {
        console.error("[useWidgetUpdates] Update failed:", err);
      } finally {
        setIsUpdating(null);
      }
    },
    [updates, onUpdated],
  );

  return { updates, isChecking, updateWidget, isUpdating };
}
