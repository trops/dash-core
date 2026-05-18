import { useState, useEffect, useCallback, useMemo, useRef } from "react";

/**
 * useWidgetUpdates — checks the registry for newer versions of installed widgets
 * and provides a one-click update function.
 *
 * @param {Array} installedWidgets - Widgets from useInstalledWidgets()
 * @param {Function} onUpdated - Callback after a successful update (e.g. refresh)
 * @returns {{
 *   updates: Map,
 *   packagesWithUpdates: Array<{name, installedVersion, latestVersion, downloadUrl, widgetNames}>,
 *   isChecking: boolean,
 *   updateWidget: Function,
 *   updatePackages: Function,
 *   isUpdating: string|null,
 *   batchStatus: Map<string, {status: "pending"|"in-progress"|"done"|"failed", error?: string}>,
 *   isBatchUpdating: boolean,
 *   needsAuth: boolean,
 *   clearNeedsAuth: Function,
 *   updateError: string|null
 * }}
 */
export function useWidgetUpdates(installedWidgets = [], onUpdated) {
  const [updates, setUpdates] = useState(new Map());
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [updateError, setUpdateError] = useState(null);
  // batchStatus tracks the per-package progress during an updatePackages
  // run so the "Update all" modal can show pending/in-progress/done/failed
  // pips next to each row. Cleared (Map -> empty) when isBatchUpdating
  // flips back to false; consumers that want to keep showing a per-package
  // result after the batch finished should snapshot it themselves.
  const [batchStatus, setBatchStatus] = useState(new Map());
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);
  const checkedRef = useRef(false);

  // Core check-for-updates pass. Extracted so the post-batch
  // re-check (after updatePackages finishes) can reuse the same
  // logic without duplicating the payload + Map-keying code.
  //
  // ALWAYS calls setUpdates (with an empty Map when nothing's
  // available) — previously, an empty result didn't fire setUpdates,
  // leaving stale entries from a prior check visible after the
  // batch cleared them locally. This was the bug behind "Updates
  // Available button stays visible after running the batch".
  const runUpdateCheck = useCallback((installedList) => {
    const installed = (installedList || []).filter(
      (w) => w.source === "installed" && w.version,
    );
    if (installed.length === 0) {
      setUpdates(new Map());
      return Promise.resolve();
    }
    setIsChecking(true);

    // Deduplicate by package — multiple widgets in the same package
    // share one version.
    const pkgMap = new Map();
    installed.forEach((w) => {
      const pkgId = w.packageId || w.name;
      if (!pkgMap.has(pkgId)) {
        pkgMap.set(pkgId, { name: pkgId, version: w.version });
      }
    });
    const payload = Array.from(pkgMap.values());

    return (
      window.mainApi?.registry
        ?.checkUpdates(payload)
        .then((results) => {
          if (Array.isArray(results) && results.length > 0) {
            const map = new Map();
            results.forEach((r) => {
              // Key by package ID (from result).
              map.set(r.name, r);
              // Also key by each widget's CM key so UI can look up
              // by widget name.
              installed.forEach((w) => {
                const pkgId = w.packageId || w.name;
                if (pkgId === r.name) {
                  map.set(w.name, r);
                }
              });
            });
            setUpdates(map);
            console.log(
              `[useWidgetUpdates] Found ${results.length} package update(s)`,
            );
          } else {
            // No updates available — explicitly clear the Map so the
            // UI reflects the actual registry state. Without this,
            // a successful batch update would leave the "Updates
            // Available" CTA visible.
            setUpdates(new Map());
            console.log("[useWidgetUpdates] No package updates available");
          }
        })
        .catch((err) => {
          console.warn("[useWidgetUpdates] Check failed:", err.message);
        })
        .finally(() => {
          setIsChecking(false);
        }) || Promise.resolve()
    );
  }, []);

  // Initial check, runs once per mount when installedWidgets first
  // arrives. Gated by checkedRef so re-renders don't refire it —
  // post-batch re-checks happen explicitly via runUpdateCheck from
  // updatePackages.
  useEffect(() => {
    if (checkedRef.current) return;
    const hasInstalled = installedWidgets.some(
      (w) => w.source === "installed" && w.version,
    );
    if (!hasInstalled) return;
    checkedRef.current = true;
    runUpdateCheck(installedWidgets);
  }, [installedWidgets, runUpdateCheck]);

  // Update a single widget by downloading the latest version.
  //
  // `options.throwOnError` (default false) re-throws after setting
  // updateError state. Off by default so the single-update callers
  // (detail-view Update button) keep their fire-and-forget shape;
  // the batch updatePackages path passes `true` so it can per-row
  // report success/fail in batchStatus.
  const updateWidget = useCallback(
    async (name, options = {}) => {
      const throwOnError = options && options.throwOnError === true;
      const info = updates.get(name);
      if (!info) {
        console.error(
          `[useWidgetUpdates] No update info found for "${name}". Available keys:`,
          Array.from(updates.keys()),
        );
        setUpdateError(`No update info found for "${name}".`);
        return;
      }
      if (!info.downloadUrl) {
        console.error(
          `[useWidgetUpdates] Update info for "${name}" has no downloadUrl:`,
          info,
        );
        setUpdateError(
          `Update for "${name}" has no download URL. The registry entry may be incomplete.`,
        );
        return;
      }

      // Use packageId for install — name may be a CM key (widget-level)
      const widget = installedWidgets.find((w) => w.name === name);
      const packageId = widget?.packageId || info.name || name;

      setIsUpdating(name);
      setUpdateError(null);
      try {
        // Validate token against registry (not just check if it exists locally)
        const profile = await window.mainApi?.registryAuth?.getProfile();
        if (!profile) {
          console.log(
            "[useWidgetUpdates] Token invalid or expired, requesting auth",
          );
          setNeedsAuth(true);
          return;
        }

        const resolvedUrl = info.downloadUrl
          .replace(/\{version\}/g, info.latestVersion)
          .replace(/\{name\}/g, packageId);

        console.log(
          `[useWidgetUpdates] Installing ${packageId} from ${resolvedUrl}`,
        );

        await window.mainApi.widgets.install(packageId, resolvedUrl);

        console.log(`[useWidgetUpdates] ✓ Updated ${packageId} successfully`);

        // Remove ALL widgets in this package from updates map
        // (install replaces the entire package, not just one widget)
        setUpdates((prev) => {
          const next = new Map(prev);
          for (const [key, val] of next) {
            if (val.name === info.name) next.delete(key);
          }
          return next;
        });

        if (onUpdated) onUpdated();
      } catch (err) {
        console.error("[useWidgetUpdates] Update failed:", err);
        setUpdateError(err.message || "Update failed");
        if (throwOnError) {
          // Re-throw so the batch caller can mark this row failed.
          // Single-update callers leave throwOnError as false and
          // keep the existing fire-and-forget behavior.
          throw err;
        }
      } finally {
        setIsUpdating(null);
      }
    },
    [updates, onUpdated, installedWidgets],
  );

  const clearNeedsAuth = useCallback(() => setNeedsAuth(false), []);

  // Derived list of packages with updates available, deduped by
  // package id. `updates` carries each entry under TWO keys (the
  // package id AND each widget's CM key — see the .set() loop above);
  // the modal needs the one-row-per-package shape and the list of
  // widget names that ride along so users see what a single package
  // update will actually bring with it.
  const packagesWithUpdates = useMemo(() => {
    if (!updates || updates.size === 0) return [];
    const byPackage = new Map();
    for (const [, info] of updates) {
      if (!info || !info.name) continue;
      if (!byPackage.has(info.name)) {
        byPackage.set(info.name, {
          name: info.name,
          // registryController returns { currentVersion, latestVersion, ... } —
          // see electron/controller/registryController.js checkUpdates().
          currentVersion: info.currentVersion || "",
          latestVersion: info.latestVersion || "",
          downloadUrl: info.downloadUrl || null,
          widgetNames: [],
        });
      }
    }
    // Walk installed widgets so each package row carries the list of
    // widget display names the user will see updated. Useful in the
    // modal for "Slack — updates SlackListChannels, SlackChannelMessages,
    // SlackWidget" disclosure.
    for (const w of installedWidgets) {
      if (!w || w.source !== "installed") continue;
      const pkgId = w.packageId || w.name;
      const entry = byPackage.get(pkgId);
      if (entry && !entry.widgetNames.includes(w.name)) {
        entry.widgetNames.push(w.name);
      }
    }
    return Array.from(byPackage.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [updates, installedWidgets]);

  // Sequentially update each package in `packageNames`. Sequential
  // (not parallel) on purpose: the install IPC hits a single registry
  // endpoint per package and parallel runs would trip auth + create
  // confusing partial-failure states. Per-package status flows into
  // batchStatus so the UI can render pending/in-progress/done/failed
  // pips in real time.
  //
  // Resolves to a summary `{succeeded: string[], failed: string[]}`.
  const updatePackages = useCallback(
    async (packageNames) => {
      if (!Array.isArray(packageNames) || packageNames.length === 0) {
        return { succeeded: [], failed: [] };
      }
      // Seed every selected package as pending so the modal renders
      // the full per-row state from the first paint.
      const initial = new Map();
      for (const name of packageNames) {
        initial.set(name, { status: "pending" });
      }
      setBatchStatus(initial);
      setIsBatchUpdating(true);
      setUpdateError(null);
      const succeeded = [];
      const failed = [];
      try {
        for (const pkgName of packageNames) {
          // Mark in-progress BEFORE the await so the spinner appears
          // immediately, not after the install finishes.
          setBatchStatus((prev) => {
            const next = new Map(prev);
            next.set(pkgName, { status: "in-progress" });
            return next;
          });
          try {
            // Reuse the existing single-update path so any future
            // behavior (auth flow, error normalization, refresh
            // callback) stays in one place. updateWidget keys on
            // either a package id or a widget CM key — the
            // packagesWithUpdates entries use `name = info.name`,
            // which IS the package id, so this works.
            await updateWidget(pkgName, { throwOnError: true });
            setBatchStatus((prev) => {
              const next = new Map(prev);
              next.set(pkgName, { status: "done" });
              return next;
            });
            succeeded.push(pkgName);
          } catch (err) {
            const msg = (err && err.message) || "Update failed";
            setBatchStatus((prev) => {
              const next = new Map(prev);
              next.set(pkgName, { status: "failed", error: msg });
              return next;
            });
            failed.push(pkgName);
            // Continue to the next package — one failure shouldn't
            // abort the whole run. The modal surfaces each per-row
            // failure individually so the user can retry just those.
          }
        }
      } finally {
        setIsBatchUpdating(false);
      }
      // NOTE — we do NOT call runUpdateCheck here. The earlier
      // attempt to "belt-and-suspenders" with a post-batch re-check
      // backfired: this useCallback closes over `installedWidgets`,
      // which still carries the PRE-install versions at the time the
      // batch was kicked off (refresh() updates the prop async, but
      // the closure is captured synchronously). Running the check
      // against pre-install versions makes the registry correctly
      // report "needs update" for every package we just updated,
      // re-populating the Map and reviving the "Updates Available"
      // CTA the user wanted to disappear.
      //
      // Per-package setUpdates inside updateWidget already removes
      // each package from the Map as its install succeeds, so by the
      // end of the loop the Map naturally reflects the post-batch
      // state. The empty-results branch of runUpdateCheck (initial
      // mount only) handles the "registry returned []" case.
      return { succeeded, failed };
    },
    [updateWidget],
  );

  return {
    updates,
    packagesWithUpdates,
    isChecking,
    updateWidget,
    updatePackages,
    isUpdating,
    batchStatus,
    isBatchUpdating,
    needsAuth,
    clearNeedsAuth,
    updateError,
  };
}
