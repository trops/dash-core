import { useCallback, useEffect, useMemo, useState } from "react";
import { useBotMonitor } from "./useBotMonitor";

/**
 * useBotContacts — the Bots dock (bot-teams PRD TEAM-015): everything the
 * monitor knows (bots, approvals, what's running; approve, stop) plus each
 * bot's latest run and who's paused, kept current from the main process.
 */
const NO_RUNS = {};

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

export function useBotContacts() {
  const monitor = useBotMonitor();
  const [lastRuns, setLastRuns] = useState(NO_RUNS);
  const [paused, setPaused] = useState(() => new Set());
  // { [botId]: n } events waiting for paused / over-budget bots (US-011 AC8).
  const [queued, setQueued] = useState(NO_RUNS);
  // { [botId]: botStatus } — over budget / near it (US-019).
  const [budgets, setBudgets] = useState(NO_RUNS);

  const loadBudgets = useCallback(async () => {
    const b = api();
    if (!b || !b.budgetStatus) return;
    try {
      const map = await b.budgetStatus();
      setBudgets(map && typeof map === "object" ? map : NO_RUNS);
    } catch (_e) {
      // keep the last good map
    }
  }, []);

  const loadLastRuns = useCallback(async () => {
    const b = api();
    if (!b || !b.lastRuns) return;
    try {
      const map = await b.lastRuns();
      setLastRuns(map && typeof map === "object" ? map : NO_RUNS);
    } catch (_e) {
      // keep the last good map
    }
  }, []);

  const loadPaused = useCallback(async () => {
    const b = api();
    if (!b || !b.getPauseState) return;
    try {
      const state = await b.getPauseState();
      setPaused(new Set((state && state.bots) || []));
      setQueued((state && state.queued) || NO_RUNS);
    } catch (_e) {
      // keep the last good set
    }
  }, []);

  useEffect(() => {
    loadLastRuns();
    loadPaused();
    loadBudgets();
  }, [loadLastRuns, loadPaused, loadBudgets]);

  useEffect(() => {
    const b = api();
    if (!b) return undefined;
    const ids = [];
    if (b.onStream) {
      ids.push(
        b.onStream(({ event }) => {
          const t = event && event.type;
          if (t === "done" || t === "error") {
            loadLastRuns();
            loadBudgets();
          }
        }),
      );
    }
    if (b.onListChanged) {
      ids.push(
        b.onListChanged(() => {
          loadLastRuns();
          loadPaused();
          loadBudgets();
        }),
      );
    }
    if (b.onBudgetAlert) ids.push(b.onBudgetAlert(() => loadBudgets()));
    return () => {
      for (const id of ids) if (b.removeListener) b.removeListener(id);
    };
  }, [loadLastRuns, loadPaused, loadBudgets]);

  // Keep an over-budget bot running for the rest of this month (US-019 AC6).
  const keepRunning = useCallback(
    async (botId) => {
      const b = api();
      if (b && b.resumeBudget) await b.resumeBudget(botId);
      loadBudgets();
    },
    [loadBudgets],
  );

  const setBotPaused = useCallback(
    async (botId, pause) => {
      const b = api();
      if (!b) return;
      if (pause && b.pauseBot) await b.pauseBot(botId);
      if (!pause && b.resumeBot) await b.resumeBot(botId);
      loadPaused();
    },
    [loadPaused],
  );

  return useMemo(
    () => ({
      ...monitor,
      lastRuns,
      paused,
      queued,
      setBotPaused,
      budgets,
      keepRunning,
    }),
    [monitor, lastRuns, paused, queued, setBotPaused, budgets, keepRunning],
  );
}
