import React from "react";
import { isHexColor } from "@trops/dash-react";

/**
 * BaseColorRail — 4-channel base color editor.
 *
 * Clean column of swatches (Primary / Secondary / Tertiary / Neutral).
 * Clicking a swatch opens the ChannelEditorModal — that surface holds
 * the base color picker, the 5 derived shades, and constrained
 * per-shade override editing in one place (no inline chevron / accordion).
 *
 * Props:
 *   - theme: ThemeModel output (read .dark[channel] / .light[channel]).
 *   - themeVariant: "dark" | "light".
 *   - onEditChannel: (channelKey) => void  — fired when the user clicks
 *     a swatch. Parent opens the ChannelEditorModal scoped to that
 *     channel.
 */

const CHANNELS = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "tertiary", label: "Tertiary" },
  { key: "neutral", label: "Neutral" },
];

function swatchDisplay(channelValue) {
  if (isHexColor(channelValue)) {
    return { style: { backgroundColor: channelValue }, className: "" };
  }
  if (typeof channelValue === "string" && channelValue) {
    return { style: undefined, className: `bg-${channelValue}-500` };
  }
  return { style: undefined, className: "bg-gray-700" };
}

const BaseColorRail = ({ theme, themeVariant = "dark", onEditChannel }) => (
  <div className="flex flex-col space-y-3 p-3">
    <div className="text-xs uppercase font-bold text-gray-500 tracking-wider">
      Base Colors
    </div>
    <div className="text-xs text-gray-500 leading-snug">
      Pick a base color for each channel. The 5 shades for each channel
      auto-derive from the base — you can override individual shades in the
      editor that opens.
    </div>
    {CHANNELS.map((c) => {
      const value = theme?.[themeVariant]?.[c.key];
      const display = swatchDisplay(value);
      return (
        <div key={c.key} className="flex flex-col space-y-1">
          <span className="text-sm font-bold text-gray-300">{c.label}</span>
          <button
            type="button"
            onClick={() => onEditChannel && onEditChannel(c.key)}
            className={`w-full h-12 rounded border-2 border-gray-700 hover:border-yellow-500 cursor-pointer ${display.className}`}
            style={display.style}
            aria-label={`Edit ${c.label} color`}
            title={typeof value === "string" ? value : "Choose color"}
          />
        </div>
      );
    })}
  </div>
);

export default BaseColorRail;
