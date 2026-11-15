import React, { useEffect, useMemo } from "react";
import { themePartsCss } from "../../utils/themeParts";

/**
 * A theme's own part colours (Edit theme) for everything inside the box
 * marked `data-own-theme={scope}` — a dashboard with its own theme, a
 * preview. Renders a <style>; nothing when the theme changes no part.
 */
export const ThemePartsStyle = ({ variantModel, scope }) => {
  const css = useMemo(
    () => themePartsCss(variantModel, scope),
    [variantModel, scope],
  );
  if (!css) return null;
  return <style data-theme-parts={scope}>{css}</style>;
};

const APP_STYLE_ID = "dash-theme-parts";

/** The app theme's part colours, app-wide (a <style> in <head>). */
export function useAppThemeParts(variantModel) {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const css = themePartsCss(variantModel, null);
    let el = document.getElementById(APP_STYLE_ID);
    if (!css) {
      if (el) el.remove();
      return undefined;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = APP_STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = css;
    return undefined;
  }, [variantModel]);
}

export default ThemePartsStyle;
