import React from "react";
import ThemePane from "./ThemePane";
import { Button, isHexColor } from "@trops/dash-react";
import CustomHexColorPane from "./CustomHexColorPane";
import CategorizedColorGrid from "./CategorizedColorGrid";

const AvailableMainColorsPane = ({
  theme,
  themeVariant,
  mainColor,
  onChooseColor,
}) => {
  function handleSelectColor(colorValue) {
    // Pass any color (named string or hex) through the same callback.
    // ThemeModel detects hex strings via isHexColor and routes the
    // channel through the arbitrary-color-themes pipeline; named
    // strings stay on the legacy path. PRD: arbitrary-color-themes.md.
    onChooseColor(mainColor, colorValue);
  }

  // The current channel value — used to highlight which swatch is
  // currently active (when it's a hex). Named-color themes show no
  // swatch highlight in the curated grid; that's the expected
  // behavior since the curated grid doesn't claim parity with the
  // sunset named grid.
  const currentValue = theme?.[themeVariant]?.[mainColor];
  const currentHex = isHexColor(currentValue) ? currentValue : null;

  return (
    <ThemePane>
      <CategorizedColorGrid
        onSelect={handleSelectColor}
        selectedHex={currentHex}
      />
      <CustomHexColorPane
        onApply={handleSelectColor}
        label={`Custom hex for ${mainColor || "channel"}`}
      />
      <Button title="Cancel" />
    </ThemePane>
  );
};

export default AvailableMainColorsPane;
