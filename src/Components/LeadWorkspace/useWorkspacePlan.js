import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppContext } from "../../Context/App/AppContext";
import { validatePlan } from "../../utils/teamPlan";
import {
  buildChecklist,
  choosePlanProvider,
  isDone,
  providerLabel,
  providerTypesOf,
} from "../Create/planChecklist";
import { latestPlanStep } from "./workspacePlan";

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

const NONE = {
  stepId: null,
  plan: null,
  checks: {},
  edits: [],
  sent: false,
  builds: [],
};

/** What a conversation saves of its plan (and its builds). */
const saved = (st) => ({
  stepId: st.stepId,
  plan: st.plan,
  checks: st.checks,
  edits: st.edits,
  sent: st.sent,
  builds: st.builds,
  // When this plan came in (the notifications panel's time for it, release
  // 4) — not when the conversation last changed.
  madeAt: st.madeAt || null,
});

/**
 * The plan a workspace conversation is about (lead-workspace release 3a):
 * the latest plan the Planner sent, with the user's changes to it (pieces
 * removed or swapped, a provider picked), Before it builds as they work
 * through it, and its builds (release 3b: { buildId, stepId, at, kind,
 * leftOff } — built in the conversation, after message `at`; 3a sent it to
 * Create instead, `sent`). Saved with the
 * conversation (`workspacePlan`), so it reopens as it was left.
 *
 * @param {object[]} messages  the conversation, with its hand-off steps
 * @param {string|null} recentId  the conversation's id (null until saved)
 * @param {boolean} reopened   a saved conversation: its plan is read first
 * @param {string} convKey     which conversation is open; a new one starts
 *   with no plan
 */
export function useWorkspacePlan({
  messages,
  recentId,
  reopened = false,
  convKey = "",
}) {
  const app = useContext(AppContext) || {};
  const step = latestPlanStep(messages);
  const stepId = step ? step.id : null;
  const [state, setState] = useState(NONE);
  // A saved conversation's plan is read before anything is saved over it.
  const [loaded, setLoaded] = useState(!reopened);
  const savedRef = useRef(null);
  // Another conversation: start over (set while rendering, so nothing of
  // the last one's plan shows or is saved onto this one).
  const [forKey, setForKey] = useState(convKey);
  if (forKey !== convKey) {
    setForKey(convKey);
    setState(NONE);
    setLoaded(!reopened);
    savedRef.current = null;
  }
  // Which conversation is open now — a build that started in another one
  // (the user switched while it was starting) isn't added here.
  const keyRef = useRef(convKey);
  keyRef.current = convKey;

  useEffect(() => {
    if (!reopened || !recentId) return undefined;
    const b = botsApi();
    let alive = true;
    Promise.resolve(b && b.getCreateRecent ? b.getCreateRecent(recentId) : null)
      .then((entry) => {
        if (!alive) return;
        savedRef.current =
          (entry && entry.conversation && entry.conversation.workspacePlan) ||
          null;
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [recentId, reopened, convKey]);

  // A new plan from the Planner replaces the one shown; what was done
  // before building carries over (same ids, same items) — from what was
  // saved, too, when the plan came in after the window closed.
  useEffect(() => {
    if (!loaded || !step) return;
    setState((cur) => {
      if (cur.stepId === step.id) return cur;
      const was = savedRef.current;
      // Builds stay with the conversation: each shows where it happened.
      const builds = cur.builds.length
        ? cur.builds
        : (was && Array.isArray(was.builds) && was.builds) || [];
      if (was && was.stepId === step.id && was.plan) {
        return {
          stepId: step.id,
          plan: was.plan,
          checks: was.checks || {},
          edits: Array.isArray(was.edits) ? was.edits : [],
          sent: !!was.sent,
          builds,
          madeAt: was.madeAt || null,
        };
      }
      return {
        stepId: step.id,
        plan: step.plan,
        checks: (cur.stepId ? cur.checks : was && was.checks) || {},
        edits: [],
        sent: false,
        builds,
        madeAt: Date.now(),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, stepId]);

  // Saved as it changes — and right away when the window closes first.
  const pending = useRef(null);
  const save = (payload) => {
    const b = botsApi();
    if (!b || !b.saveCreateRecent) return;
    Promise.resolve(b.saveCreateRecent(payload)).catch(() => {});
  };
  useEffect(() => {
    // Switched away before the last conversation's change was saved.
    if (pending.current && pending.current.id !== recentId) {
      save(pending.current);
      pending.current = null;
    }
    if (!loaded || !recentId || !state.stepId) return undefined;
    const payload = {
      id: recentId,
      conversation: { workspacePlan: saved(state) },
    };
    pending.current = payload;
    const t = setTimeout(() => {
      pending.current = null;
      save(payload);
    }, 300);
    return () => clearTimeout(t);
  }, [loaded, recentId, state]);
  // A build just added: saved at once (the window may close next).
  const saveNow = useRef(false);
  useEffect(() => {
    if (!saveNow.current) return;
    saveNow.current = false;
    if (!recentId || !state.stepId) return;
    pending.current = null;
    save({ id: recentId, conversation: { workspacePlan: saved(state) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(
    () => () => {
      if (pending.current) save(pending.current);
      pending.current = null;
    },
    [],
  );

  const plan = state.plan;
  const have = providerTypesOf(app.providers);
  const checklist = useMemo(
    () => (plan ? buildChecklist(plan, have) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, app.providers],
  );
  const check = plan ? validatePlan(plan, {}) : null;
  const open = checklist.filter((it) => !isDone(it, state.checks, have)).length;

  const edit = (next, note) =>
    setState((cur) => ({
      ...cur,
      plan: next,
      edits: note ? [...cur.edits, note] : cur.edits,
    }));

  return {
    step,
    plan,
    checks: state.checks,
    edits: state.edits,
    sent: state.sent,
    checklist,
    check,
    open,
    have,
    providers: app.providers,
    refreshProviders: app.refreshProviders || null,
    edit,
    setCheck: (item, status) =>
      setState((cur) => ({
        ...cur,
        checks: { ...cur.checks, [item.id]: status },
      })),
    // One of the user's providers for what the plan needs (as Create does).
    pickProvider: (item, provider) => {
      if (!item || !provider || !plan) return;
      edit(
        choosePlanProvider(plan, item.providerType, provider),
        `use my provider "${provider.name}" (type ${provider.type || "unknown"}) wherever the plan needs ${providerLabel(item.providerType)}`,
      );
    },
    // The changes not yet told to the Planner: they go with the next message.
    takeEdits: () => {
      const e = state.edits;
      if (e.length) setState((cur) => ({ ...cur, edits: [] }));
      return e;
    },
    builds: state.builds,
    // Which conversation this is: a build is added only to the one it
    // started in (`addBuild`'s `key`).
    key: convKey,
    // This plan's latest build (release 3b), or null — built again after a
    // Remove, the newest; and the last build of any plan (a changed plan's
    // build reuses what it made).
    build:
      [...state.builds].reverse().find((b) => b.stepId === state.stepId) ||
      null,
    lastBuild: state.builds[state.builds.length - 1] || null,
    // A build started: saved at once, so a reopened conversation finds it
    // even if the window closes. `checks`: what was done before it built;
    // `replaces`: the build it carries on (Carry on building), in its place;
    // `key` / `stepId`: the conversation and plan it started from — if
    // either changed meanwhile, it isn't added (false).
    addBuild: ({
      checks,
      replaces = null,
      key = null,
      stepId: from = null,
      ...build
    }) => {
      if (key !== null && key !== keyRef.current) return false;
      setState((cur) => {
        if (from !== null && cur.stepId !== from) return cur;
        const entry = { stepId: cur.stepId, leftOff: [], ...build };
        saveNow.current = true;
        return {
          ...cur,
          checks: checks || cur.checks,
          builds: replaces
            ? cur.builds.map((b) => (b.buildId === replaces ? entry : b))
            : [...cur.builds, entry],
        };
      });
      return true;
    },
    // A build as it ended, kept with it: an earlier build still shows after
    // a restart (the main process keeps only a conversation's latest).
    keepLast: (buildId, last) =>
      setState((cur) => {
        const b = cur.builds.find((x) => x.buildId === buildId);
        if (
          !b ||
          (b.last &&
            b.last.status === last.status &&
            b.last.finishedAt === last.finishedAt)
        )
          return cur;
        return {
          ...cur,
          builds: cur.builds.map((x) =>
            x.buildId === buildId ? { ...x, last } : x,
          ),
        };
      }),
    // Leave it off: a failed piece is accepted as not built.
    leaveOff: (buildId, key) =>
      setState((cur) => ({
        ...cur,
        builds: cur.builds.map((b) =>
          b.buildId === buildId && !b.leftOff.includes(key)
            ? { ...b, leftOff: [...b.leftOff, key] }
            : b,
        ),
      })),
  };
}

export default useWorkspacePlan;
