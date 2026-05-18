import React, { useEffect, useState, useCallback, useMemo } from "react";
import { AppContext } from "./AppContext";
import { SettingsModel } from "../../Models";
import { deepCopy } from "@trops/dash-react";
import { useInstalledWidgets } from "../../hooks/useInstalledWidgets";
import { useAppUpdates } from "../../hooks/useAppUpdates";
import { AppUpdatesModal } from "../../Components/AppUpdatesModal";

/**
 * Broadcasts the AppContext (providers, settings) so components rendered
 * outside the AppWrapper tree (e.g., WidgetBuilderModal) can access them.
 */
function AppContextBroadcast({ ctx }) {
  useEffect(() => {
    if (ctx && typeof window !== "undefined") {
      window.__dashAppContext = ctx;
      window.dispatchEvent(new Event("dash:app-context-changed"));
    }
  }, [ctx]);
  return null;
}

// TODO
// make theme files or have a Theme context which we can populate with a plugin or config
// color theme (coming soon)
const debugStyles = {
  workspace: {
    classes: "bg-gray-800 border border-red-900 rounded p-4",
  },
  "workspace-menu": {
    classes: "bg-gray-800 border border-orange-900 rounded p-4",
  },
  "workspace-footer": {
    classes: "bg-gray-800 border-t border-orange-900 rounded p-4",
  },
  layout: {
    classes: "border border-green-900 bg-gray-800 rounded p-4",
  },
  widget: {
    classes: "border border-blue-700 bg-gray-800 rounded p-4",
  },
};

export const AppWrapper = ({ children, credentials = null, dashApi }) => {
  const [creds, setCreds] = useState(credentials);
  const [debugMode, setDebugmode] = useState(false);
  const [searchClient, setSearchClient] = useState(null);
  const [settings, setSettings] = useState(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);

  const [providers, setProviders] = useState({});
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);

  // ── App-launch updates check ───────────────────────────────────
  // Aggregator over widget + dashboard registry checks. Powers the
  // AppUpdatesModal that auto-pops once per session when updates
  // are available AND the user has opted in via settings (default
  // on). Manual triggers (Account section's "Check for updates")
  // route through `triggerAppUpdatesCheck` exposed on AppContext.
  const { widgets: installedWidgets, refresh: refreshInstalledWidgets } =
    useInstalledWidgets();
  const appUpdates = useAppUpdates({
    appId: creds?.appId,
    installedWidgets,
    onWidgetUpdated: refreshInstalledWidgets,
  });
  const [appUpdatesModalOpen, setAppUpdatesModalOpen] = useState(false);
  // Session-scoped dismissal: once the user clicks "Remind me later"
  // (or closes the modal), don't auto-pop again this app launch. A
  // fresh launch resets the flag and re-checks per settings.
  const [appUpdatesSessionDismissed, setAppUpdatesSessionDismissed] =
    useState(false);
  // Auto-pop on launch — fires once both checks have settled AND the
  // user opted in. Gated on `appUpdatesAutoPopped` so a state change
  // mid-session (e.g. the modal auto-closes after Update all) doesn't
  // immediately re-pop.
  const [appUpdatesAutoPopped, setAppUpdatesAutoPopped] = useState(false);
  useEffect(() => {
    if (appUpdatesAutoPopped) return;
    if (appUpdatesSessionDismissed) return;
    if (!appUpdates.hasChecked) return;
    if (appUpdates.totalUpdates === 0) return;
    if (!settings) return;
    if (settings.checkForUpdatesOnLaunch === false) return;
    setAppUpdatesModalOpen(true);
    setAppUpdatesAutoPopped(true);
  }, [
    appUpdatesAutoPopped,
    appUpdatesSessionDismissed,
    appUpdates.hasChecked,
    appUpdates.totalUpdates,
    settings,
  ]);

  // Manual-trigger entry point — exposed on AppContext so any
  // settings surface (Account "Check for updates" item, etc.) can
  // request a fresh check + force-open the modal regardless of the
  // launch-toggle setting. recheck() re-runs the dashboard check;
  // widgets re-check on next mount (the useWidgetUpdates effect is
  // one-shot per mount).
  const triggerAppUpdatesCheck = useCallback(async () => {
    setAppUpdatesModalOpen(true);
    setAppUpdatesSessionDismissed(false);
    await appUpdates.recheck();
  }, [appUpdates]);

  useEffect(() => {
    console.log("App Wrapper ", settings, isLoadingSettings);
    if (settings === null && isLoadingSettings === false) {
      loadSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials, settings]);

  useEffect(() => {
    // Load providers on mount
    if (
      providers &&
      Object.keys(providers).length === 0 &&
      isLoadingProviders === false
    ) {
      loadProviders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);

  const changeSearchClient = useCallback((searchClientTo) => {
    setSearchClient(() => searchClientTo);
  }, []);

  /* eslint-disable react-hooks/exhaustive-deps */
  // saveSettings intentionally omitted from deps to avoid infinite loops
  const changeSettings = useCallback(
    (settingsObject) => {
      setSettings(() => settingsObject);
      saveSettings(settingsObject);
    },
    [dashApi, credentials],
  );

  const changeCreds = useCallback(
    (appId, apiKey) => {
      const credentialsTemp = { appId, apiKey };
      setSettings((prev) => {
        const s = deepCopy(prev);
        s["creds"] = credentialsTemp;
        saveSettings(s);
        return s;
      });
      setCreds(() => credentialsTemp);
    },
    [dashApi, credentials],
  );

  const changeDebugMode = useCallback(
    (to) => {
      setDebugmode(to);
      setSettings((prev) => {
        const s = deepCopy(prev);
        s["debugMode"] = to;
        saveSettings(s);
        return s;
      });
      if (to) {
        window.mainApi?.debug?.open();
      } else {
        window.mainApi?.debug?.close();
      }
    },
    [dashApi, credentials],
  );

  const changeApplicationTheme = useCallback(
    (themeKey) => {
      try {
        setSettings((prev) => {
          let s = deepCopy(prev);
          if (s && themeKey) {
            s["theme"] = themeKey;
            saveSettings(s);
            return s;
          }
          return prev;
        });
      } catch (e) {
        console.log("error changing theme ", e, themeKey);
      }
    },
    [dashApi, credentials],
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  function loadSettings() {
    // Here is where we have to add this theme to the themes available
    // and save to the themes file.
    console.log("loading settings ", settings, dashApi, credentials);
    if (dashApi && credentials) {
      dashApi.listSettings(
        credentials.appId,
        handleGetSettingsComplete,
        handleGetSettingsError,
      );
    }
  }

  function handleGetSettingsComplete(e, message) {
    console.log("loaded settings ", message);
    if ("settings" in message) {
      let settingsObject;
      if (Object.keys(message["settings"]).length === 0) {
        // nothing in settings so we should set some things....
        // set a default theme for the user
        settingsObject = SettingsModel({ theme: "theme-1" });
      } else {
        settingsObject = SettingsModel(message["settings"]);
      }
      setSettings(() => settingsObject);
    }
    // set the settings model to the context
    setIsLoadingSettings(() => false);
    // forceUpdate();
  }

  function handleGetSettingsError(e, error) {
    console.log("settings load error ", error.message);
    setIsLoadingSettings(() => false);
  }

  const loadProviders = useCallback(() => {
    // Load providers from the main app
    console.log("loading providers ", dashApi, credentials);
    if (dashApi && credentials) {
      setIsLoadingProviders(() => true);
      dashApi.listProviders(
        credentials.appId,
        handleGetProvidersComplete,
        handleGetProvidersError,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashApi, credentials]);

  function handleGetProvidersComplete(e, message) {
    console.log("loaded providers ", message);
    if ("providers" in message) {
      // message.providers is an array of { name, type, credentials }
      // Convert to object keyed by provider name for easy lookup
      const providersObj = {};
      message.providers.forEach((provider) => {
        providersObj[provider.name] = provider;
      });
      setProviders(() => providersObj);
    }
    setIsLoadingProviders(() => false);
  }

  function handleGetProvidersError(e, error) {
    console.log("providers load error ", error.message);
    setIsLoadingProviders(() => false);
    // Set empty providers object so app continues to work
    setProviders(() => ({}));
  }

  function saveSettings(settingsToSave) {
    const data = settingsToSave || settings;
    if (dashApi && data) {
      dashApi.saveSettings(
        credentials.appId,
        data,
        handleGetSettingsComplete,
        handleGetSettingsError,
      );
    }
  }

  // function handleSaveSettingsComplete(e, message) {
  //     if ('settings' in message) {
  //         let settingsObject;
  //         if (Object.keys(message['settings']).length === 0) {
  //             // nothing in settings so we should set some things....
  //             // set a default theme for the user
  //             settingsObject = SettingsModel({ theme: 'theme-1' });
  //         } else {
  //             settingsObject = SettingsModel(message['settings']);
  //         }
  //         setSettings(() => settingsObject);
  //     }
  //     // set the settings model to the context
  //     setIsSavingSettings(() => false);
  // }

  // function handleSaveSettingsError(e, message) {
  //     console.log('settings load error ', e, message);
  //     setIsSavingSettings(() => false);
  // }

  const openDataDirectory = useCallback(() => {
    if (dashApi) {
      dashApi.openDataDirectory(
        () => console.log("[AppWrapper] Opened data directory"),
        (e, err) =>
          console.error("[AppWrapper] Error opening data directory:", err),
      );
    }
  }, [dashApi]);

  const contextValue = useMemo(() => {
    try {
      return {
        debugMode: debugMode,
        debugStyles: debugStyles,
        creds: creds,
        credentials,
        searchClient: searchClient,
        api: dashApi,
        dashApi,
        settings: settings,
        providers: providers,
        isLoadingProviders: isLoadingProviders,
        refreshProviders: loadProviders,
        changeSearchClient,
        changeCreds,
        changeDebugMode,
        changeSettings,
        changeApplicationTheme,
        openDataDirectory,
        // Manual app-updates trigger for AccountSection's "Check for
        // updates" item and any future surface that wants to force
        // the modal open (e.g. menu bar entry).
        triggerAppUpdatesCheck,
      };
    } catch (e) {
      console.log(e);
      return null;
    }
  }, [
    debugMode,
    creds,
    credentials,
    searchClient,
    dashApi,
    settings,
    providers,
    isLoadingProviders,
    loadProviders,
    changeSearchClient,
    changeCreds,
    changeDebugMode,
    changeSettings,
    changeApplicationTheme,
    openDataDirectory,
    triggerAppUpdatesCheck,
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      <AppContextBroadcast ctx={contextValue} />
      {children}
      {/* App-level updates modal — mounted here so it floats above
          everything (Modal portals to document.body). Visibility is
          driven by the auto-pop effect above and/or manual triggers
          via context.triggerAppUpdatesCheck. */}
      <AppUpdatesModal
        isOpen={appUpdatesModalOpen}
        setIsOpen={setAppUpdatesModalOpen}
        widgetUpdates={appUpdates.widgetUpdates}
        dashboardUpdates={appUpdates.dashboardUpdates}
        isChecking={appUpdates.isChecking}
        hasChecked={appUpdates.hasChecked}
        onUpdateWidgets={async () => {
          await appUpdates.updateWidgetPackages(
            appUpdates.widgetUpdates.map((p) => p.name),
          );
        }}
        onRemindLater={() => setAppUpdatesSessionDismissed(true)}
      />
    </AppContext.Provider>
  );
};
