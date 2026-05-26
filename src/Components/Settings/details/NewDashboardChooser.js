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
 * NewDashboardChooser — consolidated entry point for the
 * "New Dashboard" header button in Settings → Dashboards.
 *
 * Audit #19 fix: the prior header button was labeled "Marketplace"
 * which was ambiguous (it set installMode=marketplace, duplicating
 * the Marketplace tab in the list). Renamed to "New Dashboard"; the
 * chooser presents the actual creation paths as labeled cards,
 * matching the ThemeNewChooser pattern.
 *
 * Options:
 *   - "marketplace" → registry browser (existing DiscoverDashboardsDetail)
 *   - "wizard"      → existing dashboard creation wizard
 *
 * The Marketplace TAB in the list view stays — it's the in-place
 * browse affordance, distinct from this "I want to create a new
 * dashboard" entry.
 */
export const NewDashboardChooser = ({ onSelect }) => {
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
          CREATE A DASHBOARD
        </span>
        <OptionCard
          icon="compass"
          title="Search Marketplace"
          description="Browse and install community dashboards from the online registry"
          onClick={() => onSelect("marketplace")}
          currentTheme={currentTheme}
        />
        <OptionCard
          icon="wand-magic-sparkles"
          title="From Wizard"
          description="Build a new dashboard from a layout + theme + widgets"
          onClick={() => onSelect("wizard")}
          currentTheme={currentTheme}
        />
      </div>
    </div>
  );
};
