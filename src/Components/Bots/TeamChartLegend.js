import React, { useContext } from "react";
import { ThemeContext, DASH_ROLES } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

/**
 * The team diagram's card styles while a bot is selected (DASH-139), one
 * per cardState(): the selected bot is unmistakable (a thick accent border,
 * a ring, an accent-tinted card and a "Selected" marker), the bots linked
 * to it get a thin accent border, the ones getting its failures a dashed
 * red one, and the rest are dimmed. The accent comes from the theme
 * (`border-primary-medium`, the accentSoft role; Aurora's --accent for the
 * ring); the bare Tailwind colours are fallbacks only.
 */
export function useSelectionStyles() {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const { hairline, fieldBg, accent } = useConfigTokens();
  const accentBorder =
    currentTheme?.["border-primary-medium"] || "border-indigo-400";
  const accentSoft = `${
    currentTheme?.[DASH_ROLES.accentSoft.key] || "bg-indigo-950"
  } ${DASH_ROLES.accentSoft.role}`;
  return {
    accent,
    accentSoft,
    frame: {
      selected: `border-2 ${accentBorder}`,
      linked: `border ${accentBorder}`,
      failure: "border border-dashed border-red-400",
      dimmed: `border ${hairline}`,
      none: `border ${hairline}`,
    },
    bg: { selected: accentSoft, other: fieldBg },
    // Box shadows can't take a theme class: the ring follows Aurora's
    // accent, with a soft indigo where the theme has none.
    ring: "0 0 0 3px color-mix(in srgb, var(--accent, #818cf8) 30%, transparent)",
    dimOpacity: 0.4,
  };
}

/** The small "Selected" marker on the selected card. */
export const SelectedMarker = ({ className = "", style }) => {
  const { accent, accentSoft } = useSelectionStyles();
  return (
    <span
      data-testid="selected-marker"
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${accent} ${accentSoft} ${className}`}
      style={style}
    >
      Selected
    </span>
  );
};

/**
 * TeamChartLegend — explains the diagram's selection styles next to the
 * Lines toggle: Selected · Linked · Gets its failures · Dimmed.
 */
export const TeamChartLegend = () => {
  const { muted } = useConfigTokens();
  const s = useSelectionStyles();
  const swatch = (frame, bg, extra = {}) => (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-4 rounded ${frame} ${bg}`}
      style={extra}
    />
  );
  const item = (key, label, sw) => (
    <span key={key} className="inline-flex items-center gap-1">
      {sw}
      <span>{label}</span>
    </span>
  );
  return (
    <span
      data-testid="team-chart-legend"
      aria-label="Diagram key"
      className={`inline-flex flex-row flex-wrap items-center gap-2 text-xs ${muted}`}
    >
      {item(
        "selected",
        "Selected",
        swatch(s.frame.selected, s.bg.selected, { boxShadow: s.ring }),
      )}
      <span aria-hidden="true">·</span>
      {item("linked", "Linked", swatch(s.frame.linked, s.bg.other))}
      <span aria-hidden="true">·</span>
      {item(
        "failure",
        "Gets its failures",
        swatch(s.frame.failure, s.bg.other),
      )}
      <span aria-hidden="true">·</span>
      {item(
        "dimmed",
        "Dimmed",
        swatch(s.frame.dimmed, s.bg.other, { opacity: s.dimOpacity }),
      )}
    </span>
  );
};

export default TeamChartLegend;
