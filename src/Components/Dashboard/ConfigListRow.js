import React, { useContext } from "react";
import { ThemeContext, DASH_ROLES } from "@trops/dash-react";

/**
 * Theme tokens shared by the Dashboard Config modal — the same ones the Bots
 * view reads (BotsView / BotChat), so the two surfaces look alike and follow
 * theme switches. The theme keys are the design guide's color roles
 * (dash-react DASH_ROLES, the keys behind useDashTokens); bare Tailwind
 * colours are fallbacks only.
 */
export function useConfigTokens() {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const key = (role) => currentTheme?.[DASH_ROLES[role].key];
  return {
    muted: key("muted") || "text-gray-400",
    strong: key("text") || "text-gray-200",
    hairline: key("hairline") || "border-gray-700",
    selectedBg: key("surface") || "bg-gray-800",
    selectedBorder: currentTheme?.["border-primary-dark"] || "border-gray-600",
    fieldBg: key("well") || "bg-gray-900",
  };
}

/**
 * A row in one of the modal's left-hand lists (provider types, widgets,
 * event handlers) — styled like the Bots view's team list.
 *
 * @param {{ title: React.ReactNode, subtitle?: React.ReactNode,
 *           meta?: React.ReactNode, badge?: React.ReactNode,
 *           active?: boolean, mono?: boolean, onClick: () => void }} props
 *   `subtitle` is a registry id (monospace); `meta` a muted count line.
 */
export const ConfigListRow = ({
  title,
  subtitle = null,
  meta = null,
  badge = null,
  active = false,
  mono = false,
  onClick,
}) => {
  const { muted, selectedBg, selectedBorder } = useConfigTokens();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`w-full text-left rounded-lg px-3 py-2 border ${
        active ? `${selectedBg} ${selectedBorder}` : "border-transparent"
      }`}
    >
      <div className="flex flex-row items-center justify-between gap-2 min-w-0">
        <span
          className={`text-sm font-medium truncate ${mono ? "font-mono" : ""}`}
        >
          {title}
        </span>
        {badge}
      </div>
      {subtitle ? (
        <div
          className={`text-xs font-mono truncate mt-0.5 ${muted}`}
          title={typeof subtitle === "string" ? subtitle : undefined}
        >
          {subtitle}
        </div>
      ) : null}
      {meta ? <div className={`text-xs mt-0.5 ${muted}`}>{meta}</div> : null}
    </button>
  );
};
