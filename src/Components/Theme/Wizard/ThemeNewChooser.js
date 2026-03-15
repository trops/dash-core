import React from "react";
import { FontAwesomeIcon } from "@trops/dash-react";

const ChooserCard = ({ icon, title, subtitle, onClick }) => (
  <div
    className="flex flex-col gap-1.5 p-4 rounded-lg cursor-pointer transition-all bg-white/5 hover:bg-white/10 hover:ring-1 hover:ring-white/20"
    onClick={onClick}
  >
    <div className="flex flex-row items-center gap-2">
      <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5 opacity-50" />
      <span className="text-sm font-medium">{title}</span>
    </div>
    <span className="text-xs opacity-40">{subtitle}</span>
  </div>
);

export const ThemeNewChooser = ({
  onSearchThemes,
  onCreateNew,
  onCreateFromUrl = null,
}) => (
  <div className="flex flex-col gap-6 p-6 overflow-y-auto flex-1 min-h-0">
    <span className="text-sm font-semibold opacity-50">Add a Theme</span>
    <div className="grid grid-cols-2 gap-3">
      <ChooserCard
        icon="magnifying-glass"
        title="Search for Themes"
        subtitle="Browse the theme marketplace"
        onClick={onSearchThemes}
      />
      <ChooserCard
        icon="wand-magic-sparkles"
        title="Create New"
        subtitle="Build from presets, random palettes, or color harmony rules"
        onClick={onCreateNew}
      />
      {onCreateFromUrl && (
        <ChooserCard
          icon="globe"
          title="From Website"
          subtitle="Extract colors from any URL to create a theme"
          onClick={onCreateFromUrl}
        />
      )}
    </div>
  </div>
);
