/**
 * useBotTest — test a bot from its form (bot-test-run PRD): run the form's
 * definition once, follow its events while it runs (what it's doing, its
 * answer as it's written), stop it, and keep what came back.
 *
 * phase: "idle" | "testing" | "done" | "stopped" | "failed"; `sample` is
 * the last completed test's, kept through a later one that doesn't finish;
 * `sampleKept` says the test already kept it (else it goes with
 * Create/Save).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { activityText } from "./testResultText";

// The streamed answer kept while it runs: its last part is what shows.
const STREAM_KEEP = 4000;

function api() {
  return (typeof window !== "undefined" && window.mainApi?.bots) || null;
}

/** A test's id: "test-" and letters/digits, never a saved bot's id. */
export function newTestId() {
  return `test-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function useBotTest() {
  const [state, setState] = useState({ phase: "idle" });
  const testIdRef = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const b = api();
    const id =
      b && b.onStream
        ? b.onStream((payload) => {
            if (!payload || payload.botId !== testIdRef.current) return;
            const event = payload.event || {};
            setState((s) => {
              if (s.phase !== "testing") return s;
              const text =
                event.type === "text" && event.text
                  ? `${s.text || ""}${event.text}`.slice(-STREAM_KEEP)
                  : s.text;
              return {
                ...s,
                text,
                activity: activityText(event) || s.activity,
              };
            });
          })
        : null;
    return () => {
      alive.current = false;
      if (id != null && b && b.removeListener) b.removeListener(id);
      // Leaving the form ends a test still running.
      if (testIdRef.current && b && b.stop) {
        Promise.resolve(b.stop(testIdRef.current)).catch(() => {});
      }
    };
  }, []);

  // `keep` false: a saved bot's form with unsaved changes — its sample
  // waits for Save.
  const start = useCallback(
    async (definition, prompt = "", { keep = true } = {}) => {
      const b = api();
      if (!b || !b.test || testIdRef.current) return;
      const testId = newTestId();
      testIdRef.current = testId;
      // The last good test's sample stays until another one completes.
      setState((s) => ({
        phase: "testing",
        testId,
        startedAt: Date.now(),
        text: "",
        activity: null,
        sample: s.sample || null,
        sampleKept: !!s.sampleKept,
      }));
      let result;
      try {
        result = await b.test(definition, { testId, prompt, keep });
      } catch (e) {
        result = { error: (e && e.message) || "The test couldn't run." };
      }
      testIdRef.current = null;
      if (!alive.current) return;
      const status = result && result.status;
      setState((s) => ({
        phase:
          status === "completed"
            ? "done"
            : status === "stopped"
              ? "stopped"
              : "failed",
        testId,
        result: result || {},
        error: (result && result.error) || null,
        sample:
          status === "completed" && result.sample
            ? result.sample
            : s.sample || null,
        // Already kept by the test (a saved bot's form with no changes).
        sampleKept:
          status === "completed" && result.sample
            ? !!result.sampleKept
            : !!s.sampleKept,
      }));
    },
    [],
  );

  const stop = useCallback(() => {
    const b = api();
    if (b && b.stop && testIdRef.current) {
      Promise.resolve(b.stop(testIdRef.current)).catch(() => {});
    }
  }, []);

  return { ...state, start, stop };
}
