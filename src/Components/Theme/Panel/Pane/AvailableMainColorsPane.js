import React from "react";
import ThemePane from "./ThemePane";
import { colorNames } from "@trops/dash-react";
import { Button } from "@trops/dash-react";
import CustomHexColorPane from "./CustomHexColorPane";

const AvailableMainColorsPane = ({
  theme,
  themeVariant,
  mainColor,
  onChooseColor,
}) => {
  function handleSelectMainColor(colorName) {
    onChooseColor(mainColor, colorName);
  }

  function handleApplyHex(hex) {
    // Pass the hex value through the same callback as named colors.
    // ThemeModel (v0.1.568+) detects hex strings and routes the
    // channel through its arbitrary-color-themes pipeline.
    onChooseColor(mainColor, hex);
  }

  function renderAvailableColors() {
    const tempTheme = theme[themeVariant];
    return colorNames.sort().map((colorName) => {
      const stringColor = `bg-${colorName}-${"500"}`;
      const selected = colorName === tempTheme[mainColor];
      return (
        <div
          className={`flex w-full h-full m-2 ${stringColor} ${
            selected === true ? "opacity-100" : "opacity-100"
          } rounded`}
          onClick={() => handleSelectMainColor(colorName)}
        >
          {/* {selected === true ? (<span className="font-bold text-5xl">1</span>) : null} */}
        </div>
      );
    });
  }

  return (
    <ThemePane>
      <div className="flex grid grid-cols-3 w-full overflow-y-scroll">
        {renderAvailableColors()}
      </div>
      <CustomHexColorPane
        onApply={handleApplyHex}
        label={`Custom hex for ${mainColor || "channel"}`}
      />
      <Button title="Cancel" />
    </ThemePane>
  );
};

export default AvailableMainColorsPane;
