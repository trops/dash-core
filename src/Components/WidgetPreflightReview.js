import React, { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@trops/dash-react";

/**
 * WidgetPreflightReview — the "Review N widgets before installing"
 * permission-consent panel shown before a batch widget update installs
 * code that requests permissions the user hasn't granted yet.
 *
 * Extracted from AppUpdatesModal so BOTH update entry points can render
 * the same consent UI bound to their own `useWidgetUpdates` instance:
 *   - AppUpdatesModal (the on-launch "updates available" prompt), and
 *   - WidgetsSection / Settings → Widgets (the batch update modal).
 *
 * Before this existed, the Settings path had no consent UI: when
 * `updatePackages` set `pendingPreflight` and suspended on its resolver,
 * nothing in the Settings tree rendered a panel or called
 * `resolvePreflight`, so the batch hung forever at "pending".
 *
 * This component renders ONLY the inner dialog content (header / body /
 * footer) — the caller wraps it in dash-react's `<Modal>`. It owns the
 * per-line checkbox state; the parent owns `pendingPreflight` (the ask)
 * and `resolvePreflight` (the decision sink). When `resolvePreflight`
 * fires, the parent hook clears `pendingPreflight`, so a Modal bound to
 * `!!pendingPreflight` closes automatically.
 *
 * Props:
 *   - pendingPreflight — the preflight blob from useWidgetUpdates:
 *     `{ widgets: [{ widgetId, displayName, packageId, missing }] }`.
 *   - resolvePreflight — (decision) => void. Approve passes
 *     `{ acceptedByWidgetId }`; Cancel passes `null`.
 */

const secondaryBtnClass =
  "px-3 py-2 text-sm font-medium rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-gray-100";
const primaryBtnClass =
  "px-3 py-2 text-sm font-medium rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white";

/**
 * Flatten a single widget's `missing` blob (output of useWidgetUpdates'
 * preflight computation) into an array of keyed lines the panel can
 * render as toggleable checkboxes.
 *
 * Each line carries `apply(acc)` that mutates an accumulator into the
 * grant-blob shape the main process accepts (server / tool / readPath /
 * writePath rows).
 */
export function flattenPreflightLines(missing) {
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

export const WidgetPreflightReview = ({
  pendingPreflight,
  resolvePreflight,
}) => {
  // Per-line checkbox state — `{ [widgetId]: { [lineKey]: bool } }`.
  // Initialized to "everything checked" on each new pendingPreflight so
  // the default action approves the full ask; the user opts OUT of
  // individual lines by unchecking.
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

  if (!pendingPreflight) return null;

  const widgets = pendingPreflight.widgets || [];
  const widgetCount = widgets.length;
  const selected =
    widgets.find((w) => w.widgetId === selectedPreflightWidgetId) || widgets[0];

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
    if (typeof resolvePreflight !== "function") return;
    // Build the per-widget addition blob from checked lines. Skip
    // widgets where the user unchecked everything.
    const acceptedByWidgetId = {};
    for (const w of widgets) {
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

  const lines = selected ? flattenPreflightLines(selected.missing) : [];

  return (
    <div
      className="flex flex-col w-full max-w-xl mx-auto border border-gray-700 rounded bg-gray-900"
      data-testid="widget-preflight-review"
    >
      <div className="px-5 py-4 border-b border-gray-700">
        <div className="flex items-center gap-2 text-base font-semibold text-gray-100">
          <FontAwesomeIcon icon="shield-halved" className="text-amber-400" />
          <span>
            Review {widgetCount} widget{widgetCount === 1 ? "" : "s"} before
            installing
          </span>
        </div>
        <div className="text-xs text-gray-400 mt-1">
          New versions request permissions you haven't granted yet. Approve what
          you're comfortable with — the rest stays denied and the install still
          goes through.
        </div>
      </div>

      <div className="px-5 py-4">
        <div
          className="flex flex-col gap-4"
          data-testid="widget-preflight-review-body"
        >
          <div className="px-3 py-2 rounded border border-amber-700 bg-amber-900/30 text-xs text-amber-200">
            These widgets need new permissions to function after the update.
            Review and approve before installing — anything you leave unchecked
            will be denied at runtime and can be granted later in Settings →
            Privacy &amp; Security.
          </div>
          {selected && (
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
                      data-testid={`widget-preflight-review-widget-${w.widgetId}`}
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
                  <span className="opacity-60 font-mono">
                    {selected.packageId}
                  </span>
                </div>
                {lines.length === 0 && (
                  <div className="text-xs text-gray-500">
                    No new permissions for this widget.
                  </div>
                )}
                {lines.map((ln) => {
                  const isChecked =
                    !!preflightChecked[selected.widgetId]?.[ln.key];
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
          )}
        </div>
      </div>

      <div className="flex items-center justify-end px-5 py-3 border-t border-gray-700">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePreflightCancel}
            className={secondaryBtnClass}
            data-testid="widget-preflight-review-cancel"
          >
            Cancel update
          </button>
          <button
            type="button"
            onClick={handlePreflightApprove}
            className={primaryBtnClass}
            data-testid="widget-preflight-review-approve"
          >
            Approve and install
            {widgetCount > 0 ? ` (${widgetCount})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WidgetPreflightReview;
