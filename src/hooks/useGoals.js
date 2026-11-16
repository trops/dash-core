import { useCallback, useEffect, useRef, useState } from "react";
import { GOALS_CHANGED } from "../Components/Goals/goalText";

/**
 * useGoals — the goals ledger (goals-ledger PRD), read from the main
 * process (window.mainApi.goals) and kept fresh on "goals:changed".
 *
 * - useGoals(workspaceId) → { goals, loading, refresh } for one dashboard.
 * - useGoal(goalId)       → { goal, loading, refresh }: one goal with its runs.
 */

const goalsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.goals) ||
  null;

/** Subscribe to goals:changed; returns an unsubscribe. */
function subscribe(fn) {
  const m = typeof window !== "undefined" ? window.mainApi : null;
  if (!m || typeof m.on !== "function") return () => {};
  let id = null;
  try {
    id = m.on(GOALS_CHANGED, (_e, payload) => fn(payload || {}));
  } catch (_e) {
    return () => {};
  }
  return () => {
    try {
      if (typeof m.removeListener === "function")
        m.removeListener(GOALS_CHANGED, id);
    } catch (_e) {
      // already gone
    }
  };
}

const same = (a, b) => a != null && b != null && String(a) === String(b);

export function useGoals(workspaceId) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const api = goalsApi();
    if (!api || typeof api.list !== "function" || workspaceId == null) {
      setGoals([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    try {
      const list = await api.list(workspaceId);
      if (mine !== seq.current) return;
      setGoals(Array.isArray(list) ? list : []);
    } catch (_e) {
      // keep the last list on a transient IPC error
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setLoading(true);
    refresh();
    // Another dashboard's change doesn't need a reload.
    return subscribe((p) => {
      if (p.workspaceId != null && !same(p.workspaceId, workspaceId)) return;
      refresh();
    });
  }, [refresh, workspaceId]);

  return { goals, loading, refresh };
}

export function useGoal(goalId) {
  const [goal, setGoal] = useState(null);
  const [loading, setLoading] = useState(!!goalId);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const api = goalsApi();
    if (!api || typeof api.get !== "function" || !goalId) {
      setGoal(null);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    try {
      const g = await api.get(goalId);
      if (mine !== seq.current) return;
      setGoal(g || null);
    } catch (_e) {
      // keep what we had
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    setLoading(!!goalId);
    refresh();
    return subscribe((p) => {
      if (p.goalId && p.goalId !== goalId) return;
      refresh();
    });
  }, [refresh, goalId]);

  return { goal, loading, refresh };
}

export default useGoals;
