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

const NONE = { stepId: null, plan: null, checks: {}, edits: [], sent: false };

/**
 * The plan a workspace conversation is about (lead-workspace release 3a):
 * the latest plan the Planner sent, with the user's changes to it (pieces
 * removed or swapped, a provider picked), Before it builds as they work
 * through it, and whether it was sent to Create to build. Saved with the
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
      const saved = savedRef.current;
      if (saved && saved.stepId === step.id && saved.plan) {
        return {
          stepId: step.id,
          plan: saved.plan,
          checks: saved.checks || {},
          edits: Array.isArray(saved.edits) ? saved.edits : [],
          sent: !!saved.sent,
        };
      }
      return {
        stepId: step.id,
        plan: step.plan,
        checks: (cur.stepId ? cur.checks : saved && saved.checks) || {},
        edits: [],
        sent: false,
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
      conversation: {
        workspacePlan: {
          stepId: state.stepId,
          plan: state.plan,
          checks: state.checks,
          edits: state.edits,
          sent: state.sent,
        },
      },
    };
    pending.current = payload;
    const t = setTimeout(() => {
      pending.current = null;
      save(payload);
    }, 300);
    return () => clearTimeout(t);
  }, [loaded, recentId, state]);
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
    // Sent to Create to build: saved now (the window closes next), so a
    // reopened conversation doesn't offer to build it again.
    markSent: () => {
      setState((cur) => ({ ...cur, sent: true }));
      if (recentId && state.stepId) {
        pending.current = null;
        save({
          id: recentId,
          conversation: {
            workspacePlan: {
              stepId: state.stepId,
              plan: state.plan,
              checks: state.checks,
              edits: state.edits,
              sent: true,
            },
          },
        });
      }
    },
  };
}

export default useWorkspacePlan;
