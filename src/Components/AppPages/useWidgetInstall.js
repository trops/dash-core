import { useCallback, useState } from "react";

/**
 * useWidgetInstall — install a widget from a ZIP or load a folder of widgets,
 * with the progress modal's state and the result to show (app-navigation PRD
 * NAV-008). Moved from WidgetsSection so the Widgets page can use it.
 *
 * @param {Function} refresh  re-reads the installed widgets afterwards
 */
const CLOSED = { open: false, complete: false, widgets: [] };

const failAll = (prev, err) => ({
  open: true,
  complete: true,
  widgets: prev.widgets.map((w) => ({
    ...w,
    status: "failed",
    error: err.message,
  })),
});

export function useWidgetInstall(refresh) {
  const [progress, setProgress] = useState(CLOSED);
  const [result, setResult] = useState(null);

  const installFromZip = useCallback(async () => {
    const api = window.mainApi;
    if (!api || !api.dialog) return;
    let widgetName = null;
    try {
      const filepath = await api.dialog.chooseFile(true, ["zip"]);
      if (!filepath) return;
      // "weather.zip" → "weather"
      const filename = filepath.split("/").pop() || filepath;
      widgetName = filename.replace(/\.zip$/i, "");
      const item = { packageName: widgetName, displayName: widgetName };
      setProgress({
        open: true,
        complete: false,
        widgets: [{ ...item, status: "downloading" }],
      });
      await api.widgets.installLocal(widgetName, filepath);
      if (refresh) await refresh();
      setProgress({
        open: true,
        complete: true,
        widgets: [{ ...item, status: "installed" }],
      });
      setResult({
        status: "success",
        message: `Widget "${widgetName}" installed successfully.`,
      });
    } catch (err) {
      setProgress((prev) => failAll(prev, err));
      setResult({
        status: "error",
        message: err.message || "Failed to install widget from ZIP.",
      });
    }
  }, [refresh]);

  const loadFolder = useCallback(async () => {
    const api = window.mainApi;
    if (!api || !api.dialog) return;
    try {
      const folderPath = await api.dialog.chooseFile(false);
      if (!folderPath) return;
      setProgress({
        open: true,
        complete: false,
        widgets: [
          {
            packageName: "folder",
            displayName: "Loading folder...",
            status: "downloading",
          },
        ],
      });
      const results = await api.widgets.loadFolder(folderPath);
      if (refresh) await refresh();

      const count = Array.isArray(results) ? results.length : 0;
      const isSingle = count === 1 && results[0]?.mode === "single";
      const skipped = results?.skipped || 0;
      setProgress({
        open: true,
        complete: true,
        widgets:
          count > 0
            ? results.map((r) => ({
                packageName: r.name || "widget",
                displayName: r.displayName || r.name || "Widget",
                status: "installed",
              }))
            : [
                {
                  packageName: "folder",
                  displayName: "No widgets found",
                  status: "failed",
                  error: "No widget directories found in folder.",
                },
              ],
      });

      let message;
      if (isSingle) {
        message = `Installed widget "${results[0].name}" from folder.`;
      } else if (count > 0) {
        message = `Loaded ${count} widget${count !== 1 ? "s" : ""} from folder.`;
        if (skipped > 0) {
          message += ` (${skipped} non-widget folder${
            skipped !== 1 ? "s" : ""
          } skipped)`;
        }
      } else {
        message =
          "No widgets found in the selected folder. Expected a folder containing widget subdirectories, each with a package.json or widgets/ directory.";
      }
      setResult({
        status: count > 0 ? "success" : "error",
        message,
        details: count > 0 ? results : null,
      });
    } catch (err) {
      setProgress((prev) => failAll(prev, err));
      setResult({
        status: "error",
        message: err.message || "Failed to load widgets from folder.",
      });
    }
  }, [refresh]);

  return {
    progress,
    result,
    installFromZip,
    loadFolder,
    closeProgress: useCallback(() => setProgress(CLOSED), []),
    clearResult: useCallback(() => setResult(null), []),
  };
}
