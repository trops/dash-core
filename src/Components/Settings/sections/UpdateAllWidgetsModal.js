import React, { useState, useEffect, useMemo, useRef } from "react";
import { Modal, Button } from "@trops/dash-react";

/**
 * UpdateAllWidgetsModal
 *
 * Batch update flow for installed widget packages. Surfaces every
 * package with an available update in a checkbox list, defaults
 * everything to selected, and lets the user deselect anything they
 * want to skip. Confirming fires the update sequentially through
 * `updatePackages` and renders per-row pending/in-progress/done/failed
 * pips so a 14-package run isn't a black box.
 *
 * Why packages (not widgets):
 *   The registry install API is package-level — one install replaces
 *   every widget in that package. Showing widget-level checkboxes
 *   would be misleading (deselecting a sibling widget wouldn't actually
 *   exclude it from the install). The disclosure list under each
 *   package row shows the widget names that ride along so the user
 *   sees exactly what each package update brings.
 *
 * Props:
 *   - isOpen / setIsOpen: controlled visibility (matches Modal contract).
 *   - packages: Array<{name, currentVersion, latestVersion, widgetNames}>
 *     from useWidgetUpdates().packagesWithUpdates.
 *   - batchStatus: Map<packageName, {status, error?}> from
 *     useWidgetUpdates().batchStatus.
 *   - isBatchUpdating: boolean — true while updatePackages is in flight.
 *   - onConfirm: (selectedPackageNames) => Promise<{succeeded, failed}>.
 *     The caller (WidgetsSection) wires this to updatePackages.
 */
export const UpdateAllWidgetsModal = ({
  isOpen,
  setIsOpen,
  packages = [],
  batchStatus = new Map(),
  isBatchUpdating = false,
  onConfirm,
}) => {
  // Selection state — Set of package names. Default: every package
  // selected on open. Re-seeded each time the modal re-opens so the
  // user gets a fresh "everything checked" state if they cancelled
  // a partial selection earlier.
  const [selected, setSelected] = useState(() => new Set());
  const [hasRun, setHasRun] = useState(false);

  // Snapshot the packages list at open-time. Rationale: the live
  // `packages` prop shrinks during the batch run (each successful
  // install removes its entry from the updates Map → packagesWithUpdates
  // derives to a shorter list). Without the snapshot the UI would
  // (a) reset hasRun whenever the prop changes (re-firing the
  // useEffect below), causing the "Update N packages" button to come
  // back AFTER the batch finished, and (b) yank package rows out
  // mid-run so the user can't see what just succeeded. The snapshot
  // freezes the display until the modal is closed and re-opened.
  const [snapshotPackages, setSnapshotPackages] = useState([]);

  // Track open transitions explicitly so the seed effect only fires
  // when the modal goes from closed → open. Using `isOpen` directly in
  // a useEffect dep doesn't distinguish that transition from
  // mid-render `isOpen=true` re-runs caused by other state changes
  // (e.g. parent re-render).
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      // Just opened — seed snapshot + selection + run state.
      setSnapshotPackages(packages);
      setSelected(new Set(packages.map((p) => p.name)));
      setHasRun(false);
    }
    prevIsOpenRef.current = isOpen;
    // packages is read here but intentionally NOT in the dep list —
    // we only re-seed on open transitions, never when packages
    // changes underneath us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Everything from here on reads `snapshotPackages` (not `packages`)
  // so the UI is frozen for the duration of the modal session.
  const allSelected = useMemo(
    () =>
      snapshotPackages.length > 0 && selected.size === snapshotPackages.length,
    [snapshotPackages, selected],
  );
  const noneSelected = selected.size === 0;

  const toggle = (name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () =>
    setSelected(new Set(snapshotPackages.map((p) => p.name)));
  const deselectAll = () => setSelected(new Set());

  const handleConfirm = async () => {
    if (noneSelected || isBatchUpdating || typeof onConfirm !== "function") {
      return;
    }
    setHasRun(true);
    await onConfirm(Array.from(selected));
    // Leave the modal open after the batch so the user can read the
    // per-row results. They close it with the Done/Close button below.
  };

  // Summary of the run for the footer line — only shown after a run
  // has completed. Counts succeeded vs failed by walking batchStatus.
  const runSummary = useMemo(() => {
    if (!hasRun || isBatchUpdating) return null;
    let done = 0;
    let failed = 0;
    for (const [, info] of batchStatus) {
      if (info.status === "done") done += 1;
      if (info.status === "failed") failed += 1;
    }
    return { done, failed };
  }, [hasRun, isBatchUpdating, batchStatus]);

  // Per-row status pip. Five visual states: not-in-batch (no pip),
  // pending (dim circle), in-progress (spinning dot), done (green
  // check), failed (red x with tooltip on the error string).
  const renderStatusPip = (name) => {
    const info = batchStatus.get(name);
    if (!info) return null;
    if (info.status === "pending") {
      return (
        <span
          className="text-xs text-gray-500 ml-2"
          data-testid={`update-all-status-${name}-pending`}
        >
          pending
        </span>
      );
    }
    if (info.status === "in-progress") {
      return (
        <span
          className="text-xs text-blue-400 ml-2 animate-pulse"
          data-testid={`update-all-status-${name}-in-progress`}
        >
          updating…
        </span>
      );
    }
    if (info.status === "done") {
      return (
        <span
          className="text-xs text-emerald-400 ml-2"
          data-testid={`update-all-status-${name}-done`}
        >
          ✓ done
        </span>
      );
    }
    if (info.status === "failed") {
      return (
        <span
          className="text-xs text-red-400 ml-2"
          title={info.error || "Update failed"}
          data-testid={`update-all-status-${name}-failed`}
        >
          ✕ failed
        </span>
      );
    }
    return null;
  };

  return (
    <Modal isOpen={isOpen} setIsOpen={setIsOpen}>
      {/* dash-react's Modal claims ~83% of the viewport for its
          wrapper; add mx-auto so this narrower dialog centers
          horizontally inside that wider container instead of hugging
          the left edge. max-w-xl keeps the dialog dialog-sized. */}
      <div
        className="flex flex-col w-full max-w-xl mx-auto border border-gray-700 rounded bg-gray-900"
        data-testid="update-all-widgets-modal"
      >
        <div className="px-5 py-4 border-b border-gray-700">
          <div className="text-base font-semibold text-gray-100">
            Update widget packages
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {snapshotPackages.length} package
            {snapshotPackages.length === 1 ? "" : "s"} have updates available.
            Deselect anything you want to skip. Updates run sequentially — you
            can keep using other parts of the app.
          </div>
        </div>

        {/* Select-all controls. Visually paired with the count so the
            user reads "Selected 14 of 14 · [Select all] [Deselect all]". */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-gray-700/60 text-xs text-gray-400">
          <span data-testid="update-all-selected-count">
            Selected {selected.size} of {snapshotPackages.length}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={selectAll}
              disabled={allSelected || isBatchUpdating}
              className="text-blue-400 hover:text-blue-300 disabled:text-gray-600 disabled:cursor-not-allowed"
              data-testid="update-all-select-all"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={deselectAll}
              disabled={noneSelected || isBatchUpdating}
              className="text-blue-400 hover:text-blue-300 disabled:text-gray-600 disabled:cursor-not-allowed"
              data-testid="update-all-deselect-all"
            >
              Deselect all
            </button>
          </div>
        </div>

        <div
          className="flex flex-col max-h-96 overflow-y-auto"
          data-testid="update-all-package-list"
        >
          {snapshotPackages.length === 0 ? (
            <div className="px-5 py-6 text-xs text-gray-500 italic text-center">
              No package updates available.
            </div>
          ) : (
            snapshotPackages.map((pkg) => {
              const isChecked = selected.has(pkg.name);
              return (
                <label
                  key={pkg.name}
                  className="flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-gray-800 border-b border-gray-800"
                  data-testid={`update-all-package-row-${pkg.name}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(pkg.name)}
                    disabled={isBatchUpdating}
                    className="mt-0.5"
                    data-testid={`update-all-checkbox-${pkg.name}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-200 font-medium truncate">
                        {pkg.name}
                      </span>
                      <span className="text-xs text-gray-500 font-mono shrink-0">
                        {pkg.currentVersion || "?"} → {pkg.latestVersion || "?"}
                      </span>
                    </div>
                    {pkg.widgetNames && pkg.widgetNames.length > 0 && (
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        Includes: {pkg.widgetNames.slice(0, 4).join(", ")}
                        {pkg.widgetNames.length > 4
                          ? ` +${pkg.widgetNames.length - 4} more`
                          : ""}
                      </div>
                    )}
                    {renderStatusPip(pkg.name)}
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700">
          <div className="text-xs text-gray-500">
            {runSummary &&
              `Run complete: ${runSummary.done} succeeded, ${runSummary.failed} failed.`}
            {isBatchUpdating && "Updating selected packages…"}
          </div>
          <div className="flex gap-2">
            <Button
              title={hasRun && !isBatchUpdating ? "Close" : "Cancel"}
              onClick={() => setIsOpen(false)}
              disabled={isBatchUpdating}
            />
            {!hasRun && (
              <Button
                title={
                  isBatchUpdating
                    ? "Updating…"
                    : `Update ${selected.size} package${
                        selected.size === 1 ? "" : "s"
                      }`
                }
                onClick={handleConfirm}
                disabled={noneSelected || isBatchUpdating}
              />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default UpdateAllWidgetsModal;
