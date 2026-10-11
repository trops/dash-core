import React, { useContext } from "react";
import {
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";

export const SectionLayout = ({
  listContent,
  detailContent = null,
  listWidth = "w-80",
  emptyDetailMessage = "Select an item to view details",
  // Narrow containers (the edit panel): the list on top, the detail
  // below, instead of side by side.
  stacked = false,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const headerStyles = getStylesForItem(
    themeObjects.PANEL_HEADER,
    currentTheme,
    { grow: false },
  );

  return (
    <div
      className={`flex ${stacked ? "flex-col" : "flex-row"} flex-1 min-h-0 ${
        panelStyles.textColor || "text-gray-200"
      }`}
    >
      {/* Item List Column */}
      <div
        className={`flex flex-col flex-shrink-0 ${
          stacked ? "w-full max-h-48 border-b" : `${listWidth} border-r`
        } ${headerStyles.borderColor || ""} overflow-y-auto`}
      >
        {listContent}
      </div>

      {/* Detail Column */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {detailContent ? (
          <div className="flex flex-col flex-1 min-h-0">{detailContent}</div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm opacity-40">{emptyDetailMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};
