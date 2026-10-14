import React from "react";
import { Card2, SectionLabel, StatusBadge } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BudgetField } from "../Bots/BudgetField";
import { useSpending } from "../Bots/useSpending";
import {
  budgetStateLabel,
  limitLine,
  monthName,
  providerName,
  spentLine,
} from "../Bots/spendingText";

/**
 * SpendingView — Manage › Bots › Spending (bot-factory US-019 AC2/AC5): this
 * month's bot spending overall, by bot, by dashboard and by AI provider,
 * each against its limit, and the overall monthly budget.
 */
const SpendRow = ({ name, row, muted }) => {
  const label = budgetStateLabel(row);
  return (
    <div
      className="flex flex-row items-center gap-3 py-2"
      data-testid="spending-row"
    >
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-sm font-medium truncate">{name}</span>
        <span className={`text-xs ${muted}`}>
          {spentLine(row)} · {limitLine(row)}
        </span>
      </span>
      {label ? (
        <StatusBadge
          state={label === "Over budget" ? "warning" : "neutral"}
          label={label}
          compact
        />
      ) : null}
    </div>
  );
};

const Group = ({ title, rows, nameOf, empty, muted, hairline, testId }) => (
  <Card2
    padding="p-4"
    rounded="rounded-lg"
    shadow=""
    className="flex flex-col"
    testId={testId}
  >
    <SectionLabel text={title} />
    {rows.length ? (
      rows.map((r, i) => (
        <div key={r.id || i} className={i ? `border-t ${hairline}` : ""}>
          <SpendRow name={nameOf(r)} row={r} muted={muted} />
        </div>
      ))
    ) : (
      <span className={`text-sm py-2 ${muted}`}>{empty}</span>
    )}
  </Card2>
);

export const SpendingView = () => {
  const { muted, strong, hairline } = useConfigTokens();
  const { summary, setBudget } = useSpending();
  if (!summary) {
    return (
      <span className={`text-sm ${muted}`} data-testid="spending-loading">
        Loading spending…
      </span>
    );
  }
  const overallLabel = budgetStateLabel(summary.overall);
  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 pb-6 ${strong}`}
      data-testid="spending-view"
    >
      <Card2
        padding="p-4"
        rounded="rounded-lg"
        shadow=""
        className="flex flex-col gap-3"
        testId="spending-overall"
      >
        <div className="flex flex-row items-center gap-3">
          <h3 className="text-sm font-semibold" style={{ margin: 0 }}>
            {monthName(summary.month)} — all bots
          </h3>
          {overallLabel ? (
            <StatusBadge
              state={overallLabel === "Over budget" ? "warning" : "neutral"}
              label={overallLabel}
              compact
            />
          ) : null}
        </div>
        <span className="text-sm" data-testid="spending-overall-line">
          {spentLine(summary.overall)} · {limitLine(summary.overall)}
        </span>
        <BudgetField
          label="Limit (USD a month)"
          budget={summary.overall.budget}
          onSave={(usd) => setBudget("global", null, usd)}
          testId="spending-overall-field"
        />
        <span className={`text-xs ${muted}`}>
          Every bot&apos;s spending counts toward this. Runs on Claude Code are
          covered by your Claude plan, so they count as tokens, not dollars. Set
          a bot&apos;s own limit in its Settings, and a dashboard&apos;s in its
          Bots view (Team budget).
        </span>
      </Card2>
      <div className="grid grid-cols-3 gap-4">
        <Group
          title="By bot"
          rows={summary.bots}
          nameOf={(r) => r.name}
          empty="No bots yet."
          muted={muted}
          hairline={hairline}
          testId="spending-bots"
        />
        <Group
          title="By dashboard"
          rows={summary.dashboards}
          nameOf={(r) => r.name}
          empty="No dashboard spending or limits yet."
          muted={muted}
          hairline={hairline}
          testId="spending-dashboards"
        />
        <Group
          title="By AI provider"
          rows={summary.providers}
          nameOf={(r) => providerName(r.id)}
          empty="No runs counted by provider yet — this starts with the next run."
          muted={muted}
          hairline={hairline}
          testId="spending-providers"
        />
      </div>
    </div>
  );
};

export default SpendingView;
