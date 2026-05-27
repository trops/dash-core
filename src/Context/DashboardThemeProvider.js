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
 * Writes the dashboard theme's cssVars to `:root` while mounted, and
 * restores the previous values on unmount / theme switch.
 *
 * ThemeWrapper writes the APP theme's cssVars at the top of the tree.
 * Without this helper, a dashboard that overrides the app theme with a
 * hex-channel theme (like "Slack Generic") would carry the right class
 * names (`bg-[var(--primary-900)]`) but the `--primary-900` variable
 * on :root would still be the APP theme's value — or undefined if the
 * app theme is named-family. Hex-themed surfaces then render with no
 * background. This effect closes that gap by promoting the dashboard
 * theme's cssVars to :root for the duration of its mount.
 */
function DashboardCssVarsBridge({ cssVars }) {
  useEffect(() => {
    if (!cssVars || typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const previous = {};
    const keys = Object.keys(cssVars);
    for (const key of keys) {
      previous[key] = root.style.getPropertyValue(key);
      root.style.setProperty(key, cssVars[key]);
    }
    return () => {
      for (const key of keys) {
        if (previous[key]) {
          root.style.setProperty(key, previous[key]);
        } else {
          root.style.removeProperty(key);
        }
      }
    };
  }, [cssVars]);
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
      <DashboardCssVarsBridge cssVars={contextValue?.currentTheme?.cssVars} />
      {children}
    </ThemeContext.Provider>
  );
};
