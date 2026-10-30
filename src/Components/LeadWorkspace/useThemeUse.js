import { useContext, useEffect, useState } from "react";
import { AppContext } from "../../Context/App/AppContext";

/**
 * Where a saved theme shows (theme change round, frame 49): whether it's the
 * app's theme, and the dashboards that use it. null while loading, or with
 * no key.
 * @param {string|null} themeKey
 * @returns {{ app: boolean, dashboards: string[] }|null}
 */
export function useThemeUse(themeKey) {
  const app = useContext(AppContext) || {};
  const appId = app.credentials ? app.credentials.appId : undefined;
  const appTheme = app.settings ? app.settings.theme : null;
  const [dashboards, setDashboards] = useState(null);
  useEffect(() => {
    setDashboards(null);
    const api =
      typeof window !== "undefined" && window.mainApi
        ? window.mainApi.workspace
        : null;
    if (!themeKey || !api || !api.listWorkspacesForApplication)
      return undefined;
    let alive = true;
    Promise.resolve(api.listWorkspacesForApplication(appId))
      .then((res) => {
        const list = Array.isArray(res) ? res : (res && res.workspaces) || [];
        if (alive)
          setDashboards(
            list
              .filter((w) => w && w.themeKey === themeKey)
              .map((w) => w.name || String(w.id)),
          );
      })
      .catch(() => alive && setDashboards([]));
    return () => {
      alive = false;
    };
  }, [themeKey, appId]);
  if (!themeKey || dashboards === null) return null;
  return { app: !!appTheme && appTheme === themeKey, dashboards };
}

/** "the app's theme · Kitchen Sink · Home" — or "" when nothing uses it. */
export function themeUseLine(use) {
  if (!use) return "";
  return [use.app ? "the app's theme" : null, ...use.dashboards]
    .filter(Boolean)
    .join(" · ");
}

export default useThemeUse;
