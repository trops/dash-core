import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * useBotMonitor — every bot, live, for the Bot monitor side panel
 * (bot-teams PRD TEAM-011 AC9): pending approvals across all dashboards,
 * what's running now (with start times), and the latest finished runs.
 * Kept current from the main process (onApprovalPending, onRunActive,
 * onStream).
 */
const EMPTY = [];
const RECENT_LIMIT = 10;

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

export function useBotMonitor() {
  const [bots, setBots] = useState(EMPTY);
  const [approvals, setApprovals] = useState(EMPTY);
  const [running, setRunning] = useState(EMPTY);
  const [recent, setRecent] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  const loadRunning = useCallback(async () => {
    const b = api();
    if (!b || !b.listRunning) return;
    try {
      const list = await b.listRunning();
      setRunning(Array.isArray(list) ? list : EMPTY);
    } catch (_e) {
      // keep the last good list
    }
  }, []);

  const loadRecent = useCallback(async () => {
    const b = api();
    if (!b || !b.listRecentRuns) return;
    try {
      const list = await b.listRecentRuns(RECENT_LIMIT);
      setRecent(Array.isArray(list) ? list : EMPTY);
    } catch (_e) {
      // keep the last good list
    }
  }, []);

  const refresh = useCallback(async () => {
    const b = api();
    if (!b) {
      setLoading(false);
      return;
    }
    try {
      const [list, pending] = await Promise.all([
        b.list ? b.list() : EMPTY,
        b.listApprovals ? b.listApprovals() : EMPTY,
        loadRunning(),
        loadRecent(),
      ]);
      setBots(Array.isArray(list) ? list : EMPTY);
      setApprovals(Array.isArray(pending) ? pending : EMPTY);
    } catch (_e) {
      // keep the last good view on a transient IPC error
    } finally {
      setLoading(false);
    }
  }, [loadRunning, loadRecent]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const b = api();
    if (!b) return undefined;
    const ids = [];
    if (b.onApprovalPending) {
      ids.push(
        b.onApprovalPending((approval) =>
          setApprovals((prev) =>
            prev.some((a) => a.id === approval.id) ? prev : [...prev, approval],
          ),
        ),
      );
    }
    if (b.onRunActive) {
      // The payload only has ids; re-read for names and start times.
      ids.push(b.onRunActive(() => loadRunning()));
    }
    if (b.onStream) {
      ids.push(
        b.onStream(({ event }) => {
          const t = event && event.type;
          if (t === "done" || t === "error" || t === "skipped") loadRecent();
        }),
      );
    }
    return () => {
      for (const id of ids) if (b.removeListener) b.removeListener(id);
    };
  }, [loadRunning, loadRecent]);

  const approve = useCallback(async (approvalId, decision) => {
    const b = api();
    if (b && b.approve) await b.approve(approvalId, decision);
    setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
  }, []);

  const stop = useCallback(
    async (botId) => {
      const b = api();
      if (b && b.stop) await b.stop(botId);
      loadRunning();
    },
    [loadRunning],
  );

  return useMemo(() => {
    const byId = new Map(bots.map((b) => [b.id, b]));
    return {
      loading,
      approvals,
      running,
      recent,
      botById: (id) => byId.get(id) || null,
      approve,
      stop,
      refresh,
    };
  }, [bots, approvals, running, recent, loading, approve, stop, refresh]);
}
