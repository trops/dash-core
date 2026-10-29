import React, { useContext } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";

const OptionCard = ({ icon, title, description, onClick, currentTheme }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex flex-row items-center gap-4 p-4 rounded-lg text-left transition-opacity ${
      currentTheme["bg-primary-medium"] || "bg-white/5"
    } hover:opacity-80`}
  >
    <div className="flex-shrink-0 h-8 w-8 flex items-center justify-center opacity-60">
      <FontAwesomeIcon icon={icon} className="h-5 w-5" />
    </div>
    <div className="flex flex-col min-w-0">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs opacity-50 mt-0.5">{description}</span>
    </div>
    <div className="flex-shrink-0 ml-auto opacity-30">
      <FontAwesomeIcon icon="chevron-right" className="h-3 w-3" />
    </div>
  </button>
);

/**
 * InstallWidgetPicker — the consolidated chooser shown when the
 * "New Widget" header button is clicked (audit #19).
 *
 * Options (consolidation Phase 3b: the Dash team first, then by hand):
 * 1. Describe it to the Dash team (a Dash Lead conversation about a widget)
 * 2. Build it by hand (the Widget Builder, no AI)
 * 3. Search for Widgets (registry browser)
 * 4. Install from File (.zip)
 * 5. Load from Folder
 */
export const InstallWidgetPicker = ({ onSelect }) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className={`flex-1 overflow-y-auto p-6 space-y-3 ${
          panelStyles.textColor || "text-gray-200"
        }`}
      >
        <span className="text-xs font-semibold opacity-50 block mb-4">
          CREATE A WIDGET
        </span>
        <OptionCard
          icon="wand-magic-sparkles"
          title="Describe it to the Dash team"
          description="Say what it should do; the team plans it, builds it, checks it and shows it running first"
          onClick={() => onSelect("dash-team")}
          currentTheme={currentTheme}
        />
        <OptionCard
          icon="wrench"
          title="Build it by hand"
          description="Pick a layout and parts yourself in the Widget Builder. No AI"
          onClick={() => onSelect("builder")}
          currentTheme={currentTheme}
        />
        <OptionCard
          icon="compass"
          title="Search for Widgets"
          description="Browse and install widgets from the online registry"
          onClick={() => onSelect("discover")}
          currentTheme={currentTheme}
        />
        <OptionCard
          icon="file-zipper"
          title="Install from File"
          description="Install a widget package from a .zip file on your computer"
          onClick={() => onSelect("zip")}
          currentTheme={currentTheme}
        />
        <OptionCard
          icon="folder-open"
          title="Load from Folder"
          description="Load all widgets from a local folder — great for restoring a backup"
          onClick={() => onSelect("folder")}
          currentTheme={currentTheme}
        />
      </div>
    </div>
  );
};
