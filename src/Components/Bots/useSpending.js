import { useCallback, useEffect, useState } from "react";

/**
 * useSpending — this month's bot spending and limits (bot-factory US-019),
 * kept current: after runs, budget alerts and bot changes. Setting a limit
 * or keeping an over-budget bot running reloads it.
 *
 * @returns {{ summary: object|null, setBudget: (scope, id, usd|null) =>
 *   Promise, keepRunning: (botId) => Promise, reload: () => Promise }}
 *   summary — { month, overall, bots, dashboards, providers } (null while
 *   loading or where bots aren't available)
 */
function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

export function useSpending() {
  const [summary, setSummary] = useState(null);

  const reload = useCallback(async () => {
    const b = api();
    if (!b || !b.spendingSummary) return;
    try {
      const s = await b.spendingSummary();
      if (s && typeof s === "object") setSummary(s);
    } catch (_e) {
      // keep the last good summary
    }
  }, []);

  useEffect(() => {
    reload();
    const b = api();
    if (!b) return undefined;
    const ids = [];
    if (b.onStream) {
      ids.push(
        b.onStream(({ event } = {}) => {
          const t = event && event.type;
          if (t === "done" || t === "error") reload();
        }),
      );
    }
    if (b.onBudgetAlert) ids.push(b.onBudgetAlert(() => reload()));
    if (b.onListChanged) ids.push(b.onListChanged(() => reload()));
    return () => {
      for (const id of ids) if (b.removeListener) b.removeListener(id);
    };
  }, [reload]);

  const setBudget = useCallback(
    async (scope, id, usd) => {
      const b = api();
      if (!b || !b.setBudget) return;
      await b.setBudget(scope, id, usd === null ? null : Number(usd));
      await reload();
    },
    [reload],
  );

  const keepRunning = useCallback(
    async (botId) => {
      const b = api();
      if (b && b.resumeBudget) await b.resumeBudget(botId);
      await reload();
    },
    [reload],
  );

  return { summary, setBudget, keepRunning, reload };
}
