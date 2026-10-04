import React from "react";
import { colorTypes, themeVariants } from "@trops/dash-react";

/**
 * ColorSwatchGrid — a theme variant's palette: one row per channel
 * (primary / secondary / tertiary / neutral) × 5 shade swatches. The bg shade
 * IS the canonical colour; text/border tokens are deterministic restyles and
 * don't add new information here. Used by the Themes page (app-navigation
 * NAV-009); per-token editing lives in the theme Studio.
 */
const ShadeSwatch = ({ tokenKey, resolvedClass, cssValue }) => {
  const tooltip = `${tokenKey} → ${cssValue || resolvedClass || "(none)"}`;
  // Prefer the inline cssValue: it works for any theme (hex channels don't
  // get their cssVars on :root for non-active themes).
  if (cssValue) {
    return (
      <div
        className="h-10 flex-1 rounded"
        style={{ backgroundColor: cssValue }}
        title={tooltip}
      />
    );
  }
  return (
    <div
      className={`h-10 flex-1 rounded ${resolvedClass || ""}`}
      title={tooltip}
    />
  );
};

export const ColorSwatchGrid = ({ displayTheme }) => {
  const cssValueMap = displayTheme.cssValue || {};
  return (
    <div className="flex flex-col space-y-4">
      {colorTypes.map((family) => (
        <div key={family} className="flex flex-col space-y-2">
          <span className="text-xs font-semibold opacity-50 capitalize">
            {family}
          </span>
          <div className="flex flex-row gap-1.5">
            {themeVariants.map((shade) => {
              const tokenKey = `bg-${family}-${shade}`;
              return (
                <ShadeSwatch
                  key={shade}
                  tokenKey={tokenKey}
                  resolvedClass={displayTheme[tokenKey] || ""}
                  cssValue={cssValueMap[tokenKey]}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ColorSwatchGrid;
