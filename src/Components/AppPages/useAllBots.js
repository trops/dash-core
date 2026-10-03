import { useCallback, useEffect, useMemo, useState } from "react";
import { botStatus } from "../Bots/botConversation";
import { lastRunsByBot } from "./botSummary";

/**
 * useAllBots — every bot, live, for the Bots page (app-navigation NAV-006):
 * the bots, who's running, pause state, waiting approvals and each bot's
 * last run (one `listRecentRuns` call, not one request per bot). Mirrors
 * useTeamBots without the team filter.
 */
const EMPTY = [];
const NOT_PAUSED = { global: false, bots: [] };
const RECENT_LIMIT = 50;

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

export function useAllBots() {
  const [bots, setBots] = useState(EMPTY);
  const [running, setRunning] = useState(EMPTY);
  const [paused, setPaused] = useState(NOT_PAUSED);
  const [approvals, setApprovals] = useState(EMPTY);
  const [lastRuns, setLastRuns] = useState({});
  const [loading, setLoading] = useState(true);

  const loadRecent = useCallback(async () => {
    const b = api();
    if (!b || !b.listRecentRuns) return;
    try {
      setLastRuns(lastRunsByBot(await b.listRecentRuns(RECENT_LIMIT)));
    } catch (_e) {
      // keep the last good view
    }
  }, []);

  const refresh = useCallback(async () => {
    const b = api();
    if (!b) {
      setLoading(false);
      return;
    }
    try {
      const [list, run, pause, pending] = await Promise.all([
        b.list ? b.list() : EMPTY,
        b.listRunning ? b.listRunning() : EMPTY,
        b.getPauseState ? b.getPauseState() : NOT_PAUSED,
        b.listApprovals ? b.listApprovals() : EMPTY,
        loadRecent(),
      ]);
      setBots(Array.isArray(list) ? list : EMPTY);
      setRunning((run || []).map((r) => (r && r.id) || r));
      setPaused(pause || NOT_PAUSED);
      setApprovals(pending || EMPTY);
    } catch (_e) {
      // keep the last good view on a transient IPC error
    } finally {
      setLoading(false);
    }
  }, [loadRecent]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const b = api();
    if (!b) return undefined;
    const ids = [];
    if (b.onRunActive) {
      ids.push(
        b.onRunActive((payload) =>
          setRunning((payload && payload.running) || EMPTY),
        ),
      );
    }
    if (b.onApprovalPending) {
      ids.push(
        b.onApprovalPending((approval) =>
          setApprovals((prev) =>
            prev.some((a) => a.id === approval.id) ? prev : [...prev, approval],
          ),
        ),
      );
    }
    if (b.onStream) {
      ids.push(
        b.onStream(({ event } = {}) => {
          const t = event && event.type;
          if (t === "done" || t === "error" || t === "skipped") loadRecent();
        }),
      );
    }
    if (b.onListChanged) ids.push(b.onListChanged(() => refresh()));
    return () => {
      for (const id of ids) if (b.removeListener) b.removeListener(id);
    };
  }, [refresh, loadRecent]);

  const approve = useCallback(async (approvalId, decision) => {
    const b = api();
    if (b && b.approve) await b.approve(approvalId, decision);
    setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
  }, []);

  return useMemo(
    () => ({
      loading,
      bots,
      statusOf: (botId) =>
        botStatus({
          botId,
          running,
          paused,
          approvals,
          lastRun: lastRuns[botId] || null,
        }),
      approvalsFor: (botId) =>
        approvals.filter((a) => a && a.request && a.request.botId === botId),
      lastRunOf: (botId) => lastRuns[botId] || null,
      approve,
      refresh,
    }),
    [loading, bots, running, paused, approvals, lastRuns, approve, refresh],
  );
}
