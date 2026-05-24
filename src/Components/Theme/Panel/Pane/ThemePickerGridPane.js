import React, { useContext } from "react";
import { ThemeContext } from "../../../../Context";
import ThemePane from "./ThemePane";

const ThemePickerGridPane = ({ themeKey, onChooseTheme }) => {
  const { themes, themeVariant } = useContext(ThemeContext);

  function renderMenuItem(tk) {
    const displayTheme = themes[tk][themeVariant];
    // Read inline CSS color values from `cssValue` (v0.1.569+) so
    // preview swatches render correctly for BOTH named-color and
    // hex (brand-preset) themes. For hex themes, the className path
    // resolves to `bg-[var(--secondary-700)]` which depends on the
    // active theme's CSS variables — those aren't injected for
    // OTHER themes shown in the picker grid. Inline cssValue
    // sidesteps that limitation.
    const cssValue = displayTheme.cssValue || {};
    const swatches = [
      {
        type: "secondary",
        value: cssValue["bg-secondary-medium"],
        className: displayTheme["bg-secondary-medium"],
      },
      {
        type: "tertiary",
        value: cssValue["bg-tertiary-medium"],
        className: displayTheme["bg-tertiary-medium"],
      },
      {
        type: "neutral",
        value: cssValue["bg-neutral-light"],
        className: displayTheme["bg-neutral-light"],
      },
    ];

    return swatches.map((swatch) => {
      // Prefer cssValue (works for any theme). Fall back to className
      // for pre-v0.1.569 themes without a cssValue map.
      if (swatch.value) {
        return (
          <div
            key={`theme-grid-${swatch.type}`}
            className="rounded h-20 w-full"
            style={{ backgroundColor: swatch.value }}
          />
        );
      }
      return (
        <div
          key={`theme-grid-${swatch.type}`}
          className={`rounded ${swatch.className} h-20 w-full`}
        />
      );
    });
  }

  function renderCurrentThemes() {
    if (!themes) return null;
    const sortedKeys = Object.keys(themes).sort((a, b) => {
      const nameA = (themes[a]?.[themeVariant]?.name || "").toLowerCase();
      const nameB = (themes[b]?.[themeVariant]?.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
    return sortedKeys.map((tk) => {
      // is this selected
      const selected = tk === themeKey;
      const current = themes[tk][themeVariant];
      // Prefer the inline hex literal from `cssValue` so hex-channel
      // themes render their tile bg correctly (non-active themes
      // don't get their cssVars on :root). Fall back to the class
      // for named-color themes that may not have cssValue populated.
      const tileBgValue = current?.cssValue?.["bg-primary-dark"];
      const tileBgClass = !tileBgValue ? current["bg-primary-dark"] : "";
      return (
        <div
          key={`icon-${tk}`}
          className={`flex flex-col text-xs p-4 space-y-4 h-48 w-full rounded justify-between border-2 ${
            selected === true
              ? "border-yellow-600 hover:border-yellow-600"
              : "hover:border-yellow-600 border-gray-800"
          } cursor-pointer text-gray-200 ${tileBgClass}`}
          style={tileBgValue ? { backgroundColor: tileBgValue } : undefined}
          onClick={() => onChooseTheme(tk)}
        >
          <div className="flex flex-col w-full">
            <span className="font-bold text-xl word-break-all">
              {current["name"]}
            </span>
            <span className="font-bold text-xs text-gray-500">{tk}</span>
          </div>
          <div className="flex flex-row space-x-2">{renderMenuItem(tk)}</div>
        </div>
      );
    });
  }

  return (
    <ThemePane>
      <div className="flex flex-row rounded overflow-clip justify-center items-center align-center w-full">
        <div className="grid grid-cols-3 gap-4 w-full h-full overflow-y-scroll scrollbar scrollbar-thumb-gray-700 scrollbar-thin scrollbar-track-transparent">
          {renderCurrentThemes()}
        </div>
      </div>
    </ThemePane>
  );
};

export default ThemePickerGridPane;
