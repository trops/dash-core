/**
 * checksView.js — how a bot's own checks (bot-checks PRD CHK-002) show on
 * the Bots tab: the list inside each bot's box, what they're doing now, and
 * the edits the checks window makes before it saves `bot.checks`.
 *
 * A bot's checks: `{ steps, onFail, maxTries, handsOn }` or null
 * (electron/bots/botChecks.js). A step is a check Dash runs (`check`, with
 * `check.kind` rules | command | script | tool), a reviewer bot
 * (`reviewer`, with `botId`) or you (`you`).
 *
 * Pure: no React, no IPC.
 */

import { isBotJob, jobTimeline } from "../Goals/jobTimeline";
import { parseBotEventType } from "./teamDiagram";
import { BOT_RESULTS } from "./widgetDiagram";

export const MAX_CHECKS = 10;
export const ON_FAIL = ["retry", "you", "stop"];
export const HANDS_ON = ["answer", "summary", "files"];
export const TRIES = [2, 3, 5];

/**
 * What a step is, for its colour and icon: "rule" (a rule, a compare or a
 * script — no AI), "command", "reviewer" or "you".
 */
export function stepTone(step) {
  if (!step) return "rule";
  if (step.kind === "you") return "you";
  if (step.kind === "reviewer") return "reviewer";
  if (step.check && step.check.kind === "command") return "command";
  return "rule";
}

// Colour classes (in the prebuilt palette) and icons per tone.
export const TONE = {
  rule: { bg: "bg-blue-600", icon: "list-check", label: "A rule or compare" },
  command: { bg: "bg-teal-600", icon: "terminal", label: "A command or test" },
  reviewer: { bg: "bg-amber-600", icon: "robot", label: "A reviewer bot" },
  you: { bg: "bg-purple-600", icon: "user", label: "You approve" },
};

/**
 * The kinds the window offers, in its order: what each is called and the
 * step it starts as. "compare" is a check of kind `tool` (ask a provider,
 * read-only).
 */
export const STEP_CHOICES = [
  { value: "compare", label: "Compare with a provider" },
  { value: "rules", label: "A rule" },
  { value: "command", label: "A command or test" },
  { value: "reviewer", label: "A reviewer bot" },
  { value: "you", label: "You approve" },
];

/** Which STEP_CHOICES value a step is ("script" for a script check). */
export function choiceOf(step) {
  if (!step) return "rules";
  if (step.kind === "you" || step.kind === "reviewer") return step.kind;
  const k = step.check && step.check.kind;
  if (k === "tool") return "compare";
  return k || "rules";
}

/** A new check of a kind, with what it starts with. */
export function newCheck(choice, { field = "input.answer" } = {}) {
  switch (choice) {
    case "you":
      return { kind: "you", name: "You approve" };
    case "reviewer":
      return { kind: "reviewer", name: "Reviewer", botId: "" };
    case "command":
      return {
        kind: "check",
        name: "A command passes",
        check: {
          kind: "command",
          command: "",
          timeoutSec: 120,
          passWhen: { type: "exit0" },
        },
      };
    case "compare":
      return {
        kind: "check",
        name: "Matches a provider",
        check: {
          kind: "tool",
          server: "",
          tool: "",
          args: {},
          answerRules: [],
        },
      };
    default:
      return {
        kind: "check",
        name: "Has an answer",
        check: {
          kind: "rules",
          rules: [{ type: "required", field, on: true }],
        },
      };
  }
}

/** A step turned into another kind; its name kept when it was the user's. */
export function changeKind(step, choice) {
  if (choiceOf(step) === choice) return step;
  const fresh = newCheck(choice);
  const named =
    step && step.name && step.name !== newCheck(choiceOf(step)).name;
  return {
    ...fresh,
    id: step && step.id,
    ...(named ? { name: step.name } : {}),
  };
}

/** A short line under a step: what it does (and when, DASH-85). */
export function stepSub(step, nameOf = () => null) {
  if (!step) return "";
  const base = stepWhat(step, nameOf);
  return typeof step.when === "string" && step.when.trim()
    ? `${base} · only when ${step.when.trim()}`
    : base;
}

function stepWhat(step, nameOf) {
  if (step.kind === "you") return "Waits in Jobs · Send back asks why";
  if (step.kind === "reviewer") {
    const who = step.botId ? nameOf(step.botId) || "a bot" : null;
    return who ? `Reviewer bot · ${who}` : "Reviewer bot · pick who reviews";
  }
  const c = step.check || {};
  if (c.kind === "command" && step.held) {
    return `Off · came with the package · ${c.command || ""}`;
  }
  if (c.kind === "command") {
    return c.command ? `Command · ${c.command}` : "Command · not set yet";
  }
  if (c.kind === "tool") {
    return c.server && c.tool
      ? `Compare with ${c.server} · no AI`
      : "Compare with a provider · pick one";
  }
  if (c.kind === "script") return "Script · no AI";
  const n = (c.rules || []).filter((r) => r && r.on !== false).length;
  return `${n} rule${n === 1 ? "" : "s"} · no AI`;
}

/**
 * The card's rows: the first `max` steps, and how many more there are.
 * @returns {{ rows: {key, name, tone}[], more: number, count: number }}
 */
export function cardRows(checks, max = 3) {
  const steps = (checks && checks.steps) || [];
  const shown = steps.length > max ? steps.slice(0, max - 1) : steps;
  return {
    rows: shown.map((s, i) => ({
      key: s.id || `s${i}`,
      name: `${s.name || TONE[stepTone(s)].label}${s.held ? " (off)" : ""}`,
      tone: stepTone(s),
    })),
    more: steps.length - shown.length,
    count: steps.length,
  };
}

/** The bot's checks to start the window from (a copy; defaults filled). */
export function draftOf(checks) {
  const c = checks && typeof checks === "object" ? checks : {};
  return {
    steps: JSON.parse(JSON.stringify(c.steps || [])),
    onFail: ON_FAIL.includes(c.onFail) ? c.onFail : "retry",
    maxTries: Number(c.maxTries) || 3,
    handsOn: HANDS_ON.includes(c.handsOn) ? c.handsOn : "answer",
  };
}

/** A new id for a step, unused in the list. */
function freshId(steps) {
  const ids = new Set(steps.map((s) => s.id));
  let n = steps.length + 1;
  while (ids.has(`step_c${n}`)) n++;
  return `step_c${n}`;
}

/** The draft with a new step at `at` (0 = first). */
export function addStep(draft, at, step) {
  const steps = [...draft.steps];
  if (steps.length >= MAX_CHECKS) return draft;
  const i = Math.max(0, Math.min(at, steps.length));
  steps.splice(i, 0, { ...step, id: step.id || freshId(steps) });
  return { ...draft, steps };
}

/** The draft with step `from` moved to `to`. */
export function moveStep(draft, from, to) {
  const steps = [...draft.steps];
  if (from < 0 || from >= steps.length) return draft;
  const [s] = steps.splice(from, 1);
  steps.splice(Math.max(0, Math.min(to, steps.length)), 0, s);
  return { ...draft, steps };
}

/**
 * Commands that came with a package and are off until turned on
 * (DASH-57): `{ index, name, command }`.
 */
export function heldSteps(draft) {
  return ((draft && draft.steps) || [])
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s && s.held)
    .map(({ s, index }) => ({
      index,
      name: s.name || "A command",
      command: String((s.check && s.check.command) || ""),
    }));
}

/** The draft with a package's command turned on (it runs from then on). */
export function turnOnStep(draft, i) {
  return {
    ...draft,
    steps: draft.steps.map((s, n) => {
      if (n !== i) return s;
      const { held: _h, ...rest } = s;
      return rest;
    }),
  };
}

export function removeStep(draft, i) {
  return { ...draft, steps: draft.steps.filter((_, n) => n !== i) };
}

export function updateStep(draft, i, patch) {
  return {
    ...draft,
    steps: draft.steps.map((s, n) => (n === i ? { ...s, ...patch } : s)),
  };
}

/**
 * What's wrong with the draft before it's saved (shown in the window), or
 * null. Mirrors what the main process refuses, in the window's words.
 */
export function draftError(draft, selfId) {
  for (const s of draft.steps) {
    if (s.kind === "reviewer" && !s.botId) {
      return `"${s.name || "Reviewer"}" needs the bot that reviews.`;
    }
    if (s.kind === "reviewer" && String(s.botId) === String(selfId)) {
      return "A bot can't review its own work.";
    }
    if (s.kind === "check" && s.check && s.check.kind === "command") {
      if (!String(s.check.command || "").trim()) {
        return `"${s.name || "Command"}" needs a command to run.`;
      }
    }
    if (s.kind === "check" && s.check && s.check.kind === "tool") {
      if (!s.check.server || !s.check.tool) {
        return `"${s.name || "Compare"}" needs a provider and a tool.`;
      }
    }
  }
  return null;
}

/** What's saved: the checks, or null when the list is empty. */
export function savedChecks(draft) {
  if (!draft.steps.length) return null;
  return {
    steps: draft.steps,
    onFail: draft.onFail,
    maxTries: draft.maxTries,
    handsOn: draft.handsOn,
  };
}

/**
 * What a bot's checks are doing now, from its open jobs (`goals`: the
 * dashboard's goals, useGoals) — the checks part of its box on the diagram:
 *
 * - `needs`: how many wait for you (approve, or it came to you);
 * - `header`: "Checking · try 1 of 3", "Sent back · try 2 of 3" or
 *   "Checking 2 jobs" while some are being worked on, else null; when the
 *   bot is paused (`paused`), work sent back to it waits: "Paused · try 2
 *   of 3 waits" (`waiting: true`, nothing spins);
 * - `stepId`: the check being run (one job being checked), else null;
 * - `goalId`: the job a click opens — one that needs you first, else the
 *   newest being worked on; null when nothing is happening.
 *
 * Nothing about jobs that finished: the box is the bot, not one run.
 */
export function liveChecks(goals, botId, { paused = false } = {}) {
  const jobs = (goals || [])
    .filter(
      (g) => isBotJob(g) && !g.closed && String(g.flow.botId) === String(botId),
    )
    .map((g) => {
      const rows = jobTimeline(g);
      return {
        goal: g,
        now: rows[rows.length - 1] || {},
        tries: rows.filter((r) => r.type === "try").length,
      };
    });
  const needing = jobs.filter(
    (j) => j.now.state === "waiting" || j.now.state === "needs-you",
  );
  const active = jobs
    .filter((j) => j.now.state === "checking" || j.now.state === "working")
    .sort((a, b) =>
      String(b.goal.createdAt || "").localeCompare(
        String(a.goal.createdAt || ""),
      ),
    );
  let header = null;
  let stepId = null;
  // Sent back to a paused bot: those jobs wait for it.
  const stuck = paused ? active.filter((j) => j.now.state === "working") : [];
  const waiting = stuck.length > 0 && stuck.length === active.length;
  if (waiting) {
    header =
      stuck.length > 1
        ? `Paused · ${stuck.length} jobs wait`
        : `Paused · try ${stuck[0].tries + 1} of ${stuck[0].now.maxRounds} waits`;
  } else if (active.length > 1) {
    header = `Checking ${active.length} jobs`;
  } else if (active.length === 1) {
    const { goal, now, tries } = active[0];
    if (now.state === "working") {
      header = `Sent back · try ${tries + 1} of ${now.maxRounds}`;
    } else {
      header = `Checking · try ${Math.max(1, tries)} of ${now.maxRounds}`;
      const task = (goal.tasks || [])[0];
      stepId = (task && task.stepId) || null;
    }
  }
  const open = needing[0] || active[0] || null;
  return {
    needs: needing.length,
    header,
    waiting,
    stepId,
    goalId: open ? open.goal.id : null,
    workspaceId: open ? open.goal.workspaceId : null,
  };
}

// ── Hands on: where its checked work goes ─────────────────────────────

/**
 * Where a bot's work goes once it passes: the team bots that run when it
 * completes, and the widgets that show it (its answers in Bot results, or
 * a listener on its completed event).
 *
 * @param {object} bot
 * @param {object[]} members  the team (lead not included)
 * @param {object[]} widgets  diagramWidgets()
 * @param {object[]} wEdges   widgetEdges()
 * @returns {{ type: "bot"|"widget", key, id, name, eventType?, widget?, edge? }[]}
 */
export function handsOnTargets(
  bot,
  members = [],
  widgets = [],
  wEdges = [],
  event = "completed",
) {
  if (!bot) return [];
  // Its completed work: lines on completed, and Bot results widgets. Its
  // failures (DASH-12): lines on failed.
  const onEvent = (e) =>
    event === "completed"
      ? e.kind === "results" || e.event === "completed"
      : e.event === event;
  const out = [];
  for (const m of members || []) {
    if (!m || m.id === bot.id) continue;
    for (const sub of m.subscriptions || []) {
      const p = parseBotEventType(sub && sub.eventType);
      if (p && p.botId === bot.id && p.event === event) {
        out.push({
          type: "bot",
          key: `bot:${m.id}`,
          id: m.id,
          name: m.name,
          eventType: sub.eventType,
        });
      }
    }
  }
  const byKey = new Map((widgets || []).map((w) => [w.key, w]));
  for (const e of wEdges || []) {
    if (e.from !== bot.id) continue;
    if (!onEvent(e)) continue;
    const w = byKey.get(e.widget);
    if (!w) continue;
    out.push({
      type: "widget",
      key: `widget:${e.key}`,
      id: w.key,
      name: w.label,
      widget: w,
      edge: e,
    });
  }
  return out;
}

/**
 * What can be added to its hands on from the window: team bots not
 * already running after it completes, and Bot results widgets showing no
 * bot yet. (Other widgets are connected by dragging on the diagram,
 * where their handler is picked.)
 */
export function handsOnChoices(bot, members = [], widgets = [], current = []) {
  if (!bot) return [];
  const taken = new Set((current || []).map((t) => t.key));
  const bots = (members || [])
    .filter((m) => m && m.id !== bot.id && m.role !== "lead")
    .filter((m) => !taken.has(`bot:${m.id}`))
    .map((m) => ({ type: "bot", key: `bot:${m.id}`, id: m.id, name: m.name }));
  const shown = new Set(
    (current || []).filter((t) => t.type === "widget").map((t) => t.id),
  );
  const results = (widgets || [])
    // Only one showing no bot yet: another bot's widget isn't taken away.
    .filter(
      (w) =>
        w.component === BOT_RESULTS && !w.resultsBotId && !shown.has(w.key),
    )
    .map((w) => ({
      type: "widget",
      key: `new:${w.key}`,
      id: w.key,
      name: w.label,
      widget: w,
      edge: null,
    }));
  return [...bots, ...results];
}

/** What changed between the targets it had and the window's list. */
export function targetChanges(before = [], after = []) {
  const keys = (list) => new Set(list.map((t) => t.key));
  const was = keys(before);
  const now = keys(after);
  return {
    adds: after.filter((t) => !was.has(t.key)),
    removes: before.filter((t) => !now.has(t.key)),
  };
}
