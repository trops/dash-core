import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppContext } from "../../Context/App/AppContext";
import { useKnownProviders } from "../../hooks/useKnownProviders";
import { validatePlan } from "../../utils/teamPlan";
import {
  buildChecklist,
  choosePlanProvider,
  isDone,
  providerLabel,
  planHave,
} from "../Create/planChecklist";
import {
  cellBuildPlan,
  isSettingsChange,
  latestPlanStep,
  planForCell,
  planForWidget,
  widgetBuildPlan,
} from "./workspacePlan";
import { forEdit } from "../Create/editCreate";
import { useBotEmitters } from "../Settings/details/useBotEmitters";
import {
  applyChoices,
  pinFromPicked,
  pickFromQuestion,
  readsFromStep,
  widgetLabel,
  wizardIndex,
} from "./WidgetWizard/widgetSpec";
import { reuseIndex } from "./WidgetWizard/reuseSpec";

const NO_CHOICES = {};

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
  // Provider names the user picked here — only those count as chosen.
  picked: [],
  // The step the user was asked to pick at: its plan was only a draft.
  pickStepId: null,
  // The widget wizard: the step it's on ("does", "talks", "review") and
  // what the user chose there (applyChoices) — whatever a new plan says.
  wizardStage: null,
  choices: {},
  // Which widget they're for (its name, lower case): another widget in the
  // same conversation starts its own steps.
  choicesFor: null,
};

const lower = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();
// The widget the steps are for: a new one (the wizard), else one the user
// already has going into a cell (its own steps).
const stepsIndex = (plan) => {
  if (!plan) return -1;
  const reuse = reuseIndex(plan);
  return reuse >= 0 ? reuse : wizardIndex(plan);
};
const wizardPiece = (plan) => {
  const at = stepsIndex(plan);
  return at >= 0 ? plan.pieces[at] : null;
};
// Whose choices: the widget, and whether it's one the user has (its own
// steps) or a new one — switching between them starts over.
const stepsKey = (plan, piece) =>
  piece ? `${lower(piece.name)}${reuseIndex(plan) >= 0 ? ":yours" : ""}` : "";

/** The wizard's step and choices: this window's, else what was saved. */
const wizardOf = (cur, was) =>
  cur.choicesFor
    ? {
        wizardStage: cur.wizardStage || null,
        choices: cur.choices || {},
        choicesFor: cur.choicesFor,
      }
    : {
        wizardStage: (was && was.wizardStage) || null,
        choices: (was && was.choices) || {},
        choicesFor: (was && was.choicesFor) || null,
      };

/**
 * A new plan from the Planner: the user's choices stay with their widget —
 * but a part the Planner changed (the user asked in the chat) is the new
 * plan's; another widget starts over.
 */
export function carryChoices(carried, prevPlan, nextPlan) {
  const piece = wizardPiece(nextPlan);
  if (
    !piece ||
    !carried.choicesFor ||
    stepsKey(nextPlan, piece) !== carried.choicesFor
  ) {
    return { wizardStage: null, choices: {}, choicesFor: null };
  }
  const was = wizardPiece(prevPlan) || {};
  const changed = (k) =>
    piece[k] !== undefined &&
    JSON.stringify(piece[k]) !== JSON.stringify(was[k]);
  const c = { ...(carried.choices || {}) };
  if (changed("changes")) delete c.changes;
  if (changed("refresh")) delete c.refresh;
  if (changed("listens")) delete c.listens;
  // Another widget of theirs (the Planner changed it): its pick and
  // connection are the plan's now.
  if (changed("package") || changed("component")) {
    delete c.component;
    delete c.settings;
  }
  if (changed("package") || changed("provider")) delete c.provider;
  if (c.settings && changed("settings")) {
    // Only the settings the Planner changed are its own now.
    const mine = {};
    for (const k of Object.keys(c.settings)) {
      const said = piece.settings && piece.settings[k];
      const before = was.settings && was.settings[k];
      if (JSON.stringify(said) === JSON.stringify(before))
        mine[k] = c.settings[k];
    }
    c.settings = mine;
  }
  if (Array.isArray(c.eventsOff)) {
    const now = Array.isArray(piece.events) ? piece.events : [];
    c.eventsOff = c.eventsOff.filter((e) => now.includes(e));
  }
  return { ...carried, choices: c };
}

/** What a conversation saves of its plan (and its builds). */
const saved = (st) => ({
  stepId: st.stepId,
  plan: st.plan,
  checks: st.checks,
  edits: st.edits,
  sent: st.sent,
  builds: st.builds,
  picked: st.picked || [],
  pickStepId: st.pickStepId || null,
  wizardStage: st.wizardStage || null,
  choices: st.choices || {},
  choicesFor: st.choicesFor || null,
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
 * the Create window instead, `sent`, now retired). Saved with the
 * conversation (`workspacePlan`), so it reopens as it was left.
 *
 * @param {object[]} messages  the conversation, with its hand-off steps
 * @param {string|null} recentId  the conversation's id (null until saved)
 * @param {boolean} reopened   a saved conversation: its plan is read first
 * @param {string} convKey     which conversation is open; a new one starts
 *   with no plan
 * @param {object|null} cell   an empty cell the conversation is about
 *   (release 6c): the plan is for it (planForCell)
 * @param {object|null} widget  a widget the conversation changes (release
 *   6c, its saved about.widget): the plan is that change (planForWidget)
 */
export function useWorkspacePlan({
  messages,
  recentId,
  reopened = false,
  convKey = "",
  cell = null,
  widget = null,
}) {
  const app = useContext(AppContext) || {};
  // providers.json + what the app loaded: never empty by mistake.
  const known = useKnownProviders();
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
      // What the user picked stays with the conversation, across plans.
      const picked = [
        ...new Set([
          ...((was && Array.isArray(was.picked) && was.picked) || []),
          ...(cur.picked || []),
        ]),
      ];
      if (was && was.stepId === step.id && was.plan) {
        return {
          stepId: step.id,
          plan: was.plan,
          checks: was.checks || {},
          edits: Array.isArray(was.edits) ? was.edits : [],
          sent: !!was.sent,
          builds,
          picked,
          pickStepId: cur.pickStepId || (was && was.pickStepId) || null,
          ...wizardOf(cur, was),
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
        picked,
        pickStepId: cur.pickStepId || (was && was.pickStepId) || null,
        ...carryChoices(
          wizardOf(cur, was),
          cur.plan || (was && was.plan) || null,
          step.plan,
        ),
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

  // The user's provider picks hold, whatever a new plan says.
  const pinned = useMemo(
    () =>
      pinFromPicked(
        cell
          ? planForCell(state.plan, cell)
          : planForWidget(state.plan, widget),
        state.picked || [],
        known,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.plan, cell, widget, state.picked, known],
  );
  // The widget wizard (one new widget): step 1, Reads from — what the app
  // found in providers.json, and whether the user has picked.
  const wizardAt = pinned ? wizardIndex(pinned) : -1;
  // A widget the user already has, into a cell: its own steps (Which one,
  // Settings, Review), its choices kept the same way.
  // (The same widget as the wizard's: its provider pick still comes first.)
  const reuseAt = pinned ? reuseIndex(pinned) : -1;
  const stepsAt = reuseAt >= 0 ? reuseAt : wizardAt;
  // So do what they chose in its steps — for this widget only.
  const wizardName =
    stepsAt >= 0 ? stepsKey(pinned, pinned.pieces[stepsAt]) : "";
  const choicesHere = !!wizardName && state.choicesFor === wizardName;
  const choices = choicesHere ? state.choices || {} : NO_CHOICES;
  const plan = useMemo(
    () => applyChoices(pinned, stepsAt, choices, known),
    [pinned, stepsAt, choices, known],
  );
  // The dashboard's bots: what a new widget can listen for, and bots the
  // plan's check knows are there.
  const dashboardId = cell
    ? cell.workspaceId
    : (state.plan && state.plan.dashboard && state.plan.dashboard.id) || null;
  const botEmitters = useBotEmitters(dashboardId, dashboardId != null);
  const botNames = (botEmitters || []).map((b) => b.name).filter(Boolean);
  const forWidget = (cur) =>
    cur.choicesFor === wizardName
      ? { choicesFor: wizardName, choices: cur.choices || {} }
      : { choicesFor: wizardName, choices: {}, wizardStage: null };
  const wizard =
    wizardAt >= 0
      ? {
          index: wizardAt,
          piece: plan.pieces[wizardAt],
          reads: readsFromStep(
            plan.pieces[wizardAt],
            known,
            state.picked || [],
          ),
        }
      : null;
  const question =
    plan && Array.isArray(plan.questions)
      ? plan.questions.find((q) => q && q.pick === "providers") || null
      : null;
  // A widget the user already has isn't asked where it reads from first:
  // the widget they pick decides what kind (its own steps ask, if at all).
  const pick = question
    ? pickFromQuestion(question, known, wizard ? wizard.piece : null)
    : wizard && reuseAt < 0
      ? {
          name: widgetLabel(wizard.piece),
          piece: wizard.piece,
          reads: wizard.reads,
          question: null,
          done: wizard.reads.done,
        }
      : null;
  // A Claude connector stands in for what only the plan's bots need.
  const have = planHave(plan, known);
  const checklist = useMemo(
    () => (plan ? buildChecklist(plan, have, known, state.picked || []) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, known, state.picked],
  );
  // A cell's plan is checked as its build will be: one widget (release 6c).
  const check = plan
    ? plan.cell
      ? validatePlan(cellBuildPlan(plan), { cell: true, bots: botNames })
      : plan.widgetChange
        ? isSettingsChange(plan)
          ? plan.widgetChange.onDashboard
            ? validatePlan(widgetBuildPlan(plan), { settings: true })
            : {
                valid: false,
                errors: [
                  'Settings change on a copy of the widget on a dashboard — from here, plan a change to what it does (source "update" or "new").',
                ],
                warnings: [],
              }
          : validatePlan(
              forEdit(
                widgetBuildPlan(plan),
                plan.widgetChange,
                plan.widgetChange.mode,
              ),
              {
                edit: {
                  package: plan.widgetChange.package,
                  mode: plan.widgetChange.mode,
                },
              },
            )
        : validatePlan(plan, { bots: botNames })
    : null;
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
    // Provider names the user picked in this conversation.
    picked: state.picked || [],
    wizard,
    // A widget the user already has, into a cell: the piece with their
    // choices, and as the Planner proposed it.
    reuse:
      reuseAt >= 0
        ? {
            index: reuseAt,
            piece: plan.pieces[reuseAt],
            planned: pinned.pieces[reuseAt],
          }
        : null,
    // Waiting for the user to pick what the widget reads from: nothing is
    // planned or built until they do.
    // What the user is asked to pick, if anything: the Planner's own
    // provider question first (its plan isn't one yet), else the app's
    // (the wizard's widget, from providers.json).
    pick,
    waitingForPick: !!(pick && !pick.done),
    pickStepId: state.pickStepId || null,
    notePicked: (names, stepId = null) =>
      setState((cur) => ({
        ...cur,
        pickStepId: cur.pickStepId || stepId || null,
        picked: [
          ...new Set([...(cur.picked || []), ...(names || []).filter(Boolean)]),
        ],
      })),
    providers: known,
    refreshProviders: app.refreshProviders || null,
    // The wizard's widget as the Planner made it (before the user's
    // choices): what it proposed to send.
    plannedPiece: wizard && pinned ? pinned.pieces[wizard.index] : null,
    // The dashboard's bots (null until loaded).
    botEmitters,
    // Where the wizard's widget's dashboard is (its bots, Talks to).
    hasDashboard: dashboardId != null,
    wizardStage: choicesHere ? state.wizardStage || null : null,
    setWizardStage: (stage) =>
      setState((cur) => ({
        ...cur,
        ...forWidget(cur),
        wizardStage: stage,
      })),
    choices,
    // A part chosen in the wizard; `note` tells the Planner with the next
    // message.
    choose: (part, value, note = null) =>
      setState((cur) => {
        const mine = forWidget(cur);
        return {
          ...cur,
          ...mine,
          choices: { ...mine.choices, [part]: value },
          edits: note ? [...cur.edits, note] : cur.edits,
        };
      }),
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
