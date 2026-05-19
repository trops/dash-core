import React, { useState, useEffect } from "react";
import { Modal, FontAwesomeIcon } from "@trops/dash-react";
import { useRegistryAuth } from "../hooks/useRegistryAuth";

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
 * Flatten a single widget's `missing` blob (output of useWidgetUpdates'
 * preflight computation) into an array of keyed lines the modal can
 * render as toggleable checkboxes.
 *
 * Each line carries `apply(acc)` that mutates an accumulator into the
 * grant-blob shape the main process accepts. Mirrors the shape
 * PreflightConsentModal uses for the dashboard-load case so the modal
 * UX stays consistent (server / tool / readPath / writePath rows).
 */
function flattenPreflightLines(missing) {
  const lines = [];
  if (!missing || !missing.servers) return lines;
  for (const [serverName, perms] of Object.entries(missing.servers)) {
    for (const tool of perms.tools || []) {
      lines.push({
        key: `mcp:${serverName}:tool:${tool}`,
        label: `Call ${tool} on ${serverName}`,
        apply: (acc) => {
          acc.servers = acc.servers || {};
          acc.servers[serverName] = acc.servers[serverName] || {
            tools: [],
            readPaths: [],
            writePaths: [],
          };
          acc.servers[serverName].tools.push(tool);
        },
      });
    }
    for (const p of perms.readPaths || []) {
      lines.push({
        key: `mcp:${serverName}:readPath:${p}`,
        label: `Read files at ${p} (${serverName})`,
        apply: (acc) => {
          acc.servers = acc.servers || {};
          acc.servers[serverName] = acc.servers[serverName] || {
            tools: [],
            readPaths: [],
            writePaths: [],
          };
          acc.servers[serverName].readPaths.push(p);
        },
      });
    }
    for (const p of perms.writePaths || []) {
      lines.push({
        key: `mcp:${serverName}:writePath:${p}`,
        label: `Write files at ${p} (${serverName})`,
        apply: (acc) => {
          acc.servers = acc.servers || {};
          acc.servers[serverName] = acc.servers[serverName] || {
            tools: [],
            readPaths: [],
            writePaths: [],
          };
          acc.servers[serverName].writePaths.push(p);
        },
      });
    }
  }
  return lines;
}

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
  needsAuth = false,
  pendingPreflight = null,
  resolvePreflight,
  onUpdateWidgets,
  onOpenDashboardSettings,
  onRemindLater,
  onAuthenticated,
}) => {
  const [isUpdatingWidgets, setIsUpdatingWidgets] = useState(false);
  // Last run result so the modal can show "X succeeded, Y failed"
  // after a batch instead of silently resetting the button. Without
  // this surface, a stale-auth user clicks Update, sees the button
  // bounce for 500ms, and has no idea why nothing happened.
  const [lastRunResult, setLastRunResult] = useState(null);
  // Direct device-code OAuth flow — clicking the footer "Sign in"
  // button opens the system browser straight to the verification URL.
  // Auth status is checked PROACTIVELY when the modal opens so the
  // footer button reads "Sign in to Registry" (not "Update N widgets")
  // before the user clicks anything when they're signed out. Saves a
  // round-trip vs. the previous "click Update → fail → click Sign in"
  // dance.
  const {
    isAuthenticated,
    isAuthenticating,
    authFlow,
    authError,
    checkAuth,
    initiateAuth,
    cancelAuth,
  } = useRegistryAuth();
  // hasCheckedAuth gates the "Sign in to Registry" CTA so we don't
  // flash it for a single frame while the initial getStatus is still
  // in flight (isAuthenticated starts as false). The button only
  // shows once we've actually heard back.
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    checkAuth().finally(() => {
      if (!cancelled) setHasCheckedAuth(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, checkAuth]);

  // Reset transient per-session UI state when the modal closes so a
  // re-open starts fresh: the previous run's "Updated N packages"
  // banner shouldn't carry over to a manual re-check.
  useEffect(() => {
    if (isOpen) return;
    setLastRunResult(null);
    setIsUpdatingWidgets(false);
    setPreflightChecked({});
    setSelectedPreflightWidgetId(null);
  }, [isOpen]);

  // Preflight checkbox state — `{ [widgetId]: { [lineKey]: bool } }`.
  // Initialized to "everything checked" on each new pendingPreflight
  // so the default action approves the full ask; the user opts OUT of
  // individual lines by unchecking. Mirror of how
  // PreflightConsentModal seeds its checks.
  const [preflightChecked, setPreflightChecked] = useState({});
  const [selectedPreflightWidgetId, setSelectedPreflightWidgetId] =
    useState(null);
  useEffect(() => {
    if (!pendingPreflight || !pendingPreflight.widgets?.length) return;
    const initial = {};
    for (const w of pendingPreflight.widgets) {
      initial[w.widgetId] = {};
      for (const ln of flattenPreflightLines(w.missing)) {
        initial[w.widgetId][ln.key] = true;
      }
    }
    setPreflightChecked(initial);
    setSelectedPreflightWidgetId(pendingPreflight.widgets[0].widgetId);
  }, [pendingPreflight]);

  const totalUpdates = widgetUpdates.length + dashboardUpdates.length;
  // Single source of truth for "user needs to sign in before we can
  // run the batch": either the proactive check found no session, or
  // the parent hook flipped needsAuth (rare — only happens if auth
  // expired between mount and the user clicking Update).
  const needsSignIn = hasCheckedAuth && (!isAuthenticated || needsAuth);

  const handleSignIn = () => {
    initiateAuth(() => {
      // Successful auth: clear the failure banner and tell the parent
      // hook to drop its needsAuth flag so the user can immediately
      // retry the Update button.
      setLastRunResult(null);
      if (typeof onAuthenticated === "function") onAuthenticated();
    });
  };

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

  // --- Preflight handlers ---
  const togglePreflightLine = (widgetId, lineKey) => {
    setPreflightChecked((prev) => ({
      ...prev,
      [widgetId]: {
        ...(prev[widgetId] || {}),
        [lineKey]: !(prev[widgetId] && prev[widgetId][lineKey]),
      },
    }));
  };

  const handlePreflightApprove = () => {
    if (typeof resolvePreflight !== "function" || !pendingPreflight) return;
    // Build the per-widget addition blob from checked lines. Skip
    // widgets where the user unchecked everything (mergeMcpGrants
    // would no-op them anyway, but explicit is cheaper than
    // mysterious).
    const acceptedByWidgetId = {};
    for (const w of pendingPreflight.widgets) {
      const lines = flattenPreflightLines(w.missing);
      const acc = {};
      let any = false;
      for (const ln of lines) {
        if (preflightChecked[w.widgetId]?.[ln.key]) {
          ln.apply(acc);
          any = true;
        }
      }
      if (any) acceptedByWidgetId[w.widgetId] = acc;
    }
    resolvePreflight({ acceptedByWidgetId });
  };

  const handlePreflightCancel = () => {
    if (typeof resolvePreflight !== "function") return;
    resolvePreflight(null);
  };

  // The three render modes: checking, up-to-date, or updates-available.
  // Each gets its own clear visual identity so the user reads the
  // current state in one glance. The result banner (set after a
  // batch run) renders ABOVE whichever state the modal is in — a
  // successful run naturally transitions to up-to-date, and we want
  // the user to see "Updated N packages" + the up-to-date message.
  const renderResultBanner = () => {
    if (!lastRunResult) return null;
    return (
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
        {/* Per-package failure detail. Without this the user sees
            "X failed" with no clue what went wrong (verify mismatch,
            stale auth, network error all look identical from this
            distance). Each failure renders its own line with the
            actual error message returned by updateWidget. */}
        {Array.isArray(lastRunResult.failedDetails) &&
          lastRunResult.failedDetails.length > 0 && (
            <ul
              className="mt-2 space-y-1 list-disc list-inside"
              data-testid="app-updates-modal-run-result-details"
            >
              {lastRunResult.failedDetails.map((d) => (
                <li
                  key={d.name}
                  className="opacity-90"
                  data-testid={`app-updates-modal-run-result-failed-${d.name}`}
                >
                  <span className="font-mono">{d.name}</span>: {d.error}
                </li>
              ))}
            </ul>
          )}
        {!lastRunResult.runError &&
          lastRunResult.failed.length > 0 &&
          (!Array.isArray(lastRunResult.failedDetails) ||
            lastRunResult.failedDetails.length === 0) && (
            <div className="opacity-80 mt-1">
              Some installs failed. Check the per-row status in Settings →
              Widgets and retry the affected packages.
            </div>
          )}
      </div>
    );
  };

  // While the device-code flow is in progress, render an inline
  // status banner so the user knows we're waiting on the browser tab
  // (and has a manual code fallback if the auto-open didn't fire).
  const renderAuthInProgress = () => {
    if (!isAuthenticating) return null;
    return (
      <div
        className="px-3 py-2 rounded border border-blue-700 bg-blue-900/30 text-xs text-blue-200 flex flex-col gap-1"
        data-testid="app-updates-modal-auth-in-progress"
      >
        <div className="flex items-center gap-2 font-medium">
          <FontAwesomeIcon
            icon="spinner"
            className="text-blue-300 animate-spin"
          />
          <span>Waiting for browser sign-in…</span>
        </div>
        {authFlow?.userCode && (
          <div className="opacity-80">
            If a browser tab didn't open, visit{" "}
            <span className="font-mono">
              {authFlow.verificationUrl || "the registry sign-in page"}
            </span>{" "}
            and enter code{" "}
            <span className="font-mono font-semibold">{authFlow.userCode}</span>
            .
          </div>
        )}
        {authError && <div className="text-red-300">{authError}</div>}
      </div>
    );
  };

  const renderPreflightBody = () => {
    if (!pendingPreflight) return null;
    const widgets = pendingPreflight.widgets || [];
    const selected =
      widgets.find((w) => w.widgetId === selectedPreflightWidgetId) ||
      widgets[0];
    if (!selected) return null;
    const lines = flattenPreflightLines(selected.missing);
    return (
      <div
        className="flex flex-col gap-4"
        data-testid="app-updates-modal-preflight"
      >
        <div className="px-3 py-2 rounded border border-amber-700 bg-amber-900/30 text-xs text-amber-200">
          These widgets need new permissions to function after the update.
          Review and approve before installing — anything you leave unchecked
          will be denied at runtime and can be granted later in Settings →
          Privacy &amp; Security.
        </div>
        <div className="flex border border-gray-700 rounded overflow-hidden">
          {/* Sidebar: widget list */}
          <div className="flex flex-col w-44 border-r border-gray-700 bg-gray-900/40 max-h-64 overflow-y-auto">
            {widgets.map((w) => {
              const lineCount = flattenPreflightLines(w.missing).length;
              const isActive = w.widgetId === selected.widgetId;
              return (
                <button
                  key={w.widgetId}
                  type="button"
                  onClick={() => setSelectedPreflightWidgetId(w.widgetId)}
                  className={`flex items-center justify-between gap-2 px-3 py-2 text-left text-xs border-b border-gray-800 transition-colors ${
                    isActive
                      ? "bg-blue-900/30 text-gray-100"
                      : "text-gray-300 hover:bg-gray-800/40"
                  }`}
                  data-testid={`app-updates-modal-preflight-widget-${w.widgetId}`}
                >
                  <span className="truncate">{w.displayName}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 shrink-0">
                    {lineCount}
                  </span>
                </button>
              );
            })}
          </div>
          {/* Detail: per-line checkboxes */}
          <div className="flex flex-col flex-1 min-w-0 p-3 gap-2 max-h-64 overflow-y-auto">
            <div className="text-xs text-gray-400 mb-1">
              <span className="font-semibold text-gray-200">
                {selected.displayName}
              </span>{" "}
              <span className="opacity-60 font-mono">{selected.packageId}</span>
            </div>
            {lines.length === 0 && (
              <div className="text-xs text-gray-500">
                No new permissions for this widget.
              </div>
            )}
            {lines.map((ln) => {
              const isChecked = !!preflightChecked[selected.widgetId]?.[ln.key];
              return (
                <label
                  key={ln.key}
                  className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer px-2 py-1 rounded hover:bg-gray-800/40"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() =>
                      togglePreflightLine(selected.widgetId, ln.key)
                    }
                  />
                  <span>{ln.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderBody = () => {
    if (pendingPreflight) return renderPreflightBody();
    if (isChecking && totalUpdates === 0) {
      return (
        <div className="flex flex-col gap-4">
          {renderResultBanner()}
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
        </div>
      );
    }

    if (hasChecked && totalUpdates === 0) {
      return (
        <div className="flex flex-col gap-4">
          {renderResultBanner()}
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
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {renderResultBanner()}
        {renderAuthInProgress()}
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
  // "Close"; preflight → "Cancel update" + "Approve and install";
  // updates-found → "Remind me later" + per-category action buttons.
  const renderFooter = () => {
    if (pendingPreflight) {
      const widgetCount = pendingPreflight.widgets?.length || 0;
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePreflightCancel}
            className={secondaryBtnClass}
            data-testid="app-updates-modal-preflight-cancel"
          >
            Cancel update
          </button>
          <button
            type="button"
            onClick={handlePreflightApprove}
            className={primaryBtnClass}
            data-testid="app-updates-modal-preflight-approve"
          >
            Approve and install
            {widgetCount > 0 ? ` (${widgetCount})` : ""}
          </button>
        </div>
      );
    }
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
        {widgetUpdates.length > 0 &&
          (needsSignIn ? (
            isAuthenticating ? (
              <button
                type="button"
                onClick={cancelAuth}
                className={secondaryBtnClass}
                data-testid="app-updates-modal-cancel-sign-in"
              >
                Cancel sign-in
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className={primaryBtnClass}
                data-testid="app-updates-modal-sign-in-registry"
              >
                Sign in to Registry
              </button>
            )
          ) : (
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
          ))}
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
                pendingPreflight
                  ? "shield-halved"
                  : isChecking && totalUpdates === 0
                    ? "spinner"
                    : hasChecked && totalUpdates === 0
                      ? "circle-check"
                      : "arrow-up"
              }
              className={
                pendingPreflight
                  ? "text-amber-400"
                  : isChecking && totalUpdates === 0
                    ? "text-blue-400 animate-spin"
                    : hasChecked && totalUpdates === 0
                      ? "text-emerald-400"
                      : "text-blue-400"
              }
            />
            <span>
              {pendingPreflight
                ? `Review ${pendingPreflight.widgets?.length || 0} widget${(pendingPreflight.widgets?.length || 0) === 1 ? "" : "s"} before installing`
                : isChecking && totalUpdates === 0
                  ? "Checking for updates"
                  : hasChecked && totalUpdates === 0
                    ? "Up to date"
                    : `${totalUpdates} update${totalUpdates === 1 ? "" : "s"} available`}
            </span>
          </div>
          {pendingPreflight ? (
            <div className="text-xs text-gray-400 mt-1">
              New versions request permissions you haven't granted yet. Approve
              what you're comfortable with — the rest stays denied and the
              install still goes through.
            </div>
          ) : (
            totalUpdates > 0 && (
              <div className="text-xs text-gray-400 mt-1">
                {needsSignIn && widgetUpdates.length > 0
                  ? `Sign in to the registry to install ${widgetUpdates.length} widget package update${widgetUpdates.length === 1 ? "" : "s"}.`
                  : widgetUpdates.length > 0 && dashboardUpdates.length > 0
                    ? `${widgetUpdates.length} widget package${widgetUpdates.length === 1 ? "" : "s"} and ${dashboardUpdates.length} dashboard${dashboardUpdates.length === 1 ? "" : "s"} have newer versions on the registry.`
                    : widgetUpdates.length > 0
                      ? `${widgetUpdates.length} widget package${widgetUpdates.length === 1 ? "" : "s"} have newer versions on the registry.`
                      : `${dashboardUpdates.length} dashboard${dashboardUpdates.length === 1 ? "" : "s"} have newer versions on the registry.`}
              </div>
            )
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
