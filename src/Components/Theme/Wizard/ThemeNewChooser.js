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

/**
 * New theme: how to start. Describe it (lead-workspace theme round, frame
 * 44) opens a Dash Lead conversation that makes it; the others work here,
 * by hand.
 */
export const ThemeNewChooser = ({
  onSearchThemes,
  onSelectMethod,
  onDescribe = null,
}) => (
  <div className="flex flex-col gap-4 p-6 overflow-y-auto flex-1 min-h-0">
    <span className="text-sm opacity-60">How do you want to start?</span>
    <div className={`grid ${onDescribe ? "grid-cols-3" : "grid-cols-2"} gap-3`}>
      {onDescribe ? (
        <ChooserCard
          icon="palette"
          title="Describe it"
          subtitle="Say what you want — the Dash Lead makes it with you"
          onClick={onDescribe}
        />
      ) : null}
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
    {onDescribe ? (
      <span className="text-xs opacity-60">
        Describe it opens a conversation with the Dash Lead — it plans the theme
        with you and shows how it looks before anything is saved. The others
        work here, by hand, as they do today.
      </span>
    ) : null}
  </div>
);
