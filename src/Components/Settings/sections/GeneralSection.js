import React, { useContext, useEffect, useState } from "react";
import { Switch, DataList, SubHeading3, Button } from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";

export const GeneralSection = () => {
  const appContext = useContext(AppContext);
  const debugMode = appContext?.debugMode || false;
  const credentials = appContext?.credentials || {};
  const [dataDirectory, setDataDirectory] = useState(null);

  // Export Everything (Phase 4A) — kind: "success" | "error"
  const [isExporting, setIsExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState(null);

  async function handleExportEverything() {
    if (!credentials?.appId) {
      setExportFeedback({ kind: "error", message: "No application context." });
      return;
    }
    setIsExporting(true);
    setExportFeedback(null);
    try {
      const result = await window.mainApi?.export?.exportEverything?.(
        credentials.appId,
      );
      if (result?.success) {
        setExportFeedback({
          kind: "success",
          message: `Saved to ${result.filePath}`,
        });
      } else if (result?.canceled) {
        // User dismissed the dialog — no feedback row.
      } else {
        setExportFeedback({
          kind: "error",
          message: result?.error || "Export failed.",
        });
      }
    } catch (err) {
      setExportFeedback({
        kind: "error",
        message: err?.message || "Export failed.",
      });
    } finally {
      setIsExporting(false);
    }
  }

  useEffect(() => {
    const dashApi = appContext?.dashApi;
    if (dashApi) {
      dashApi.getDataDirectory(
        (e, result) => {
          if (result?.dataDirectory) {
            setDataDirectory(result.dataDirectory);
          }
        },
        () => {},
      );
    }
  }, [appContext?.dashApi]);

  function handleToggleDebug(value) {
    if (appContext?.changeDebugMode) {
      appContext.changeDebugMode(value);
    }
  }

  function handleOpenDataDirectory() {
    if (appContext?.openDataDirectory) {
      appContext.openDataDirectory();
    }
  }

  // Settings → "Check for updates on launch" toggle. Reads from
  // appContext.settings.checkForUpdatesOnLaunch (defaulted to true
  // by SettingsModel) and writes back via changeSettings so the
  // value persists across launches. The launch-check effect in
  // AppWrapper honors this flag.
  const checkForUpdatesOnLaunch =
    appContext?.settings?.checkForUpdatesOnLaunch !== false;
  function handleToggleCheckForUpdates(value) {
    if (!appContext?.changeSettings || !appContext?.settings) return;
    appContext.changeSettings({
      ...appContext.settings,
      checkForUpdatesOnLaunch: Boolean(value),
    });
  }

  return (
    <div className="flex flex-col space-y-6">
      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Preferences" padding={false} />
        <div className="flex flex-row items-center justify-between py-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Debug Mode</span>
            <span className="text-xs opacity-50">
              Show debug borders and logging information
            </span>
          </div>
          <Switch checked={debugMode} onChange={handleToggleDebug} />
        </div>
        <div
          className="flex flex-row items-center justify-between py-3"
          data-testid="general-section-check-for-updates-row"
        >
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              Check for updates on launch
            </span>
            <span className="text-xs opacity-50">
              When enabled, the app checks the registry for widget package and
              dashboard updates on launch and surfaces a one-click upgrade
              prompt. You can always trigger a manual check from Account → Check
              for updates.
            </span>
          </div>
          <Switch
            checked={checkForUpdatesOnLaunch}
            onChange={handleToggleCheckForUpdates}
          />
        </div>
      </div>

      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Data Directory" padding={false} />
        <div className="flex flex-row items-center justify-between py-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Application Data</span>
            <span className="text-xs opacity-50">
              Open the folder where settings, themes, and workspaces are stored
            </span>
            {dataDirectory && (
              <span className="text-xs opacity-40 mt-1 font-mono">
                {dataDirectory}
              </span>
            )}
          </div>
          <Button title="Open Folder" onClick={handleOpenDataDirectory} />
        </div>
      </div>

      {/* Backup — Phase 4A. Bundles workspaces + themes + folders +
          providers (sans credentials) into a single ZIP. The
          credential strip is enforced server-side via the
          exportController allowlist; this button just routes the
          user through the save dialog. */}
      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Backup" padding={false} />
        <div className="flex flex-row items-center justify-between py-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Export Everything</span>
            <span className="text-xs opacity-50">
              Save a ZIP of your workspaces, themes, folders, and provider
              settings. Credentials are not included.
            </span>
            {exportFeedback && (
              <span
                className={`text-xs mt-1 ${
                  exportFeedback.kind === "success"
                    ? "text-green-400"
                    : "text-red-400"
                }`}
                data-testid="export-feedback"
              >
                {exportFeedback.message}
              </span>
            )}
          </div>
          <Button
            title={isExporting ? "Exporting…" : "Export Everything"}
            onClick={handleExportEverything}
            disabled={isExporting}
            data-testid="export-everything-button"
          />
        </div>
      </div>

      <div className="flex flex-col space-y-3">
        <SubHeading3 title="App Info" padding={false} />
        <DataList>
          <DataList.Item label="App ID" value={credentials.appId || "—"} />
          <DataList.Item
            label="Version"
            value={credentials.version || "—"}
            divider={false}
          />
        </DataList>
      </div>

      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Settings File" padding={false} />
        <pre className="text-xs bg-black/20 rounded p-3 overflow-auto max-h-64">
          {JSON.stringify(appContext?.settings, null, 2)}
        </pre>
      </div>
    </div>
  );
};
