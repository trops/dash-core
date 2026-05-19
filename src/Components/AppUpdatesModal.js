import React, { useState } from "react";
import { Modal, FontAwesomeIcon } from "@trops/dash-react";

/**
 * Footer buttons are rendered with raw <button> + explicit Tailwind
 * because dash-react's `Button` uses theme tokens that don't have
 * sufficient contrast on this dark modal (visible as black text on a
 * dark-gray fill). The same pattern WidgetsSection uses for its
 * prominent "Updates Available" trigger.
 */
const secondaryBtnClass =
  "px-3 py-2 text-sm font-medium rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-gray-100";
const primaryBtnClass =
  "px-3 py-2 text-sm font-medium rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white";

/**
 * AppUpdatesModal — top-level "updates available" prompt the app shell
 * pops on launch (and optionally from a manual "Check for updates"
 * trigger) when widgets or dashboards have outstanding updates.
 *
 * Surfaces both categories side-by-side so the user sees the full
 * picture without drilling into Settings → Widgets / Dashboards.
 * "Update widgets now" routes through the same updatePackages batch
 * the WidgetsSection uses; dashboards just deep-link into their
 * settings panel (the dashboard update flow is more involved than a
 * single button press and lives in DashboardsSection).
 *
 * UX:
 *   - "isChecking" state shows a spinner so the user knows we're
 *     actively looking (vs. a stale "no updates" state).
 *   - "no updates" state confirms the app is current — appears when
 *     the user manually triggers a check, never auto-pops.
 *   - "updates found" state lists each widget package + dashboard
 *     with version transitions, and offers actions.
 *
 * Props:
 *   - isOpen / setIsOpen — controlled visibility (matches Modal contract).
 *   - widgetUpdates — array from useAppUpdates.widgetUpdates.
 *   - dashboardUpdates — array from useAppUpdates.dashboardUpdates.
 *   - isChecking — boolean from useAppUpdates.isChecking.
 *   - hasChecked — boolean, true once at least one check has settled.
 *   - onUpdateWidgets — () => Promise — fires the widget batch update.
 *   - onOpenDashboardSettings — () => void — closes this modal and
 *     opens the dashboards settings panel (so the user can update
 *     dashboards via the existing flow).
 *   - onRemindLater — () => void — closes the modal; the caller
 *     decides whether to re-pop later (the app shell typically marks
 *     "shown for this session" so the same launch doesn't nag).
 */
export const AppUpdatesModal = ({
  isOpen,
  setIsOpen,
  widgetUpdates = [],
  dashboardUpdates = [],
  isChecking = false,
  hasChecked = false,
  onUpdateWidgets,
  onOpenDashboardSettings,
  onRemindLater,
}) => {
  const [isUpdatingWidgets, setIsUpdatingWidgets] = useState(false);
  // Last run result so the modal can show "X succeeded, Y failed"
  // after a batch instead of silently resetting the button. Without
  // this surface, a stale-auth user clicks Update, sees the button
  // bounce for 500ms, and has no idea why nothing happened.
  const [lastRunResult, setLastRunResult] = useState(null);
  const totalUpdates = widgetUpdates.length + dashboardUpdates.length;

  const handleUpdateWidgets = async () => {
    if (typeof onUpdateWidgets !== "function") return;
    setIsUpdatingWidgets(true);
    setLastRunResult(null);
    try {
      // onUpdateWidgets returns { succeeded: string[], failed: string[],
      // failedDetails?: Array<{name, error}> } from updateWidgetPackages.
      // Older callers that returned void are tolerated — lastRunResult
      // stays null and we fall back to the legacy "nothing happened
      // visibly" state.
      const result = await onUpdateWidgets();
      if (result && typeof result === "object") {
        setLastRunResult(result);
      }
    } catch (err) {
      // updateWidgetPackages catches per-row failures internally and
      // resolves with a summary; a thrown error here means something
      // catastrophic outside the per-row loop. Surface it as a single
      // "run failed" line.
      setLastRunResult({
        succeeded: [],
        failed: widgetUpdates.map((p) => p.name),
        runError: err?.message || String(err),
      });
    } finally {
      setIsUpdatingWidgets(false);
    }
  };

  const handleRemindLater = () => {
    if (typeof onRemindLater === "function") onRemindLater();
    setIsOpen(false);
  };

  // The three render modes: checking, up-to-date, or updates-available.
  // Each gets its own clear visual identity so the user reads the
  // current state in one glance.
  const renderBody = () => {
    if (isChecking && totalUpdates === 0) {
      return (
        <div
          className="flex flex-col items-center justify-center py-10 gap-3 text-gray-300"
          data-testid="app-updates-modal-checking"
        >
          <FontAwesomeIcon
            icon="spinner"
            className="text-blue-400 animate-spin h-6 w-6"
          />
          <div className="text-sm">Checking for updates…</div>
          <div className="text-xs text-gray-500">
            Looking up widget packages and dashboards in the registry.
          </div>
        </div>
      );
    }

    if (hasChecked && totalUpdates === 0) {
      return (
        <div
          className="flex flex-col items-center justify-center py-10 gap-3 text-gray-300"
          data-testid="app-updates-modal-uptodate"
        >
          <FontAwesomeIcon
            icon="circle-check"
            className="text-emerald-400 h-8 w-8"
          />
          <div className="text-sm font-medium">You're all up to date.</div>
          <div className="text-xs text-gray-500">
            Every installed widget package and dashboard is on the latest
            registry version.
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {lastRunResult && (
          <div
            className={
              lastRunResult.failed.length === 0
                ? "px-3 py-2 rounded border border-emerald-700 bg-emerald-900/30 text-xs text-emerald-200"
                : "px-3 py-2 rounded border border-red-700 bg-red-900/30 text-xs text-red-200"
            }
            data-testid="app-updates-modal-run-result"
          >
            <div className="font-medium">
              {lastRunResult.failed.length === 0
                ? `Updated ${lastRunResult.succeeded.length} package${lastRunResult.succeeded.length === 1 ? "" : "s"}.`
                : `Updated ${lastRunResult.succeeded.length} of ${lastRunResult.succeeded.length + lastRunResult.failed.length}; ${lastRunResult.failed.length} failed.`}
            </div>
            {lastRunResult.runError && (
              <div className="opacity-80 mt-1">{lastRunResult.runError}</div>
            )}
            {!lastRunResult.runError && lastRunResult.failed.length > 0 && (
              <div className="opacity-80 mt-1">
                Most common cause: registry token expired. Open Settings →
                Account to sign back in, then retry.
              </div>
            )}
          </div>
        )}
        {widgetUpdates.length > 0 && (
          <div data-testid="app-updates-modal-widgets-section">
            <div className="flex items-center gap-2 px-1 mb-2 text-xs uppercase tracking-wide text-gray-400">
              <FontAwesomeIcon icon="puzzle-piece" className="text-xs" />
              <span>Widget packages ({widgetUpdates.length})</span>
            </div>
            <div className="flex flex-col rounded border border-gray-700 bg-gray-800 max-h-64 overflow-y-auto">
              {widgetUpdates.map((pkg) => (
                <div
                  key={pkg.name}
                  className="flex items-center justify-between px-3 py-2 border-b border-gray-700 last:border-b-0"
                  data-testid={`app-updates-modal-widget-row-${pkg.name}`}
                >
                  <span className="text-sm text-gray-200 truncate flex-1 min-w-0">
                    {pkg.name}
                  </span>
                  <span className="text-xs text-gray-500 font-mono shrink-0 ml-2">
                    {pkg.currentVersion || "?"} → {pkg.latestVersion || "?"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {dashboardUpdates.length > 0 && (
          <div data-testid="app-updates-modal-dashboards-section">
            <div className="flex items-center gap-2 px-1 mb-2 text-xs uppercase tracking-wide text-gray-400">
              <FontAwesomeIcon icon="grip" className="text-xs" />
              <span>Dashboards ({dashboardUpdates.length})</span>
            </div>
            <div className="flex flex-col rounded border border-gray-700 bg-gray-800 max-h-64 overflow-y-auto">
              {dashboardUpdates.map((d, i) => (
                <div
                  key={d.name || d.packageName || i}
                  className="flex items-center justify-between px-3 py-2 border-b border-gray-700 last:border-b-0"
                  data-testid={`app-updates-modal-dashboard-row-${d.name || d.packageName || i}`}
                >
                  <span className="text-sm text-gray-200 truncate flex-1 min-w-0">
                    {d.name || d.packageName || "(unnamed)"}
                  </span>
                  <span className="text-xs text-gray-500 font-mono shrink-0 ml-2">
                    {d.installedVersion || "?"} → {d.latestVersion || "?"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Footer adapts to state: checking → only "Cancel"; up-to-date →
  // "Close"; updates-found → "Remind me later" + per-category action
  // buttons.
  const renderFooter = () => {
    if (isChecking && totalUpdates === 0) {
      return (
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          disabled={isUpdatingWidgets}
          className={secondaryBtnClass}
        >
          Cancel
        </button>
      );
    }
    if (hasChecked && totalUpdates === 0) {
      return (
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className={primaryBtnClass}
        >
          Close
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleRemindLater}
          disabled={isUpdatingWidgets}
          className={secondaryBtnClass}
        >
          Remind me later
        </button>
        {dashboardUpdates.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              if (typeof onOpenDashboardSettings === "function") {
                onOpenDashboardSettings();
              }
            }}
            disabled={isUpdatingWidgets}
            className={secondaryBtnClass}
          >
            View dashboards
          </button>
        )}
        {widgetUpdates.length > 0 && (
          <button
            type="button"
            onClick={handleUpdateWidgets}
            disabled={isUpdatingWidgets}
            className={primaryBtnClass}
          >
            {isUpdatingWidgets
              ? "Updating…"
              : `Update ${widgetUpdates.length} widget${widgetUpdates.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} setIsOpen={setIsOpen}>
      {/* dash-react's Modal wraps children in an ~83% width container;
          mx-auto + max-w-xl recenters this narrower dialog inside it.
          Same pattern UpdateAllWidgetsModal uses. */}
      <div
        className="flex flex-col w-full max-w-xl mx-auto border border-gray-700 rounded bg-gray-900"
        data-testid="app-updates-modal"
      >
        <div className="px-5 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2 text-base font-semibold text-gray-100">
            <FontAwesomeIcon
              icon={
                isChecking && totalUpdates === 0
                  ? "spinner"
                  : hasChecked && totalUpdates === 0
                    ? "circle-check"
                    : "arrow-up"
              }
              className={
                isChecking && totalUpdates === 0
                  ? "text-blue-400 animate-spin"
                  : hasChecked && totalUpdates === 0
                    ? "text-emerald-400"
                    : "text-blue-400"
              }
            />
            <span>
              {isChecking && totalUpdates === 0
                ? "Checking for updates"
                : hasChecked && totalUpdates === 0
                  ? "Up to date"
                  : `${totalUpdates} update${totalUpdates === 1 ? "" : "s"} available`}
            </span>
          </div>
          {totalUpdates > 0 && (
            <div className="text-xs text-gray-400 mt-1">
              {widgetUpdates.length > 0 && dashboardUpdates.length > 0
                ? `${widgetUpdates.length} widget package${widgetUpdates.length === 1 ? "" : "s"} and ${dashboardUpdates.length} dashboard${dashboardUpdates.length === 1 ? "" : "s"} have newer versions on the registry.`
                : widgetUpdates.length > 0
                  ? `${widgetUpdates.length} widget package${widgetUpdates.length === 1 ? "" : "s"} have newer versions on the registry.`
                  : `${dashboardUpdates.length} dashboard${dashboardUpdates.length === 1 ? "" : "s"} have newer versions on the registry.`}
            </div>
          )}
        </div>

        <div className="px-5 py-4">{renderBody()}</div>

        <div className="flex items-center justify-end px-5 py-3 border-t border-gray-700">
          {renderFooter()}
        </div>
      </div>
    </Modal>
  );
};

export default AppUpdatesModal;
