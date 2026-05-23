import React from "react";
import { ColorModel } from "../../../../Models";
import { isHexColor } from "@trops/dash-react";

const ColorTile = ({
  colorFromTheme = null,
  colorName = null,
  shade = null,
  variant = "dark",
  colorType = "primary",
  colorLevelName = null,

  selected = false,
  onClick = null,
  onMouseOver = null,
  width = "w-full",
  height = "h-10",
  ...rest
}) => {
  const c = ColorModel({
    colorFromTheme,
    colorName,
    colorType,
    shade,
    variant,
    level: colorLevelName,
    ...rest,
  });

  // If the channel value is a hex (custom-color theme — PRD
  // arbitrary-color-themes.md), `c.class` becomes `bg-#xxx-500`
  // which isn't a valid Tailwind class and renders as nothing
  // (the dark page background bleeds through, looking black).
  // Use inline style for hex backgrounds; named colors continue
  // through the className path so existing themes are unchanged.
  const colorIsHex = isHexColor(colorName);
  const inlineStyle = colorIsHex ? { backgroundColor: colorName } : undefined;
  const bgClass = colorIsHex ? "" : c.class;

  return (
    <div
      className={`flex flex-col rounded-lg cursor-pointer items-center justify-center border-2 text-xs ${
        selected === true ? "border-yellow-500" : "border-gray-800"
      } hover:border-yellow-500 border-gray-800 ${bgClass} ${width} ${height}`}
      style={inlineStyle}
      onClick={() => (onClick !== null ? onClick({ ...c, ...rest }) : null)}
      onMouseOver={() =>
        onMouseOver !== null ? onMouseOver({ ...c, ...rest }) : null
      }
    >
      &nbsp;
    </div>
  );
};

export default ColorTile;
