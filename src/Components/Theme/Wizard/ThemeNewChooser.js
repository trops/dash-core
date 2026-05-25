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

export const ThemeNewChooser = ({ onSearchThemes, onSelectMethod }) => (
  <div className="flex flex-col gap-6 p-6 overflow-y-auto flex-1 min-h-0">
    <div className="grid grid-cols-2 gap-3">
      <ChooserCard
        icon="magnifying-glass"
        title="Search Marketplace"
        subtitle="Browse community themes"
        onClick={onSearchThemes}
      />
      <ChooserCard
        icon="swatchbook"
        title="From Presets"
        subtitle="Start from a curated preset"
        onClick={() => onSelectMethod("presets")}
      />
      <ChooserCard
        icon="droplet"
        title="From Colors"
        subtitle="Build from a color palette"
        onClick={() => onSelectMethod("color")}
      />
      <ChooserCard
        icon="shuffle"
        title="From Random"
        subtitle="Generate a random theme"
        onClick={() => onSelectMethod("random")}
      />
      <ChooserCard
        icon="globe"
        title="From Website"
        subtitle="Extract colors from any URL"
        onClick={() => onSelectMethod("from-url")}
      />
    </div>
  </div>
);
