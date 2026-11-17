import { useCallback, useEffect, useRef, useState } from "react";
import { FLOWS_CHANGED } from "../Components/Flows/flowText";
import { GOALS_CHANGED } from "../Components/Goals/goalText";

/**
 * useFlows — a dashboard's flows (flows PRD), read from the main process
 * (window.mainApi.flows) and kept fresh on "flows:changed" — and on
 * "goals:changed", since each flow shows where its goals are now.
 *
 * - useFlows(workspaceId) → { flows, loading, refresh }
 * - flowsApi()            → window.mainApi.flows, or null
 */

export const flowsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.flows) ||
  null;

function subscribe(channel, fn) {
  const m = typeof window !== "undefined" ? window.mainApi : null;
  if (!m || typeof m.on !== "function") return () => {};
  let id = null;
  try {
    id = m.on(channel, (_e, payload) => fn(payload || {}));
  } catch (_e) {
    return () => {};
  }
  return () => {
    try {
      if (typeof m.removeListener === "function") m.removeListener(channel, id);
    } catch (_e) {
      // already gone
    }
  };
}

const same = (a, b) => a != null && b != null && String(a) === String(b);

export function useFlows(workspaceId) {
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const api = flowsApi();
    if (!api || typeof api.list !== "function" || workspaceId == null) {
      setFlows([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    try {
      const list = await api.list(workspaceId);
      if (mine !== seq.current) return;
      setFlows(Array.isArray(list) ? list : []);
    } catch (_e) {
      // keep the last list on a transient IPC error
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const mineOnly = (p) => {
      if (p.workspaceId != null && !same(p.workspaceId, workspaceId)) return;
      refresh();
    };
    const offFlows = subscribe(FLOWS_CHANGED, mineOnly);
    const offGoals = subscribe(GOALS_CHANGED, mineOnly);
    return () => {
      offFlows();
      offGoals();
    };
  }, [refresh, workspaceId]);

  return { flows, loading, refresh };
}

export default useFlows;
