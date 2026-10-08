import { useCallback, useEffect, useState } from "react";

/**
 * useApprovalsByDashboard — how many bot approvals are waiting on each
 * dashboard's team, for the Dashboards page's attention dots
 * (app-navigation NAV-005 AC1). Returns `countFor(workspaceId)`.
 *
 * Re-reads the bots and approvals (instead of tracking them) when an
 * approval arrives, a run starts/stops or the bot list changes, so an
 * approval handled anywhere drops off.
 */
function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

export function useApprovalsByDashboard() {
  const [counts, setCounts] = useState({});

  const reload = useCallback(async () => {
    const b = api();
    if (!b || !b.list || !b.listApprovals) return;
    try {
      const [bots, approvals] = await Promise.all([
        b.list(),
        b.listApprovals(),
      ]);
      const wsOf = new Map(
        (bots || []).map((bot) => [bot.id, bot.workspaceId]),
      );
      const next = {};
      for (const a of approvals || []) {
        const ws = wsOf.get(a && a.request && a.request.botId);
        if (ws === undefined || ws === null || ws === "") continue;
        const key = String(ws);
        next[key] = (next[key] || 0) + 1;
      }
      setCounts(next);
    } catch (_e) {
      // keep the last counts on a transient IPC error
    }
  }, []);

  useEffect(() => {
    reload();
    const b = api();
    if (!b) return undefined;
    const ids = [];
    if (b.onApprovalPending) ids.push(b.onApprovalPending(() => reload()));
    // Answered / denied / timed out anywhere → re-read.
    if (b.onApprovalsChanged) ids.push(b.onApprovalsChanged(() => reload()));
    if (b.onRunActive) ids.push(b.onRunActive(() => reload()));
    if (b.onListChanged) ids.push(b.onListChanged(() => reload()));
    return () => {
      for (const id of ids) if (b.removeListener) b.removeListener(id);
    };
  }, [reload]);

  return useCallback(
    (workspaceId) =>
      workspaceId === undefined || workspaceId === null
        ? 0
        : counts[String(workspaceId)] || 0,
    [counts],
  );
}
