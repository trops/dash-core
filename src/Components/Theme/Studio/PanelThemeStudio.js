import React, { useState, useEffect, useContext } from "react";
import { ThemeContext, deepCopy } from "@trops/dash-react";
import BaseColorRail from "./BaseColorRail";
import ChannelEditorModal from "./ChannelEditorModal";
import ComponentInspector from "./ComponentInspector";
import ComponentList from "./ComponentList";
import LivePreview from "../LivePreview";

/**
 * PanelThemeStudio — preview-first theme editor.
 *
 * Sibling to the legacy PanelTheme.js. Matches the same contract:
 *   props: { onUpdate, theme, themeKey, rawTheme }
 *
 * Layout:
 *   ┌ BaseColors ┬ Components ┬── Preview ──┬ Inspector ┐
 *   │  (~14rem)   │  (~14rem)   │ (flex-1)    │  (~18rem)  │
 *   └─────────────┴─────────────┴─────────────┴────────────┘
 *
 * The Preview always renders scenarios for the component selected in
 * the Components list (Alone / Inside Panel / Inside Card / With
 * Sibling Primitives). When nothing is selected, it shows an empty
 * state directing the user to click a component.
 *
 * State owned here:
 *   - themeSelected: mirrors `theme` prop; drives :root cssVars +
 *     all child rendering.
 *   - selectedComponent: the component selected in the list.
 *   - editingChannel: which base channel's modal is open.
 */

export const PanelThemeStudio = ({
  onUpdate,
  theme = null,
  themeKey,
  rawTheme,
}) => {
  const themeContextValue = useContext(ThemeContext);
  const { themeVariant } = themeContextValue;

  const [themeSelected, setThemeSelected] = useState(theme);
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [editingChannel, setEditingChannel] = useState(null);

  useEffect(() => {
    setThemeSelected(() => theme);
  }, [theme]);

  // Write the in-edit theme's CSS custom properties to :root so any
  // hex-channel tokens (`bg-[var(--primary-700)]` etc.) emitted by
  // ThemeModel resolve everywhere the LivePreview renders. Cleanup
  // restores the saved active theme's vars when the editor closes.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const cssVars = themeSelected?.[themeVariant]?.cssVars;
    const written = [];
    if (cssVars && typeof cssVars === "object") {
      for (const [name, value] of Object.entries(cssVars)) {
        root.style.setProperty(name, value);
        written.push(name);
      }
    }
    return () => {
      for (const name of written) {
        root.style.removeProperty(name);
      }
    };
  }, [themeSelected, themeVariant]);

  function handleChooseColor(channel, value) {
    if (!rawTheme || !channel || value === undefined) return;
    const newTheme = deepCopy(rawTheme);
    newTheme[channel] = value;
    onUpdate(newTheme, themeKey);
  }

  /**
   * Per-shade override on a base channel. Stored under the variant
   * keyed by the full token (`bg-{channel}-{level}`); ThemeModel
   * derives the hex at the slot's shade level when emitting.
   */
  function handleOverrideShade(channel, level, hexValue) {
    if (!rawTheme || !channel || !level || hexValue === undefined) return;
    const newTheme = deepCopy(rawTheme);
    if (!newTheme[themeVariant] || typeof newTheme[themeVariant] !== "object") {
      newTheme[themeVariant] = {};
    }
    newTheme[themeVariant][`bg-${channel}-${level}`] = hexValue;
    onUpdate(newTheme, themeKey);
  }

  /**
   * Reset (delete) an existing shade override so the auto-derived
   * value takes over again.
   */
  function handleResetShade(channel, level) {
    if (!rawTheme || !channel || !level) return;
    const newTheme = deepCopy(rawTheme);
    const variantBag = newTheme[themeVariant];
    if (variantBag && typeof variantBag === "object") {
      delete variantBag[`bg-${channel}-${level}`];
    }
    onUpdate(newTheme, themeKey);
  }

  /**
   * Per-component token override. Mirrors the Legacy editor's
   * convention: rawTheme[variant][componentKey] is an object map
   * of styleName → tokenValue (e.g. backgroundColor: "bg-red-700").
   * getStylesForItem reads these via the `themeOverrides` branch.
   */
  function handleOverrideToken(styleName, tokenValue) {
    if (!rawTheme || !selectedComponent?.themeKey || !styleName) return;
    const newTheme = deepCopy(rawTheme);
    if (!newTheme[themeVariant] || typeof newTheme[themeVariant] !== "object") {
      newTheme[themeVariant] = {};
    }
    const componentKey = selectedComponent.themeKey;
    const existing =
      newTheme[themeVariant][componentKey] &&
      typeof newTheme[themeVariant][componentKey] === "object"
        ? newTheme[themeVariant][componentKey]
        : {};
    newTheme[themeVariant][componentKey] = {
      ...existing,
      [styleName]: tokenValue,
    };
    onUpdate(newTheme, themeKey);
  }

  return (
    <div className="flex flex-row w-full h-full overflow-hidden">
      {/* Left: base color rail */}
      <div className="flex flex-col w-56 shrink-0 border-r border-gray-800 overflow-y-auto">
        <BaseColorRail
          theme={themeSelected}
          themeVariant={themeVariant}
          onEditChannel={setEditingChannel}
        />
      </div>

      {/* Middle-left: alphabetical components list */}
      <div className="flex flex-col w-56 shrink-0 border-r border-gray-800 bg-gray-900">
        <ComponentList
          selectedType={selectedComponent?.type || null}
          onSelect={(c) => setSelectedComponent(c)}
        />
      </div>

      {/* Center: live preview (component scenarios) */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex flex-row items-center justify-between px-3 py-2 border-b border-gray-800 bg-gray-900">
          <span className="text-xs uppercase font-bold text-gray-500 tracking-wider">
            Preview
            {selectedComponent?.type && (
              <span className="ml-2 text-gray-300 normal-case">
                · {selectedComponent.type}
              </span>
            )}
          </span>
          {selectedComponent?.type && (
            <button
              type="button"
              onClick={() => setSelectedComponent(null)}
              className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0">
          <LivePreview
            theme={themeSelected}
            themeVariant={themeVariant}
            selectedType={selectedComponent?.type || null}
          />
        </div>
      </div>

      {/* Right: component inspector */}
      <div className="flex flex-col w-72 shrink-0 border-l border-gray-800 bg-gray-800 overflow-hidden">
        <ComponentInspector
          themeKey={selectedComponent?.themeKey || null}
          theme={themeSelected}
          rawTheme={rawTheme}
          themeVariant={themeVariant}
          onOverride={handleOverrideToken}
        />
      </div>

      {/* All-channel editor (accordion: base + shades per channel) */}
      {editingChannel && (
        <ChannelEditorModal
          isOpen={true}
          setIsOpen={(open) => {
            if (!open) setEditingChannel(null);
          }}
          initialChannel={editingChannel}
          theme={themeSelected}
          rawTheme={rawTheme}
          themeVariant={themeVariant}
          onChooseBaseColor={handleChooseColor}
          onOverrideShade={handleOverrideShade}
          onResetShade={handleResetShade}
        />
      )}
    </div>
  );
};

export default PanelThemeStudio;
