import { useState, useEffect, useCallback, useRef } from "react";

/**
 * useWidgetUpdates — checks the registry for newer versions of installed widgets
 * and provides a one-click update function.
 *
 * @param {Array} installedWidgets - Widgets from useInstalledWidgets()
 * @param {Function} onUpdated - Callback after a successful update (e.g. refresh)
 * @returns {{ updates: Map, isChecking: boolean, updateWidget: Function, isUpdating: string|null, needsAuth: boolean, clearNeedsAuth: Function, updateError: string|null }}
 */
export function useWidgetUpdates(installedWidgets = [], onUpdated) {
  const [updates, setUpdates] = useState(new Map());
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [updateError, setUpdateError] = useState(null);
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

    // Deduplicate by package — multiple widgets in the same package share one version
    const pkgMap = new Map();
    installed.forEach((w) => {
      const pkgId = w.packageId || w.name;
      if (!pkgMap.has(pkgId)) {
        pkgMap.set(pkgId, { name: pkgId, version: w.version });
      }
    });
    const payload = Array.from(pkgMap.values());

    window.mainApi?.registry
      ?.checkUpdates(payload)
      .then((results) => {
        if (Array.isArray(results) && results.length > 0) {
          const map = new Map();
          results.forEach((r) => {
            // Key by package ID (from result)
            map.set(r.name, r);
            // Also key by each widget's CM key so UI can look up by widget name
            installed.forEach((w) => {
              const pkgId = w.packageId || w.name;
              if (pkgId === r.name) {
                map.set(w.name, r);
              }
            });
          });
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

      // Use packageId for install — name may be a CM key (widget-level)
      const widget = installedWidgets.find((w) => w.name === name);
      const packageId = widget?.packageId || info.name || name;

      setIsUpdating(name);
      setUpdateError(null);
      try {
        // Check auth before attempting download (same pattern as useRegistrySearch)
        const status = await window.mainApi?.registryAuth?.getStatus();
        if (!status?.authenticated) {
          setNeedsAuth(true);
          return;
        }

        const resolvedUrl = info.downloadUrl
          .replace(/\{version\}/g, info.latestVersion)
          .replace(/\{name\}/g, packageId);

        await window.mainApi.widgets.install(packageId, resolvedUrl);

        // Remove from updates map on success
        setUpdates((prev) => {
          const next = new Map(prev);
          next.delete(name);
          return next;
        });

        if (onUpdated) onUpdated();
      } catch (err) {
        console.error("[useWidgetUpdates] Update failed:", err);
        setUpdateError(err.message || "Update failed");
      } finally {
        setIsUpdating(null);
      }
    },
    [updates, onUpdated, installedWidgets],
  );

  const clearNeedsAuth = useCallback(() => setNeedsAuth(false), []);

  return {
    updates,
    isChecking,
    updateWidget,
    isUpdating,
    needsAuth,
    clearNeedsAuth,
    updateError,
  };
}
