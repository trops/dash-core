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
      {children}
    </ThemeContext.Provider>
  );
};
