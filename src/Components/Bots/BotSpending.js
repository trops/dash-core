import React, { useEffect, useState } from "react";
import { SectionLabel } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { runCostLabel } from "../../utils/runCostLabel";
import { BotBudgetSection } from "./BotBudgetSection";

/**
 * BotSpending — the bot page's Spending tab (app-navigation NAV-016): this
 * month's spend and limit (BotBudgetSection), then what each recent run cost.
 */
const RUN_LIMIT = 50;

export function useRecentRuns(botId) {
  const [runs, setRuns] = useState(null);
  useEffect(() => {
    let alive = true;
    const b = window.mainApi && window.mainApi.bots;
    if (!b || !b.getRuns) {
      setRuns([]);
      return undefined;
    }
    Promise.resolve(b.getRuns(botId, RUN_LIMIT))
      .then((list) => {
        // Oldest first from the API — newest first here.
        if (alive) setRuns(Array.isArray(list) ? list.slice().reverse() : []);
      })
      .catch(() => alive && setRuns([]));
    return () => {
      alive = false;
    };
  }, [botId]);
  return runs;
}

export const BotSpending = ({ bot }) => {
  const { muted, hairline } = useConfigTokens();
  const runs = useRecentRuns(bot.id);
  const costed = (runs || []).filter((r) => runCostLabel(r));
  return (
    <div className="flex flex-col gap-6" data-testid="bot-spending">
      <BotBudgetSection bot={bot} />
      <div className="flex flex-col gap-2">
        <SectionLabel text="Recent runs" />
        {runs === null ? (
          <span className={`text-sm ${muted}`}>Loading…</span>
        ) : costed.length ? (
          <div className="flex flex-col">
            {costed.map((r, i) => (
              <div
                key={r.startedAt || i}
                className={`flex flex-row items-center justify-between gap-3 py-2 border-b text-sm ${hairline}`}
                data-testid="bot-spending-run"
              >
                <span className="truncate">
                  {r.startedAt ? new Date(r.startedAt).toLocaleString() : "Run"}
                </span>
                <span className={`text-xs flex-shrink-0 ${muted}`}>
                  {runCostLabel(r)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className={`text-sm ${muted}`}>No runs yet.</span>
        )}
      </div>
    </div>
  );
};

export default BotSpending;
