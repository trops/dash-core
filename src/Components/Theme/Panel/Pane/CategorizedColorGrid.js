/**
 * CategorizedColorGrid — discoverable hex picker for users who
 * don't think in hex codes.
 *
 * Filter chips at the top let users narrow to a color family
 * (Reds, Oranges, Greens, Blues, Purples, Neutrals). The 6×N grid
 * below shows ~36 swatches per family — HSL-derived from the
 * family's hue range with varied lightness + saturation. Clicking
 * a swatch emits its hex via `onSelect(hex)`.
 *
 * Replaces the 22-color named-Tailwind grid in the wizard +
 * editor (PRD: arbitrary-color-themes.md Phase 3.5). Each emitted
 * hex flows through the existing hex-color pipeline — no safelist
 * growth, no per-color Tailwind classes.
 */
import React, { useState } from "react";
import { getColorFamilies, getCuratedColorGrid } from "@trops/dash-react";

const CategorizedColorGrid = ({ onSelect, selectedHex = null }) => {
  const families = getColorFamilies();
  const [activeFamily, setActiveFamily] = useState(families[0]);
  const colors = getCuratedColorGrid(activeFamily);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Filter chips */}
      <div className="flex flex-row gap-2 flex-wrap">
        {families.map((family) => {
          const isActive = activeFamily === family;
          return (
            <button
              key={family}
              type="button"
              onClick={() => setActiveFamily(family)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
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

      {/* Swatch grid */}
      <div className="grid grid-cols-6 gap-1">
        {colors.map((hex) => {
          const isSelected =
            selectedHex && hex.toLowerCase() === selectedHex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              onClick={() => onSelect(hex)}
              title={hex}
              className={`aspect-square rounded transition-transform hover:scale-110 focus:scale-110 focus:outline-none ${
                isSelected ? "ring-2 ring-white scale-110" : ""
              }`}
              style={{ backgroundColor: hex }}
              aria-label={`Select color ${hex}`}
            />
          );
        })}
      </div>
    </div>
  );
};

export default CategorizedColorGrid;
