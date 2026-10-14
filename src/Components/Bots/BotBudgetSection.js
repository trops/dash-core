import React from "react";
import { Button3, useStatusTokens } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BudgetField } from "./BudgetField";
import { useSpending } from "./useSpending";
import { money, spentLine } from "./spendingText";

/**
 * BotBudgetSection — the bot form's Monthly budget (bot-factory US-019
 * AC2/AC6): its limit, this month's spending, and — when it's over — Keep
 * running this month. Saved on its own (not with the form's Save).
 *
 * @param {object} bot  a saved bot ({ id })
 */
export const BotBudgetSection = ({ bot }) => {
  const { muted, strong } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const { summary, setBudget, keepRunning } = useSpending();
  if (!bot || !bot.id) return null;
  const row = ((summary && summary.bots) || []).find((b) => b.id === bot.id);
  const budget = row ? row.budget : null;
  return (
    <div className="flex flex-col gap-2" data-testid="bot-budget">
      <span className={`text-sm font-medium ${strong}`}>Monthly budget</span>
      <span className={`text-xs ${muted}`} data-testid="bot-budget-spent">
        This month: {spentLine(row)}
        {row && row.budget !== null ? ` · limit ${money(row.budget)}` : ""}
      </span>
      {row && row.over ? (
        <div
          className={`rounded-lg border px-3 py-2 flex flex-col gap-2 text-xs ${statusTokens.warning.bg} ${statusTokens.warning.border}`}
          data-testid="bot-budget-over"
        >
          <span className={statusTokens.warning.text}>
            Over its budget — it won&apos;t run until you raise the limit or
            keep it running this month.
          </span>
          <div>
            <Button3
              title="Keep running this month"
              size="sm"
              onClick={() => keepRunning(bot.id)}
            />
          </div>
        </div>
      ) : null}
      <BudgetField
        label="Limit (USD a month)"
        budget={budget}
        onSave={(usd) => setBudget("bot", bot.id, usd)}
        testId="bot-budget-field"
      />
      <span className={`text-xs ${muted}`}>
        Runs on Claude Code are covered by your Claude plan, so they count as
        tokens, not dollars.
      </span>
    </div>
  );
};

export default BotBudgetSection;
