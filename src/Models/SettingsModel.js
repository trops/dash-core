import { deepCopy } from "@trops/dash-react";

export const SettingsModel = (settingsObject = {}) => {
  const obj = deepCopy(settingsObject);
  obj["debug"] = "debug" in obj ? obj["debug"] : false;
  obj["theme"] = "theme" in obj ? obj["theme"] : null;
  // Whether to run the app-launch updates check (widget packages +
  // dashboards). Defaults to true — users opt out via Settings →
  // (general). The AppUpdatesModal honors this flag; if false, the
  // launch check is skipped (the user can still trigger a manual
  // check from the "Check for updates" entry in AccountSection).
  obj["checkForUpdatesOnLaunch"] =
    "checkForUpdatesOnLaunch" in obj ? obj["checkForUpdatesOnLaunch"] : true;

  return obj;
};
