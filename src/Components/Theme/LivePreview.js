import React from "react";
import { ThemeContext, Panel } from "@trops/dash-react";
import { renderScenariosFor } from "./Studio/componentScenarios";

/**
 * LivePreview — theme-aware preview surface for the Studio.
 *
 * Renders the focused scenarios (Alone / Inside Panel / Inside Card /
 * With Sibling Primitives) for the currently-selected component
 * inside a nested `ThemeContext.Provider` scoped to the in-edit
 * theme variant. When no component is selected, shows a prompt.
 *
 * Props:
 *   - theme: the ThemeModel output (.dark/.light variants).
 *   - themeVariant: "dark" | "light".
 *   - selectedType?: a registry type (e.g. "heading-2"). When set,
 *     renders that component's scenarios. When null, shows the
 *     empty-selection prompt.
 */

const LivePreview = ({ theme, themeVariant = "dark", selectedType = null }) => {
  const themeContextValueOuter = React.useContext(ThemeContext);
  const inEditThemeData = theme?.[themeVariant];
  const scopedThemeContext = React.useMemo(
    () => ({
      ...themeContextValueOuter,
      currentTheme: inEditThemeData || themeContextValueOuter?.currentTheme,
    }),
    [themeContextValueOuter, inEditThemeData],
  );

  if (!theme) {
    return (
      <div className="flex items-center justify-center w-full h-full text-gray-500 text-sm">
        No theme to preview.
      </div>
    );
  }

  const scenarios = selectedType ? renderScenariosFor(selectedType) : [];

  return (
    <ThemeContext.Provider value={scopedThemeContext}>
      <Panel scrollable={true} height="h-full">
        <Panel.Body scrollable={true}>
          {!selectedType ? (
            <div className="flex flex-col items-center justify-center w-full h-full p-12 text-center gap-2">
              <span className="text-sm font-bold text-gray-300">
                Pick a component to preview
              </span>
              <span className="text-xs text-gray-500 max-w-md">
                Click any component in the list on the left. The preview shows
                it on its own, inside a Panel, inside a Card, and surrounded by
                sibling primitives at the same tier.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-6 p-4">
              <div className="text-xs text-gray-500">
                Showing scenarios for{" "}
                <span className="text-gray-300 font-bold">{selectedType}</span>
              </div>
              {scenarios.map((s) => (
                <div key={s.id} className="flex flex-col gap-2">
                  <div className="text-xs uppercase font-bold text-gray-500 tracking-wider border-b border-gray-800 pb-1">
                    {s.label}
                  </div>
                  {s.content}
                </div>
              ))}
            </div>
          )}
        </Panel.Body>
      </Panel>
    </ThemeContext.Provider>
  );
};

export default LivePreview;
