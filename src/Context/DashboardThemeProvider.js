import React, { useContext, useEffect, useMemo } from "react";
import { ThemeContext } from "@trops/dash-react";

/**
 * Broadcasts the active dashboard theme so components rendered outside
 * the theme tree (e.g., WidgetBuilderModal) can read it reactively.
 */
function ThemeBroadcast({ ctx }) {
  useEffect(() => {
    if (ctx?.currentTheme && typeof window !== "undefined") {
      window.__dashThemeContext = ctx;
      window.dispatchEvent(new Event("dash:theme-changed"));
    }
  }, [ctx]);
  return null;
}

/**
 * The dashboard theme's cssVars that the APP theme doesn't set, written to
 * `:root` while mounted (and removed after).
 *
 * The dashboard's own colours sit on its wrapper (see below), so only the
 * dashboard area uses them. What a dashboard shows over the page — a
 * widget's dialog or menu, rendered at the end of <body> — can't see that
 * wrapper: dash-react's dialogs, drawers and menus carry their theme's
 * colours themselves (themeVarsStyle). This covers any other pop-out (a
 * widget's own portal): with a named-family app theme, a hex dashboard
 * theme's `bg-[var(--primary-900)]` would otherwise have no value there.
 * Only the variables the app theme leaves unset are filled, so the app
 * (sidebar, tabs, header, Lead) is never repainted in the dashboard's
 * colours.
 */
function DashboardCssVarsGapFill({ cssVars, appCssVars }) {
  useEffect(() => {
    if (!cssVars || typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const app = appCssVars || {};
    const filled = Object.keys(cssVars).filter((key) => !(key in app));
    for (const key of filled) root.style.setProperty(key, cssVars[key]);
    return () => {
      for (const key of filled) root.style.removeProperty(key);
    };
  }, [cssVars, appCssVars]);
  return null;
}

/**
 * DashboardThemeProvider
 *
 * Wraps dashboard content with a nested ThemeContext.Provider when a
 * dashboard has its own themeKey. Components inside find the nearest
 * provider automatically — zero changes needed in dash-react.
 *
 * App chrome (navbar, tab bar, sidebar) stays OUTSIDE this wrapper
 * and keeps the app theme.
 */
export const DashboardThemeProvider = ({ themeKey, children }) => {
  const parentContext = useContext(ThemeContext);
  const { themes, themeVariant } = parentContext;

  const contextValue = useMemo(() => {
    if (!themeKey || !themes || !(themeKey in themes)) return null;

    const dashboardTheme = themes[themeKey];
    const themeValue = dashboardTheme
      ? dashboardTheme[themeVariant] || null
      : null;

    if (!themeValue) return null;

    return {
      ...parentContext,
      currentTheme: themeValue,
      currentThemeKey: themeKey,
      theme: themeValue,
      themeKey: themeKey,
      appTheme: parentContext.currentTheme,
      appThemeKey: parentContext.currentThemeKey,
    };
  }, [themeKey, themes, themeVariant, parentContext]);

  // Broadcast the effective theme (dashboard override or parent)
  const effectiveCtx = contextValue || parentContext;

  if (!contextValue) {
    return (
      <>
        <ThemeBroadcast ctx={effectiveCtx} />
        {children}
      </>
    );
  }

  return (
    <ThemeContext.Provider value={contextValue}>
      <ThemeBroadcast ctx={contextValue} />
      <DashboardCssVarsGapFill
        cssVars={contextValue.currentTheme.cssVars}
        appCssVars={parentContext.currentTheme?.cssVars}
      />
      {/* The dashboard's colours, for the dashboard only: a box that takes
          no space of its own (display: contents) still passes its CSS
          variables down to everything inside. */}
      <div
        style={{
          display: "contents",
          ...(contextValue.currentTheme.cssVars || {}),
        }}
        data-dashboard-theme={themeKey}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
};
