import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWidgetUpdates } from "./useWidgetUpdates";

/**
 * useAppUpdates — combines widget + dashboard update checks behind one
 * surface so the app-launch flow (AppUpdatesModal) and the manual
 * "Check for updates" trigger have a single source of truth.
 *
 * Widget updates come from the existing useWidgetUpdates hook (per-
 * package check via the registry index). Dashboards run through
 * `window.mainApi.dashboardConfig.checkDashboardUpdates(appId)`,
 * which is the same path the in-app dashboard settings already uses;
 * the response is normalised to `{name, currentVersion, latestVersion}`
 * rows.
 *
 * @param {Object} opts
 * @param {string} opts.appId — application identifier (from credentials.appId).
 * @param {Array} opts.installedWidgets — list passed through to useWidgetUpdates.
 * @param {Function} [opts.onWidgetUpdated] — callback after a successful widget update.
 *
 * @returns {{
 *   widgetUpdates: Array,
 *   dashboardUpdates: Array,
 *   totalUpdates: number,
 *   isChecking: boolean,
 *   hasChecked: boolean,
 *   recheck: () => Promise<void>,
 *   updateWidgetPackages: (names: string[]) => Promise<{succeeded, failed}>,
 *   widgetBatchStatus: Map,
 *   isWidgetBatchUpdating: boolean,
 *   needsAuth: boolean,
 *   clearNeedsAuth: Function
 * }}
 */
export function useAppUpdates({
  appId,
  installedWidgets = [],
  onWidgetUpdated,
} = {}) {
  // ── Widget updates — defer to the dedicated hook ─────────────────
  const widget = useWidgetUpdates(installedWidgets, onWidgetUpdated);

  // ── Dashboard updates ────────────────────────────────────────────
  const [dashboardUpdates, setDashboardUpdates] = useState([]);
  const [isCheckingDashboards, setIsCheckingDashboards] = useState(false);
  const [hasCheckedDashboards, setHasCheckedDashboards] = useState(false);

  const checkDashboardUpdates = useCallback(async () => {
    if (!appId) return;
    const api = window.mainApi?.dashboardConfig?.checkDashboardUpdates;
    if (typeof api !== "function") {
      console.warn(
        "[useAppUpdates] dashboardConfig.checkDashboardUpdates IPC not available",
      );
      setHasCheckedDashboards(true);
      return;
    }
    setIsCheckingDashboards(true);
    try {
      const result = await api(appId);
      // Controller returns { success, updates, totalInstalled } or
      // { success: false, error, updates: [] } on failure. Treat
      // failure as "no updates" rather than surfacing an error
      // banner — the user can still ship via the settings page.
      const list = Array.isArray(result?.updates) ? result.updates : [];
      setDashboardUpdates(list);
    } catch (err) {
      console.warn(
        "[useAppUpdates] dashboard update check failed:",
        err?.message || err,
      );
      setDashboardUpdates([]);
    } finally {
      setIsCheckingDashboards(false);
      setHasCheckedDashboards(true);
    }
  }, [appId]);

  // ── Combined surface ─────────────────────────────────────────────
  const totalUpdates = useMemo(
    () => widget.packagesWithUpdates.length + dashboardUpdates.length,
    [widget.packagesWithUpdates, dashboardUpdates],
  );

  const isChecking = widget.isChecking || isCheckingDashboards;
  // hasChecked flips true once BOTH checks have completed at least
  // once. Lets the modal say "you're up to date" definitively rather
  // than during an in-flight check.
  const hasChecked = !widget.isChecking && hasCheckedDashboards;

  // Manual re-check trigger — re-runs BOTH the widget registry
  // check (force-refreshing the cache) AND the dashboard check.
  // Previously only the dashboard check ran on manual recheck, so a
  // user who wasn't signed in at app mount (when the widget hook's
  // one-shot useEffect fired) had no way to surface private-package
  // updates — they were stuck with whatever the anon mount-time
  // fetch returned. Routing both checks through here also keeps
  // popover-driven and modal-triggered rechecks symmetrical with
  // the auto-pop check.
  const recheck = useCallback(async () => {
    await Promise.all([widget.recheck(), checkDashboardUpdates()]);
  }, [widget, checkDashboardUpdates]);

  // Kick off the initial dashboard check once appId is available.
  // One-shot — same gating pattern useWidgetUpdates uses.
  const checkedDashboardsRef = useRef(false);
  useEffect(() => {
    if (checkedDashboardsRef.current) return;
    if (!appId) return;
    checkedDashboardsRef.current = true;
    checkDashboardUpdates();
  }, [appId, checkDashboardUpdates]);

  const baseReturn = {
    widgetUpdates: widget.packagesWithUpdates,
    dashboardUpdates,
    totalUpdates,
    isChecking,
    hasChecked,
    recheck,
    updateWidgetPackages: widget.updatePackages,
    widgetBatchStatus: widget.batchStatus,
    isWidgetBatchUpdating: widget.isBatchUpdating,
    needsAuth: widget.needsAuth,
    clearNeedsAuth: widget.clearNeedsAuth,
    // Pre-install MCP preflight. Non-null when the batch is suspended
    // waiting on the user to review newly-required grants; the UI
    // calls resolvePreflight({acceptedByWidgetId}) to approve or
    // resolvePreflight(null) to cancel the entire batch.
    pendingPreflight: widget.pendingPreflight,
    resolvePreflight: widget.resolvePreflight,
  };

  // Test-only override hook for e2e specs. Set
  // `window.__DASH_APP_UPDATES_OVERRIDE` to an object whose keys
  // shadow any of the hook's return values — useful for driving the
  // AppUpdatesModal through its auto-pop / populated-updates /
  // failed-batch paths without having to seed real installed widgets
  // or stub multiple IPCs (contextBridge freezes window.mainApi so
  // direct bridge stubbing isn't possible from the page side).
  // Same pattern llmOneShot uses for its CLI-bypass override.
  if (
    typeof window !== "undefined" &&
    window.__DASH_APP_UPDATES_OVERRIDE &&
    typeof window.__DASH_APP_UPDATES_OVERRIDE === "object"
  ) {
    return { ...baseReturn, ...window.__DASH_APP_UPDATES_OVERRIDE };
  }
  return baseReturn;
}
