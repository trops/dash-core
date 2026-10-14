import React, { useContext } from "react";
import {
  Button,
  Modal,
  SectionLabel,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BudgetField } from "./BudgetField";
import { useSpending } from "./useSpending";
import { budgetStateLabel, spentLine } from "./spendingText";

/**
 * TeamBudgetDialog — a dashboard's team budget (bot-factory US-019 AC2):
 * one monthly limit for all its bots together, the team's spending this
 * month, and each bot's share.
 *
 * @param {boolean} open
 * @param {{ id, name }} workspace
 * @param {() => void} onClose
 */
export const TeamBudgetDialog = ({ open, workspace, onClose }) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const { muted, hairline } = useConfigTokens();
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const { summary, setBudget } = useSpending();
  if (!open || !workspace) return null;
  const id = String(workspace.id);
  const team = ((summary && summary.dashboards) || []).find((d) => d.id === id);
  const bots = ((summary && summary.bots) || []).filter(
    (b) => b.workspaceId === id,
  );
  return (
    <Modal
      isOpen={open}
      setIsOpen={(o) => !o && onClose()}
      width="w-1/3"
      height="h-auto"
    >
      <div
        className={`flex flex-col gap-4 p-6 rounded-lg border ${hairline} ${panel.backgroundColor || "bg-gray-900"} ${panel.textColor || "text-gray-200"}`}
        data-testid="team-budget"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold" style={{ margin: 0 }}>
            Team budget — {workspace.name}
          </h2>
          <span className={`text-sm ${muted}`}>
            One monthly limit for all of this dashboard&apos;s bots together.
            When the team reaches it, its bots stop until you raise it or keep a
            bot running this month.
          </span>
        </div>
        <span className="text-sm" data-testid="team-budget-spent">
          This month: {spentLine(team)}
        </span>
        <BudgetField
          label="Limit (USD a month)"
          budget={team ? team.budget : null}
          onSave={(usd) => setBudget("workspace", id, usd)}
          testId="team-budget-field"
        />
        {bots.length ? (
          <div className="flex flex-col gap-1">
            <SectionLabel text="Each bot this month" />
            {bots.map((b) => (
              <div
                key={b.id}
                className="flex flex-row items-baseline justify-between gap-3 text-sm"
              >
                <span className="truncate">{b.name}</span>
                <span className={`text-xs ${muted} flex-shrink-0`}>
                  {spentLine(b)}
                  {budgetStateLabel(b) ? ` · ${budgetStateLabel(b)}` : ""}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex flex-row justify-end">
          <Button title="Done" size="sm" onClick={onClose} />
        </div>
      </div>
    </Modal>
  );
};

export default TeamBudgetDialog;
