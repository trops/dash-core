import React, { useContext } from "react";
import { FontAwesomeIcon, SectionLabel } from "@trops/dash-react";
import { ThemeContext } from "../../Context";
import { formatMonthCost } from "./editSelection";

/**
 * EditBotsRow — "Bots on this dashboard" under the grid in the dashboard
 * editor (create-entry phase 1c, CRE-006 AC1). Each bot shows its model and
 * what it cost this month; clicking one selects it. Bots connected to the
 * selected widget are marked; with a widget selected, the rest dim.
 *
 * Raw buttons on theme tokens: dash-react has no selectable chip primitive.
 */
export const EditBotsRow = ({
  bots = [],
  spend = null,
  selection = null,
  related = { widgets: new Set(), bots: new Set() },
  onSelect = () => {},
}) => {
  const { currentTheme = {} } = useContext(ThemeContext);
  if (!Array.isArray(bots) || bots.length === 0) return null;

  return (
    <div
      className={`flex flex-col gap-2 px-4 py-3 border-t ${
        currentTheme["border-primary-dark"] || ""
      }`}
    >
      <SectionLabel>Bots on this dashboard</SectionLabel>
      <div className="flex flex-row flex-wrap gap-2">
        {bots.map((bot) => {
          const isSelected =
            selection?.kind === "bot" && selection.botId === bot.id;
          const state = isSelected
            ? "selected"
            : related.bots.has(bot.id)
              ? "related"
              : selection?.kind === "widget"
                ? "dimmed"
                : undefined;
          const ring =
            state === "selected"
              ? "ring-2 ring-blue-500"
              : state === "related"
                ? "ring-2 ring-green-500"
                : state === "dimmed"
                  ? "opacity-50"
                  : "";
          const name = bot.name || bot.id;
          return (
            <button
              key={bot.id}
              type="button"
              aria-pressed={isSelected ? "true" : "false"}
              data-state={state}
              onClick={() =>
                onSelect({ kind: "bot", botId: bot.id, label: name })
              }
              className={`flex flex-row items-center gap-2 px-3 py-2 rounded-md border text-left ${
                currentTheme["border-primary-medium"] || ""
              } ${currentTheme["bg-primary-dark"] || ""} ${
                currentTheme["text-primary-light"] || ""
              } ${ring}`}
            >
              <FontAwesomeIcon
                icon="robot"
                className="h-3.5 w-3.5 opacity-70"
              />
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{name}</span>
                <span
                  className={`text-xs ${currentTheme["text-primary-medium"] || ""}`}
                >
                  {`${bot.model || "Default model"} · ${formatMonthCost(
                    spend,
                    bot.id,
                  )}`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
