import React, { useContext, useEffect, useState } from "react";
import {
  Button2,
  DataList,
  StatusBadge,
  SubHeading3,
  Switch,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

/** A titled card around one group of settings (design audit, Oct 2026). */
const SettingsGroup = ({ title, children }) => {
  const { hairline } = useConfigTokens();
  return (
    <section
      className={`flex flex-col gap-3 rounded-lg border p-4 ${hairline}`}
    >
      <SubHeading3 title={title} padding={false} />
      {children}
    </section>
  );
};

/**
 * One setting: its name, a one-line description (text-sm, the muted token,
 * prose width) and its control on the right.
 */
const SettingRow = ({ label, description, extra = null, testId, children }) => {
  const { muted } = useConfigTokens();
  return (
    <div
      className="flex flex-row items-center justify-between gap-6"
      data-testid={testId}
    >
      <div className="flex flex-col gap-0.5 min-w-0 max-w-prose">
        <span className="text-sm font-medium">{label}</span>
        <span className={`text-sm ${muted}`}>{description}</span>
        {extra}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
};

// Bots in the background (bot-factory US-018 AC1-AC4). Saved with the bot
// settings; dash-electron applies them to the tray, login item and power.
const BACKGROUND_ROWS = [
  {
    key: "background",
    label: "Keep bots running when the window is closed",
    description:
      "Dash stays in the menu bar while a bot has a schedule, so scheduled runs still happen. Off: scheduled bots stop when you close the window.",
  },
  {
    key: "startAtLogin",
    label: "Start Dash at login",
    description:
      "Opens Dash hidden when you log in, while a bot has a schedule.",
  },
  {
    key: "keepAwake",
    label: "Keep the computer awake for scheduled bots",
    description:
      "Stops the computer sleeping while a bot has a schedule, only when it's plugged in.",
  },
];

/** The bot settings that run bots in the background, or null without bots. */
function useBackgroundSettings() {
  const botsApi = typeof window !== "undefined" ? window.mainApi?.bots : null;
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!botsApi || typeof botsApi.getSettings !== "function") return undefined;
    Promise.resolve(botsApi.getSettings())
      .then((s) => {
        if (alive) setSettings(s || {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [botsApi]);
  const change = async (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    try {
      await botsApi.setSettings({ [key]: value });
    } catch (_e) {
      setSettings((prev) => ({ ...prev, [key]: !value }));
    }
  };
  return [settings, change];
}

export const GeneralSection = () => {
  const { muted, hairline, selectedBg: recessed } = useConfigTokens();
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

  // The app's version: passed in, or asked from the main process (the
  // design audit found Settings showing none).
  const [version, setVersion] = useState(credentials.version || null);
  useEffect(() => {
    if (credentials.version) return undefined;
    const getVersion = window.mainApi?.app?.getVersion;
    if (typeof getVersion !== "function") return undefined;
    let cancelled = false;
    Promise.resolve(getVersion())
      .then((v) => {
        if (!cancelled && typeof v === "string" && v) setVersion(v);
      })
      .catch(() => {
        // An app without the handler just doesn't show a version.
      });
    return () => {
      cancelled = true;
    };
  }, [credentials.version]);
  const [botSettings, changeBotSetting] = useBackgroundSettings();
  const background = botSettings ? botSettings.background !== false : true;

  return (
    <div className="flex flex-col gap-4">
      <SettingsGroup title="Preferences">
        <SettingRow
          label="Debug mode"
          description="Show debug borders and logging information."
        >
          <Switch
            checked={debugMode}
            onChange={handleToggleDebug}
            ariaLabel="Debug mode"
          />
        </SettingRow>
        <SettingRow
          label="Check for updates on launch"
          description="The app checks the registry for widget and dashboard updates when it starts and offers a one-click upgrade. You can always check from Account → Check for updates."
          testId="general-section-check-for-updates-row"
        >
          <Switch
            checked={checkForUpdatesOnLaunch}
            onChange={handleToggleCheckForUpdates}
            ariaLabel="Check for updates on launch"
          />
        </SettingRow>
      </SettingsGroup>

      {botSettings ? (
        <SettingsGroup title="Bots in the background">
          {BACKGROUND_ROWS.filter(
            (row) => row.key === "background" || background,
          ).map((row) => (
            <SettingRow
              key={row.key}
              label={row.label}
              description={row.description}
              testId={`general-section-bots-${row.key}-row`}
            >
              <Switch
                checked={
                  row.key === "keepAwake"
                    ? botSettings.keepAwake === true
                    : botSettings[row.key] !== false
                }
                onChange={(value) => changeBotSetting(row.key, value)}
                ariaLabel={row.label}
              />
            </SettingRow>
          ))}
        </SettingsGroup>
      ) : null}

      <SettingsGroup title="Data directory">
        <SettingRow
          label="Application data"
          description="The folder where settings, themes and dashboards are stored."
          extra={
            dataDirectory ? (
              <span className={`text-xs font-mono break-all ${muted}`}>
                {dataDirectory}
              </span>
            ) : null
          }
        >
          <Button2 title="Open Folder" onClick={handleOpenDataDirectory} />
        </SettingRow>
      </SettingsGroup>

      {/* Backup — Phase 4A. Bundles workspaces + themes + folders +
          providers (sans credentials) into a single ZIP. The
          credential strip is enforced server-side via the
          exportController allowlist; this button just routes the
          user through the save dialog. */}
      <SettingsGroup title="Backup">
        <SettingRow
          label="Export everything"
          description="Save a ZIP of your dashboards, themes, folders and provider settings. Credentials are not included."
          extra={
            // Always mounted, so screen readers announce the result when it
            // appears (a live region that shows up already filled is often
            // skipped).
            <span role="status">
              {exportFeedback ? (
                <span data-testid="export-feedback">
                  <StatusBadge
                    state={
                      exportFeedback.kind === "success" ? "success" : "error"
                    }
                    compact
                    label={exportFeedback.message}
                  />
                </span>
              ) : null}
            </span>
          }
        >
          <Button2
            title={isExporting ? "Exporting…" : "Export Everything"}
            onClick={handleExportEverything}
            disabled={isExporting}
            testId="export-everything-button"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="App info">
        <DataList>
          <DataList.Item
            label="App ID"
            value={credentials.appId || "—"}
            divider={!!version}
          />
          {/* Shown once the version is known. */}
          {version ? (
            <DataList.Item label="Version" value={version} divider={false} />
          ) : null}
        </DataList>
        <details className="flex flex-col gap-2">
          <summary className={`cursor-pointer text-sm font-medium ${muted}`}>
            Show raw settings
          </summary>
          <pre
            data-testid="raw-settings"
            className={`mt-2 text-xs rounded-md border p-3 overflow-auto max-h-64 ${hairline} ${recessed}`}
          >
            {JSON.stringify(appContext?.settings, null, 2)}
          </pre>
        </details>
      </SettingsGroup>
    </div>
  );
};
