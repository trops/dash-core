import React, { useState } from "react";
import { getStylesForItem } from "@trops/dash-react";
import TokenColorPickerPane from "../Panel/Pane/TokenColorPickerPane";

/**
 * ComponentInspector — token inspector with override editing.
 *
 * Given the currently-selected component's themeKey (e.g. "heading",
 * "card", "button"), resolve its styles against the in-edit theme via
 * `getStylesForItem`. Each color-related row is clickable; clicking
 * opens `TokenColorPickerPane` inline for that property. Picking a
 * token fires `onOverride(styleName, tokenValue)` which the Studio
 * shell merges into `rawTheme[variant][componentKey][styleName]`
 * matching the Legacy editor's component-scoped override convention.
 *
 * Props:
 *   - themeKey: the registry's themeKey for the selected component
 *     (e.g. "heading"). Null → empty state.
 *   - theme: ThemeModel output (.dark/.light variants).
 *   - rawTheme: pre-Model raw theme (used to read existing overrides).
 *   - themeVariant: "dark" | "light".
 *   - onOverride: (styleName, tokenValue) => void  — fired when the
 *     user picks a new token for a property.
 */

// `getStylesForItem` returns styles keyed by the styleClassNames
// constants — which are camelCase strings like `backgroundColor`,
// `textColor`, etc. (NOT short prefixes like "bg" / "text" — that's a
// different shape). Keep the row order semantic (bg → text → border
// → hover variants → active → focus ring).
const COLOR_ROWS = [
  { label: "Background", styleName: "backgroundColor" },
  { label: "Text", styleName: "textColor" },
  { label: "Border", styleName: "borderColor" },
  { label: "Hover Background", styleName: "hoverBackgroundColor" },
  { label: "Hover Text", styleName: "hoverTextColor" },
  { label: "Hover Border", styleName: "hoverBorderColor" },
  { label: "Active Background", styleName: "activeBackgroundColor" },
  { label: "Active Text", styleName: "activeTextColor" },
  { label: "Focus Ring", styleName: "focusRingColor" },
  {
    label: "Placeholder Text",
    styleName: "placeholderTextColor",
  },
];

const ComponentInspector = ({
  themeKey,
  theme,
  rawTheme,
  themeVariant = "dark",
  onOverride,
}) => {
  const [activeStyleName, setActiveStyleName] = useState(null);

  if (!themeKey) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center">
        <span className="text-sm font-bold text-gray-300 mb-1">Inspector</span>
        <span className="text-xs text-gray-500">
          Click a component in the preview to inspect its tokens.
        </span>
      </div>
    );
  }

  const themeData = theme?.[themeVariant];
  let styles = {};
  try {
    styles = getStylesForItem(themeKey, themeData) || {};
  } catch (e) {
    styles = {};
  }

  const overridesForComponent =
    rawTheme?.[themeVariant]?.[themeKey] &&
    typeof rawTheme[themeVariant][themeKey] === "object"
      ? rawTheme[themeVariant][themeKey]
      : {};

  function handlePickToken(value) {
    if (onOverride && activeStyleName) {
      onOverride(activeStyleName, value);
    }
    setActiveStyleName(null);
  }

  return (
    <div className="flex flex-col w-full h-full">
      <div className="flex flex-col bg-gray-900 p-3 rounded-t border-b border-gray-700 border-l-2 border-l-blue-400">
        <span className="text-sm font-bold text-blue-300">{themeKey}</span>
        <span className="text-xs uppercase text-gray-500 tracking-wider">
          Tokens
        </span>
      </div>
      <div className="flex flex-col p-3 space-y-2 overflow-y-auto flex-1 min-h-0">
        {COLOR_ROWS.every((row) => !(row.styleName in styles)) && (
          <div className="text-xs text-gray-500 italic">
            No color tokens defined for this component in the registry.
          </div>
        )}
        {COLOR_ROWS.map((row) => {
          if (!(row.styleName in styles)) return null;
          const className = styles[row.styleName];
          const cssValue = themeData?.cssValue?.[className] || null;
          const hasOverride = row.styleName in overridesForComponent;
          const isActive = activeStyleName === row.styleName;
          return (
            <div
              key={row.styleName}
              className={`flex flex-col rounded border ${
                isActive ? "border-yellow-500" : "border-gray-700"
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setActiveStyleName(isActive ? null : row.styleName)
                }
                className="flex flex-row items-center justify-between space-x-2 py-2 px-3 hover:bg-gray-700 text-left"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-gray-300 flex flex-row items-center space-x-2">
                    <span>{row.label}</span>
                    {hasOverride && (
                      <span className="text-xs bg-yellow-600 text-yellow-50 px-1 py-0.5 rounded uppercase">
                        Override
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-mono text-gray-500 truncate">
                    {className}
                  </span>
                </div>
                {cssValue && (
                  <div
                    className="w-8 h-8 rounded border border-gray-600 flex-shrink-0"
                    style={{ backgroundColor: cssValue }}
                    title={cssValue}
                  />
                )}
              </button>
              {isActive && (
                <div className="border-t border-gray-700 max-h-80 overflow-y-auto">
                  <TokenColorPickerPane
                    theme={theme}
                    themeVariant={themeVariant}
                    styleName={row.styleName}
                    currentValue={
                      overridesForComponent[row.styleName] || className || null
                    }
                    onSelect={handlePickToken}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ComponentInspector;
