import { useEffect, useState } from "react";

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/**
 * A plan build, live (create-entry CRE-004; shared by Create's build screen
 * and the lead workspace, release 3b): its state as the main process sends
 * it, and what can be done to it. Fix / retry / resume / approve / revise
 * start in the main process; progress comes back on onPlanBuild.
 *
 * @param {string|null} buildId  null: no build yet
 * @param {object|null} initialState
 */
export function usePlanBuild(buildId, initialState = null) {
  const [state, setState] = useState(initialState);
  const [stopping, setStopping] = useState(false);
  // A fix / retry / resume / remove that couldn't start.
  const [actionError, setActionError] = useState(null);
  // Another build: start over (set while rendering, so nothing of the last
  // one shows).
  const [forId, setForId] = useState(buildId);
  if (forId !== buildId) {
    setForId(buildId);
    setState(initialState);
    setStopping(false);
    setActionError(null);
  }

  useEffect(() => {
    const bots = botsApi();
    if (!bots || !buildId) return undefined;
    let alive = true;
    const id = bots.onPlanBuild
      ? bots.onPlanBuild((payload) => {
          if (alive && payload && payload.buildId === buildId)
            setState(payload.state);
        })
      : null;
    // Catch up on anything sent before we subscribed.
    if (bots.getPlanBuild) {
      Promise.resolve(bots.getPlanBuild(buildId))
        .then((res) => alive && res && res.state && setState(res.state))
        .catch(() => {});
    }
    return () => {
      alive = false;
      if (id != null && bots.removeListener) bots.removeListener(id);
    };
  }, [buildId]);

  const stop = async () => {
    setStopping(true);
    try {
      await botsApi().stopPlanBuild(buildId);
    } catch (_e) {
      setStopping(false);
    }
  };

  const act = async (call) => {
    setActionError(null);
    setStopping(false);
    try {
      const res = await call();
      if (res && res.error) setActionError(res.error);
      return res;
    } catch (err) {
      setActionError((err && err.message) || "That didn't start.");
      return null;
    }
  };

  return {
    state,
    stopping,
    actionError,
    setActionError,
    stop,
    act,
    fix: (step) => act(() => botsApi().fixPlanBuild(buildId, step.id)),
    retry: (step) => act(() => botsApi().retryPlanBuild(buildId, step.id)),
    resume: () => act(() => botsApi().resumePlanBuild(buildId)),
    approve: (stepId, inputs = {}) =>
      act(() => botsApi().approvePlanStep(buildId, stepId, inputs)),
    revise: (stepId, note) =>
      act(() => botsApi().revisePlanStep(buildId, stepId, note)),
  };
}

export default usePlanBuild;
