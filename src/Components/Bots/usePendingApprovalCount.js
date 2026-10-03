import { useCallback, useEffect, useState } from "react";

/**
 * usePendingApprovalCount — how many bot approvals are waiting, across every
 * dashboard: the sidebar's Bots attention dot (app-navigation NAV-001 AC3).
 *
 * Re-reads the list instead of tracking it, so an approval handled anywhere
 * (Bots view, Bot Activity panel) drops off: on a new approval, when a run
 * starts/stops, when bots change, and when a run's stream ends.
 */
function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

export function usePendingApprovalCount() {
  const [count, setCount] = useState(0);

  const reload = useCallback(async () => {
    const b = api();
    if (!b || !b.listApprovals) return;
    try {
      const list = await b.listApprovals();
      setCount(Array.isArray(list) ? list.length : 0);
    } catch (_e) {
      // keep the last count on a transient IPC error
    }
  }, []);

  useEffect(() => {
    reload();
    const b = api();
    if (!b) return undefined;
    const ids = [];
    if (b.onApprovalPending) ids.push(b.onApprovalPending(() => reload()));
    if (b.onRunActive) ids.push(b.onRunActive(() => reload()));
    if (b.onListChanged) ids.push(b.onListChanged(() => reload()));
    if (b.onStream) {
      ids.push(
        b.onStream(({ event } = {}) => {
          const t = event && event.type;
          if (t === "done" || t === "error" || t === "skipped") reload();
        }),
      );
    }
    return () => {
      for (const id of ids) if (b.removeListener) b.removeListener(id);
    };
  }, [reload]);

  return count;
}
