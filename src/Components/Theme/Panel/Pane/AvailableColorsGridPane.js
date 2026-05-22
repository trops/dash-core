import React from "react";
import { colorNames, shades } from "@trops/dash-react";

import ColorTile from "../../../../Components/Theme/Panel/MenuItem/ColorTile";
import { ColorModel } from "../../../../Models";
import { Button, DashPanel, Modal } from "@trops/dash-react";
import { capitalizeFirstLetter } from "../../../../utils";
import CustomHexColorPane from "./CustomHexColorPane";
import CategorizedColorGrid from "./CategorizedColorGrid";

const AvailableColorsGridPane = ({
  currentColor = null,
  colorType = "primary",
  onClick = null,
  onCancel = null,
  onMouseOver = null,
  shade = null,
}) => {
  function handleChooseColor(data) {
    onClick !== null && onClick(data);
  }

  function handleChooseColorTemp(data) {
    onMouseOver !== null && onMouseOver(data);
  }

  function handleCancel() {
    onCancel && onCancel(currentColor);
  }

  function renderAvailableColors() {
    return colorNames.sort().map((colorName) => {
      return shades
        .filter((c) => (shade === null ? true : c === shade))
        .map((shadeLevel) => {
          const cModel = ColorModel({
            colorName,
            colorType,
            shade: shadeLevel,
            level: shadeLevel,
          });

          return (
            <div className="flex flex-row justify-between items-center py-2 border-b border-gray-700">
              <div className="flex flex-col">
                <span className="text-sm font-bold text-gray-300">
                  {capitalizeFirstLetter(colorName)} {shadeLevel}
                </span>
                {cModel && (
                  <span className="text-xs font-light text-gray-500">
                    {cModel.hex[shadeLevel]}
                  </span>
                )}
                {!cModel && (
                  <span className="text-xs font-light text-gray-500">NA</span>
                )}
              </div>
              <ColorTile
                width={"w-2/3"}
                colorType={colorType}
                colorName={colorName}
                colorLevelName={shadeLevel}
                shade={shadeLevel}
                onClick={handleChooseColor}
                onMouseOver={handleChooseColorTemp}
              />
            </div>
          );
        });
    });
  }

  // The picker renders inside a modal so it has room for the full
  // categorized grid without the user having to scroll within a
  // cramped left-column. Mount/unmount of this component is driven
  // by the parent (ThemeMenuPane) based on `selectedColor` state —
  // so `isOpen` is effectively always `true` while mounted, and
  // closing the modal triggers `onCancel` to unmount.
  const isMain = shade !== null;
  const title = isMain
    ? `Pick ${capitalizeFirstLetter(colorType || "color")} color`
    : "Available Colors";

  return (
    <Modal
      isOpen={true}
      setIsOpen={() => handleCancel()}
      width="w-3/4"
      height="h-3/4"
    >
      <DashPanel height="h-full" scrollable={true}>
        <DashPanel.Header title={title} />
        <DashPanel.Body scrollable={true} space={true}>
          {/* MAIN mode: discoverable categorized grid + hex input.
              SUB mode: legacy per-shade grid (power-user surface
              for per-component overrides). */}
          {isMain ? (
            <>
              <CategorizedColorGrid
                cols={12}
                onSelect={(hex) =>
                  handleChooseColor({
                    colorName: hex,
                    colorType,
                    shade: shade || 500,
                    panelType: "main",
                  })
                }
              />
              <CustomHexColorPane
                onApply={(hex) =>
                  handleChooseColor({
                    colorName: hex,
                    colorType,
                    shade: shade || 500,
                    panelType: "main",
                  })
                }
                label={`Custom hex for ${colorType || "channel"}`}
              />
            </>
          ) : (
            <div className="flex flex-col space-y-1">
              {renderAvailableColors()}
            </div>
          )}
        </DashPanel.Body>
        {onCancel && (
          <DashPanel.Footer>
            <Button title="Cancel" block={true} onClick={handleCancel} />
          </DashPanel.Footer>
        )}
      </DashPanel>
    </Modal>
  );
};

export default AvailableColorsGridPane;
