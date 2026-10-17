import { useCallback, useState } from "react";
import { cleanIpcError } from "../../utils/errorUtils";

/**
 * useWidgetInstall — install a widget from a ZIP or load a folder of widgets,
 * with the progress modal's state and the result to show (app-navigation PRD
 * NAV-008). Moved from the old Settings › Widgets section.
 *
 * @param {Function} refresh  re-reads the installed widgets afterwards
 */
const CLOSED = { open: false, complete: false, widgets: [] };

const failAll = (prev, err) => ({
  open: true,
  complete: true,
  action: prev.action,
  widgets: prev.widgets.map((w) => ({
    ...w,
    status: "failed",
    error: cleanIpcError(err.message),
  })),
});

export function useWidgetInstall(refresh) {
  const [progress, setProgress] = useState(CLOSED);
  const [result, setResult] = useState(null);
  // A ZIP whose package is installed already: { name, filepath } until the
  // user says whether to replace it (consolidation Phase 1a-2).
  const [replace, setReplace] = useState(null);

  const install = useCallback(
    async (name, filepath) => {
      const api = window.mainApi;
      let widgetName = name;
      const item = { packageName: name, displayName: name };
      try {
        setProgress({
          open: true,
          complete: false,
          widgets: [{ ...item, status: "downloading" }],
        });
        const installed = await api.widgets.installLocal(name, filepath);
        if (installed && typeof installed.installedAs === "string") {
          widgetName = installed.installedAs;
        }
        if (refresh) await refresh();
        setProgress({
          open: true,
          complete: true,
          widgets: [
            {
              packageName: widgetName,
              displayName: widgetName,
              status: "installed",
            },
          ],
        });
        setResult({
          status: "success",
          message: `Widget "${widgetName}" installed successfully.`,
        });
      } catch (err) {
        setProgress((prev) => failAll(prev, err));
        setResult({
          status: "error",
          message:
            cleanIpcError(err.message) || "Failed to install widget from ZIP.",
        });
      }
    },
    [refresh],
  );

  const installFromZip = useCallback(async () => {
    const api = window.mainApi;
    if (!api || !api.dialog) return;
    let filepath = null;
    try {
      filepath = await api.dialog.chooseFile(true, ["zip"]);
      if (!filepath) return;
      // The package names itself (dash.json / package.json), the file's
      // name only as a fallback.
      const filename = filepath.split("/").pop() || filepath;
      const seen = api.widgets.inspectLocal
        ? await api.widgets.inspectLocal(filepath)
        : { name: filename.replace(/\.zip$/i, ""), installed: false };
      if (seen.installed) {
        setReplace({ name: seen.name, filepath });
        return;
      }
      await install(seen.name, filepath);
    } catch (err) {
      const name = (filepath || "").split("/").pop() || "Widget";
      setProgress({
        open: true,
        complete: true,
        widgets: [
          {
            packageName: name,
            displayName: name,
            status: "failed",
            error: cleanIpcError(err.message),
          },
        ],
      });
      setResult({
        status: "error",
        message:
          cleanIpcError(err.message) || "Failed to install widget from ZIP.",
      });
    }
  }, [install]);

  const confirmReplace = useCallback(async () => {
    const pending = replace;
    setReplace(null);
    if (pending) await install(pending.name, pending.filepath);
  }, [replace, install]);

  const cancelReplace = useCallback(() => setReplace(null), []);

  const loadFolder = useCallback(async () => {
    const api = window.mainApi;
    if (!api || !api.dialog) return;
    try {
      const folderPath = await api.dialog.chooseFile(false);
      if (!folderPath) return;
      setProgress({
        open: true,
        complete: false,
        action: "load",
        widgets: [
          {
            packageName: "folder",
            displayName: "Loading folder...",
            status: "downloading",
          },
        ],
      });
      const loaded = await api.widgets.loadFolder(folderPath);
      // { widgets, skipped, refused, refusedReasons } over IPC (an array
      // with those properties from older builds and tests).
      const results = Array.isArray(loaded)
        ? loaded
        : Object.assign([...((loaded && loaded.widgets) || [])], {
            skipped: (loaded && loaded.skipped) || 0,
            refused: (loaded && loaded.refused) || [],
            refusedReasons: (loaded && loaded.refusedReasons) || {},
          });
      if (refresh) await refresh();

      const count = Array.isArray(results) ? results.length : 0;
      const isSingle = count === 1 && results[0]?.mode === "single";
      // Packages that didn't pass the install gate, with the reason.
      const refused = Array.isArray(results?.refused) ? results.refused : [];
      const reasons = results?.refusedReasons || {};
      const skipped = Math.max(0, (results?.skipped || 0) - refused.length);
      const refusedRows = refused.map((name) => ({
        packageName: name,
        displayName: name,
        status: "failed",
        error: reasons[name] || "It didn't pass its checks.",
      }));
      setProgress({
        open: true,
        complete: true,
        action: "load",
        widgets:
          count > 0 || refusedRows.length
            ? [
                ...results.map((r) => ({
                  packageName: r.name || "widget",
                  displayName: r.displayName || r.name || "Widget",
                  status: "installed",
                })),
                ...refusedRows,
              ]
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
        if (refused.length) {
          message += ` ${refused.length} didn't pass ${refused.length !== 1 ? "their" : "its"} checks — see why above.`;
        }
      } else if (refused.length) {
        message = `Nothing was loaded — ${refused.length} package${
          refused.length !== 1 ? "s" : ""
        } didn't pass ${refused.length !== 1 ? "their" : "its"} checks. See why above.`;
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
        message:
          cleanIpcError(err.message) || "Failed to load widgets from folder.",
      });
    }
  }, [refresh]);

  return {
    progress,
    result,
    replace,
    confirmReplace,
    cancelReplace,
    installFromZip,
    loadFolder,
    closeProgress: useCallback(() => setProgress(CLOSED), []),
    clearResult: useCallback(() => setResult(null), []),
  };
}
