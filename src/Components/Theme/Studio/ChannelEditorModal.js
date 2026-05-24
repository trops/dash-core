import React, { useState } from "react";
import {
  Modal,
  DashPanel,
  Button,
  isHexColor,
  getColorFamilies,
  getCuratedColorGrid,
} from "@trops/dash-react";
import CustomHexColorPane from "../Panel/Pane/CustomHexColorPane";

/**
 * ChannelEditorModal — editing surface for all 4 channels in one
 * modal, accordion-style.
 *
 * Layout:
 *   ┌─ Channels (accordion, ~20%) ─┬─ Color Picker (~80%) ──────┐
 *   │ Primary  ▾                    │ Family chips                │
 *   │  Very Light                   │                              │
 *   │  Light                        │ [Large categorized hex grid] │
 *   │  Medium  ← active slot        │                              │
 *   │  Dark                         │                              │
 *   │  Very Dark                    │ ─────                        │
 *   │ Secondary ▸                   │ Or paste a hex value         │
 *   │ Tertiary  ▸                   │                              │
 *   │ Neutral   ▸                   │                              │
 *   └───────────────────────────────┴──────────────────────────────┘
 *
 * Clicking a collapsed channel expands it (and collapses the prior).
 * Click the channel row itself to target its base color; click any
 * shade beneath to target that shade. Pick anywhere on the right →
 * applies to the active (channel, slot) pair.
 *
 * Props:
 *   - isOpen, setIsOpen
 *   - initialChannel: which channel to expand on open
 *   - theme, rawTheme, themeVariant
 *   - onChooseBaseColor: (channel, hex) => void
 *   - onOverrideShade: (channel, level, hex) => void
 *   - onResetShade: (channel, level) => void
 */

const CHANNELS = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "tertiary", label: "Tertiary" },
  { key: "neutral", label: "Neutral" },
];

const SHADE_LEVELS = [
  { key: "very-light", label: "Very Light" },
  { key: "light", label: "Light" },
  { key: "medium", label: "Medium" },
  { key: "dark", label: "Dark" },
  { key: "very-dark", label: "Very Dark" },
];

function channelSwatchProps(theme, themeVariant, channelKey) {
  const baseValue = theme?.[themeVariant]?.[channelKey];
  if (isHexColor(baseValue)) {
    return { style: { backgroundColor: baseValue }, className: "" };
  }
  if (typeof baseValue === "string" && baseValue) {
    return { style: undefined, className: `bg-${baseValue}-500` };
  }
  return { style: undefined, className: "bg-gray-700" };
}

const ChannelEditorModal = ({
  isOpen,
  setIsOpen,
  initialChannel = "primary",
  theme,
  rawTheme,
  themeVariant = "dark",
  onChooseBaseColor,
  onOverrideShade,
  onResetShade,
}) => {
  const families = getColorFamilies();
  const [activeFamily, setActiveFamily] = useState(families[0]);
  // activeChannel: which channel's accordion is expanded.
  const [activeChannel, setActiveChannel] = useState(initialChannel);
  // activeSlot: "base" | one of SHADE_LEVELS[].key.
  const [activeSlot, setActiveSlot] = useState("base");

  const themeData = theme?.[themeVariant];
  const baseValue = themeData?.[activeChannel];
  const baseHex = isHexColor(baseValue) ? baseValue : null;

  function expandChannel(channelKey) {
    setActiveChannel(channelKey);
    setActiveSlot("base");
  }

  function handlePickColor(hex) {
    if (!hex) return;
    if (activeSlot === "base") {
      if (onChooseBaseColor) onChooseBaseColor(activeChannel, hex);
    } else {
      if (onOverrideShade) onOverrideShade(activeChannel, activeSlot, hex);
    }
  }

  function handleApplyHex(hex) {
    handlePickColor(hex);
  }

  function handleResetActive() {
    if (activeSlot === "base") return;
    if (onResetShade) onResetShade(activeChannel, activeSlot);
  }

  const swatches = getCuratedColorGrid(activeFamily);

  return (
    <Modal isOpen={isOpen} setIsOpen={setIsOpen} width="w-3/4" height="h-3/4">
      <DashPanel height="h-full" scrollable={true}>
        <DashPanel.Header title="Edit Theme Colors" />
        <DashPanel.Body scrollable={true} space={true}>
          <div className="flex flex-col gap-3 p-3 h-full min-h-0">
            <div className="text-xs text-gray-400 italic">
              Pick a base color to set every shade automatically — or click a
              shade slot to override just that one. Switch channels in the left
              column. Any color you pick (including a custom hex) is shaded to
              match the slot.
            </div>

            <div className="flex flex-row gap-4 flex-1 min-h-0">
              {/* LEFT: accordion of 4 channels */}
              <div className="flex flex-col gap-2 w-56 shrink-0 overflow-y-auto">
                {CHANNELS.map((c) => {
                  const isExpanded = activeChannel === c.key;
                  const isBaseActive = isExpanded && activeSlot === "base";
                  const chSwatch = channelSwatchProps(
                    theme,
                    themeVariant,
                    c.key,
                  );
                  return (
                    <div
                      key={c.key}
                      className="flex flex-col rounded border border-gray-800"
                    >
                      <button
                        type="button"
                        onClick={() => expandChannel(c.key)}
                        className={`flex flex-row items-center gap-2 p-2 text-left ${
                          isBaseActive
                            ? "bg-gray-700 border-l-2 border-l-yellow-500"
                            : "hover:bg-gray-800"
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded shrink-0 ${chSwatch.className}`}
                          style={chSwatch.style}
                        />
                        <span className="text-sm font-bold text-gray-200 flex-1">
                          {c.label}
                        </span>
                        <span className="text-xs text-gray-500">
                          {isExpanded ? "▾" : "▸"}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="flex flex-col gap-1 p-2 border-t border-gray-800">
                          {SHADE_LEVELS.map((s) => {
                            const tokenKey = `bg-${c.key}-${s.key}`;
                            const className = themeData?.[tokenKey] || "";
                            const cssValue =
                              themeData?.cssValue?.[tokenKey] || null;
                            const hasOverride =
                              rawTheme?.[themeVariant] &&
                              typeof rawTheme[themeVariant] === "object" &&
                              tokenKey in rawTheme[themeVariant];
                            const isShadeActive = activeSlot === s.key;
                            return (
                              <button
                                key={s.key}
                                type="button"
                                onClick={() => setActiveSlot(s.key)}
                                className={`flex flex-row items-center gap-2 p-1.5 rounded text-left ${
                                  isShadeActive
                                    ? "bg-gray-700 border-l-2 border-l-yellow-500"
                                    : "hover:bg-gray-800"
                                }`}
                              >
                                <div
                                  className={`w-6 h-6 rounded shrink-0 ${cssValue ? "" : className}`}
                                  style={
                                    cssValue
                                      ? { backgroundColor: cssValue }
                                      : undefined
                                  }
                                />
                                <span className="text-xs text-gray-300 flex-1">
                                  {s.label}
                                </span>
                                {hasOverride && (
                                  <span className="text-xs text-yellow-400 uppercase font-bold">
                                    Ovr
                                  </span>
                                )}
                              </button>
                            );
                          })}
                          {activeSlot !== "base" && (
                            <button
                              type="button"
                              onClick={handleResetActive}
                              className="text-xs mt-1 px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
                            >
                              Reset {activeSlot.replace("-", " ")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* RIGHT: large color picker */}
              <div className="flex flex-col gap-2 flex-1 min-h-0">
                <div className="text-xs uppercase font-bold text-gray-500 tracking-wider">
                  {activeSlot === "base"
                    ? `Pick a base color for ${activeChannel}`
                    : `Pick a color for ${activeChannel} ${activeSlot.replace("-", " ")}`}
                </div>
                <div className="flex flex-row gap-2 flex-wrap">
                  {families.map((family) => {
                    const isActive = activeFamily === family;
                    return (
                      <button
                        key={family}
                        type="button"
                        onClick={() => setActiveFamily(family)}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          isActive
                            ? "bg-blue-600 text-white"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                      >
                        {family}
                      </button>
                    );
                  })}
                </div>
                <div
                  className="grid grid-cols-12 gap-1 flex-1 min-h-0"
                  style={{ gridAutoRows: "1fr" }}
                >
                  {swatches.map((hex) => {
                    const isSelected =
                      activeSlot === "base" &&
                      baseHex &&
                      hex.toLowerCase() === baseHex.toLowerCase();
                    return (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => handlePickColor(hex)}
                        style={{ backgroundColor: hex }}
                        className={`w-full h-full rounded transition-transform hover:scale-110 ${
                          isSelected
                            ? "border-2 border-yellow-400 scale-110"
                            : ""
                        }`}
                        aria-label={`Pick ${hex}`}
                        title={hex}
                      />
                    );
                  })}
                </div>
                <CustomHexColorPane
                  onApply={handleApplyHex}
                  label="Or paste a hex value"
                />
              </div>
            </div>
          </div>
        </DashPanel.Body>
        <DashPanel.Footer>
          <Button
            title="Done"
            block={true}
            onClick={() => setIsOpen && setIsOpen(false)}
          />
        </DashPanel.Footer>
      </DashPanel>
    </Modal>
  );
};

export default ChannelEditorModal;
