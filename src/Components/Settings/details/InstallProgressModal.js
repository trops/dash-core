import React, { useContext } from "react";
import {
  Modal,
  Button,
  ThemeContext,
  FontAwesomeIcon,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";

/**
 * InstallProgressModal — non-dismissible modal showing per-widget install progress.
 *
 * Props:
 *   isOpen       — whether modal is visible
 *   setIsOpen    — close handler (no-op while installing)
 *   widgets      — array of { packageName, displayName, status, error? }
 *   isComplete   — true when all widgets have a terminal status
 *   onDone       — called when user clicks Done
 */
export const InstallProgressModal = ({
  isOpen,
  setIsOpen,
  widgets = [],
  isComplete = false,
  onDone,
  onCancel = null,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const doneCount = widgets.filter(
    (w) =>
      w.status === "installed" ||
      w.status === "already-installed" ||
      w.status === "failed",
  ).length;

  function statusIcon(status, item) {
    switch (status) {
      case "downloading":
        return (
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400 flex-shrink-0" />
        );
      case "installed":
      case "already-installed":
        return (
          <FontAwesomeIcon
            icon={item?.type === "theme" ? "palette" : "circle-check"}
            className="h-4 w-4 text-green-400 flex-shrink-0"
          />
        );
      case "failed":
        return (
          <FontAwesomeIcon
            icon="circle-xmark"
            className="h-4 w-4 text-red-400 flex-shrink-0"
          />
        );
      default:
        // pending
        return (
          <FontAwesomeIcon
            icon="clock"
            className="h-4 w-4 opacity-30 flex-shrink-0"
          />
        );
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      width="w-[440px]"
      height="auto"
    >
      <div
        className={`flex flex-col rounded-lg overflow-hidden ${panelStyles.backgroundColor || "bg-gray-900"} ${panelStyles.textColor || "text-gray-200"}`}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold">
            {isComplete
              ? "Installation Complete"
              : `Installing ${doneCount + 1} of ${widgets.length}...`}
          </h3>
        </div>

        {/* Widget list */}
        <div className="px-5 pb-3 space-y-1.5 max-h-64 overflow-y-auto">
          {widgets.map((w, idx) => (
            <div key={idx}>
              <div
                className={`flex items-center gap-2.5 p-2 rounded ${currentTheme["bg-primary-medium"] || "bg-white/5"}`}
              >
                {statusIcon(w.status, w)}
                <span className="text-sm flex-1 truncate">{w.displayName}</span>
                <span className="text-[10px] opacity-40">
                  {w.status === "already-installed"
                    ? "Already installed"
                    : w.status === "downloading"
                      ? "Downloading..."
                      : w.status === "installed"
                        ? "Installed"
                        : w.status === "failed"
                          ? "Failed"
                          : "Pending"}
                </span>
              </div>
              {w.status === "failed" && w.error && (
                <p className="text-[10px] text-red-400/80 mt-0.5 ml-7 truncate">
                  {w.error}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-between px-5 py-3 border-t ${currentTheme["border-primary-medium"] || "border-white/10"}`}
        >
          <div>
            {!isComplete && onCancel && (
              <button
                type="button"
                onClick={() => {
                  if (onCancel) onCancel();
                  setIsOpen(false);
                }}
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
          <Button
            title="Done"
            bgColor={isComplete ? "bg-blue-600" : "bg-gray-700"}
            hoverBackgroundColor={isComplete ? "hover:bg-blue-700" : ""}
            textSize="text-sm"
            padding="py-1.5 px-4"
            onClick={() => {
              if (isComplete && onDone) onDone();
            }}
            disabled={!isComplete}
          />
        </div>
      </div>
    </Modal>
  );
};
