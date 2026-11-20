/**
 * workspaceBuild.js — a plan built in its lead workspace conversation
 * (lead-workspace release 3b, frames 3, 4, 7, 8, 31, 33): what kind of build
 * a plan gets, and the build's state in words — the plan's line, the Build
 * log, the Check report, the Builder's and Checker's rows, and what the
 * lead says in the chat. The lead's words come from the build's state: no
 * AI call per update. Pure.
 */
import { formatTokens } from "../../utils/runCostLabel";
import { normalizeType, providerLabel } from "../Create/planChecklist";
import { planTarget } from "../../utils/teamPlan";
import {
  isSettingsChange,
  isThemeChangeOnly,
  isThemeOnly,
} from "./workspacePlan";

const pieces = (plan) =>
  ((plan && Array.isArray(plan.pieces) && plan.pieces) || []).filter(Boolean);

/**
 * The build a plan gets: one new widget and nothing else → "widget" (built
 * like Create's widget on its own: you look at it before it's installed);
 * one bot and nothing else → "bot"; anything else → "dashboard". A plan
 * for an empty cell (release 6c) → "cell": previewed, then the editor
 * places it.
 */
export function buildKind(plan) {
  if (plan && plan.cell) return "cell";
  // A new theme and nothing else (theme round): saved, no dashboard.
  if (isThemeOnly(plan)) return "theme";
  // A change to a saved theme and nothing else (theme change round).
  if (isThemeChangeOnly(plan)) return "themechange";
  // A change to one widget (release 6c): only its settings, or what it does.
  if (plan && plan.widgetChange)
    return isSettingsChange(plan) ? "settings" : "edit";
  const all = pieces(plan);
  const layout = all.some((p) => p.kind === "layout");
  const widgets = all.filter((p) => p.kind === "widget");
  const bots = all.filter((p) => p.kind === "bot");
  const target = !!planTarget(plan);
  if (!layout && !target && widgets.length === 1 && !bots.length)
    return "widget";
  if (!layout && !widgets.length && bots.length === 1) return "bot";
  return "dashboard";
}

/**
 * startPlanBuild's options for a kind of build — a change to one widget
 * (release 6c) says which, from the plan's `widgetChange`.
 */
export function buildOptions(kind, plan = null) {
  const w = (plan && plan.widgetChange) || null;
  if (kind === "settings" && w) {
    return {
      settings: {
        workspaceId: w.workspaceId,
        itemId: w.itemId,
        pageId: w.pageId ?? null,
        scope: w.scope || "main",
        component: w.component,
        displayName: w.displayName || "",
      },
    };
  }
  if (kind === "edit" && w) {
    return {
      edit: {
        component: w.component,
        mode: w.mode,
        displayName: w.displayName || "",
        settings: w.settingsNow || null,
        providers: w.providers || null,
        workspaceId: w.workspaceId ?? null,
        // Showing what a bot sends (TD-009): the listener it must have.
        ...(w.wire ? { wire: w.wire, itemId: w.itemId ?? null } : {}),
      },
    };
  }
  if (kind === "widget") return { cell: true, standalone: true };
  if (kind === "cell") return { cell: true };
  if (kind === "bot") return { bot: true };
  return {};
}

/**
 * Which piece a step is about, so leaving a failed piece off takes its other
 * steps with it: "piece:<i>", "bot:<i>", or the step's own id.
 */
export function pieceKey(step) {
  if (!step) return "";
  if (step.piece != null) return `piece:${step.piece}`;
  if (step.bot != null) return `bot:${step.bot}`;
  return String(step.id || "");
}

const stepsOf = (state) =>
  (state && Array.isArray(state.steps) && state.steps) || [];
const BAD = new Set(["failed", "skipped"]);

/** A failed or skipped step the user chose to leave off. */
export function isLeftOff(step, leftOff = []) {
  return BAD.has(step && step.status) && leftOff.includes(pieceKey(step));
}

/** The steps that failed and weren't left off — the first is the one asked about. */
export function failedSteps(state, leftOff = []) {
  return stepsOf(state).filter(
    (s) => s.status === "failed" && !isLeftOff(s, leftOff),
  );
}

/** The providers waiting steps need, once each. */
export function waitingFor(state) {
  const out = [];
  for (const s of stepsOf(state)) {
    if (s.status !== "needs-provider") continue;
    for (const p of s.waitingFor || []) if (!out.includes(p)) out.push(p);
  }
  return out;
}

const andList = (names) =>
  names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : names[0] || "";

/**
 * The build's status with what was left off taken into account: a build
 * whose only problems were left off is built.
 */
export function buildStatus(state, leftOff = []) {
  const status = (state && state.status) || "waiting";
  if (status !== "finished-with-problems" || !leftOff.length) return status;
  // Every failure left off: what was skipped because of them goes too.
  if (failedSteps(state, leftOff).length) return status;
  return waitingFor(state).length ? "waiting-for-providers" : "done";
}

/** A build that's still going (or stopping). */
export function isBuilding(state) {
  const s = state && state.status;
  return s === "waiting" || s === "running";
}

/** The names of the pieces left off: "Camera strip". */
function leftOffNames(state, leftOff) {
  const names = [];
  for (const s of stepsOf(state)) {
    if (!isLeftOff(s, leftOff)) continue;
    const name = String(s.label || "").replace(
      /^(Build|Check|Install|Place|Save the|Save|Make the|Change the)\s+/,
      "",
    );
    if (name && !names.includes(name)) names.push(name.replace(/ bot$/, ""));
  }
  return names;
}

/**
 * The plan output's line while and after it builds (frames 3, 8, 33):
 * "Building · 2 of 5 done", "Built", "3 of 5 done · 1 failed · 1 waiting".
 */
export function buildPlanLine(state, leftOff = []) {
  const steps = stepsOf(state);
  const done = steps.filter((s) => s.status === "done").length;
  const total = steps.length;
  const of = `${done} of ${total} done`;
  const status = buildStatus(state, leftOff);
  const off = leftOffNames(state, leftOff);
  const offLine = off.length ? ` · ${andList(off)} left off` : "";
  switch (status) {
    case "waiting":
    case "running":
      return `Building · ${of}`;
    case "done":
      return `Built${offLine}`;
    case "waiting-for-you":
      return "Ready for you to look at";
    case "waiting-for-providers":
      return `Built · waiting for ${andList(waitingFor(state).map(providerLabel))}${offLine}`;
    case "finished-with-problems": {
      const failed = failedSteps(state, leftOff).length;
      const waiting = steps.filter((s) => s.status === "needs-provider").length;
      return [
        of,
        failed ? `${failed} failed` : null,
        waiting ? `${waiting} waiting` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "stopped":
      return `Stopped · ${of}`;
    case "interrupted":
      return `Interrupted · ${of}`;
    case "removed":
      return "Removed";
    default:
      return of;
  }
}

/** "21:15" — a step's time in the Build log. */
export function logTime(at) {
  const d = new Date(at);
  if (!at || Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "The checklist passed. check_widget saw…" → "The checklist passed." */
const firstSentence = (t) => {
  const m = /^.*?[.!?](\s|$)/.exec(String(t || ""));
  return (m ? m[0] : String(t || "")).trim();
};

const firstLine = (t) =>
  String(t || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) || "";

/**
 * The Build log (DASH-20): every step from the start, in order — the ones
 * done, the one running (who's on it, what it did lately, its earlier
 * tries), and the ones to come (who does them, which wait for you).
 */
const ORDINAL = ["1st", "2nd", "3rd"];
const ordinal = (n) => ORDINAL[n - 1] || `${n}th`;

const WHO = { builder: "Builder", checker: "Checker", you: "You" };

/** "45s" · "2m 40s" · "1h 5m" — from ms. */
export function logDuration(ms) {
  if (!(ms >= 0)) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const between = (from, to) => {
  const a = Date.parse(from || "");
  const b = typeof to === "number" ? to : Date.parse(to || "");
  return Number.isNaN(a) || Number.isNaN(b) || b < a ? "" : logDuration(b - a);
};

// A tool's long answer the role saved to read in parts
// ("mcp-bot-mcp-widget_guide-1795…-q6uyzz.txt") → "the widget guide".
const SAVED_ANSWER = /^mcp-.+?-([a-z]+(?:_[a-z]+)*)-\d{6,}-[a-z0-9]+\.txt$/i;
const fileWords = (w) => {
  const m = SAVED_ANSWER.exec(String(w || ""));
  if (!m) return w;
  return m[1] === "widget_guide"
    ? "the widget guide"
    : `what ${m[1].replace(/_/g, " ")} returned`;
};

// What a role's tool call was, in words.
const ACTIVITY_WORDS = {
  // The Claude CLI's own tools.
  Read: (w) => (w ? `Read ${fileWords(w)}` : "Read a file"),
  Grep: (w) => (w ? `Searched ${fileWords(w)}` : "Searched the files"),
  Glob: () => "Looked for files",
  Write: (w) => (w ? `Wrote ${w}` : "Wrote a file"),
  Edit: (w) => (w ? `Changed ${w}` : "Changed a file"),
  read_widget: (w) => (w ? `Read ${w}` : "Read the widget"),
  widget_guide: () => "Read the widget guide",
  build_widget: () => "Wrote the draft",
  check_widget: () => "Checked the draft",
  search_library: () => "Searched the widget library",
  list_providers: () => "Looked at your providers",
  see_marked_spots: () => "Looked at the spots you marked",
};

/**
 * A bot's tool call from its live stream, as a log line keeps it — the
 * window's copy of what a plan build keeps for its steps (planBuild
 * activityOf). Its notes to itself (memory_*) aren't kept.
 * @returns {{ at, tool, what? } | null}
 */
export function liveActivityOf(event, at) {
  if (!event || event.type !== "tool_call" || !event.name) return null;
  let input = event.input ?? event.args;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch (_e) {
      input = null;
    }
  }
  if (!input || typeof input !== "object") input = {};
  const raw = [
    "file",
    "file_path",
    "path",
    "name",
    "componentName",
    "query",
    "pattern",
  ]
    .map((k) => input[k])
    .find((v) => typeof v === "string" && v.trim());
  const what = raw ? raw.trim().split(/[\\/]/).filter(Boolean).pop() || "" : "";
  const tool = String(event.name)
    .replace(/^mcp__.+?__/, "")
    .slice(0, 60);
  if (/^memory/.test(tool)) return null;
  return { at, tool, ...(what ? { what: what.slice(0, 80) } : {}) };
}

/** One kept tool call → "Read HaCalendar.js". */
export function activityText(a) {
  if (!a || !a.tool) return "";
  const words = ACTIVITY_WORDS[a.tool];
  if (words) return words(a.what);
  const t = String(a.tool).replace(/[_-]+/g, " ");
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${a.what ? ` · ${a.what}` : ""}`;
}

// "Lights (you chose: only reads)" — what didn't match, one line.
const mismatchWords = (mismatch) =>
  (mismatch || [])
    .map((m) => (m.chose ? `${m.main} (you chose: ${m.chose})` : m.main))
    .join("; ");

/** Why a try or a step didn't make it, in a sentence. */
function whyOf(x) {
  if (x.mismatch && x.mismatch.length)
    return `The draft didn't match what you chose: ${mismatchWords(x.mismatch)}.`;
  const line = firstLine(x.error);
  return line ? `${line.charAt(0).toUpperCase()}${line.slice(1)}` : "";
}

// What the running step's role is doing, while it works.
const NOW_WORDS = {
  build: "writing the draft",
  check: "checking the draft",
  checkbot: "checking the bot",
};

const youWait = (s) =>
  s.kind === "testbot" ? "waits for your test" : "waits for your look";
const youAfter = (s) =>
  s.kind === "testbot" ? "after you test it" : "after you say it looks good";

// What each step is, said in the chat's opening line (DASH-21 frame 2).
const STEP_WORDS = {
  build: "the Builder writes it",
  check: "the Checker checks it",
  checkbot: "the Checker checks the bot",
  preview: "you look at a preview",
  testbot: "you test it",
  save: "I save it",
  install: "I install it",
  place: "I put it on the dashboard",
  settings: "I set it up",
};
// A sentence: capitalised, ending in a full stop.
const sentence = (t) => {
  const x = String(t || "").trim();
  if (!x) return "";
  const up = `${x.charAt(0).toUpperCase()}${x.slice(1)}`;
  return /[.!?]$/.test(up) ? up : `${up}.`;
};

/**
 * The build, told in the chat as it goes (DASH-21 frame 2): the steps up
 * front, then — with their times — each try sent back and exactly why, and
 * each step done; while it runs, the step it's on and since when. The Build
 * log keeps the detail (what each role did, tool by tool).
 *
 * @returns {{ intro: string, events: [{ at, time, text, tone }],
 *   now: { text, since } | null }} — tone "warn" (sent back) or "done";
 *   null for no build yet.
 */
export function buildStory(state) {
  const steps = stepsOf(state);
  if (!steps.length) return null;
  const n = steps.length;
  const pieces = new Set(steps.map((x) => x.piece).filter((p) => p != null));
  const words = steps.map((x) => STEP_WORDS[x.kind] || null);
  const intro =
    pieces.size <= 1 && n <= 6 && words.every(Boolean)
      ? `Building it now, in ${n} ${n === 1 ? "step" : "steps"}: ${andList([
          ...new Set(words),
        ])}. I'll tell you as each one goes.`
      : `Building it now, in ${n} steps — the Build log on the right lists them. I'll tell you as each one goes.`;
  const events = [];
  steps.forEach((x) => {
    (x.tries || []).forEach((t, i) => {
      const why = sentence(whyOf(t));
      events.push({
        at: t.finishedAt || t.startedAt || "",
        tone: "warn",
        text:
          x.role === "builder"
            ? `The Builder's ${ordinal(i + 1)} draft was sent back${
                why ? `: ${why}` : "."
              } It's trying again — ${ordinal(i + 2)} try.`
            : `${x.label} didn't work${why ? `: ${why}` : "."} Trying again.`,
      });
    });
    if (x.status !== "done" || x.role === "you") return;
    if (x.kind === "preview" || x.kind === "testbot") return;
    const tries = (x.tries || []).length;
    events.push({
      at: x.finishedAt || "",
      tone: "done",
      text:
        x.kind === "build"
          ? tries
            ? `The ${ordinal(tries + 1)} draft is in.`
            : "The Builder finished the draft."
          : x.kind === "check" || x.kind === "checkbot"
            ? `The Checker checked ${x.kind === "checkbot" ? "the bot" : "it"} — it passed.`
            : `${x.label} — done.`,
    });
  });
  events.sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
  events.forEach((e) => {
    e.time = logTime(e.at);
  });
  const k = steps.findIndex((x) => x.status === "running");
  const running = k >= 0 ? steps[k] : null;
  const who = running ? WHO[running.role] || "" : "";
  return {
    intro,
    events,
    now:
      running && isBuilding(state)
        ? {
            text: `Step ${k + 1} of ${n} · ${
              who
                ? `${who} is ${NOW_WORDS[running.kind] || "working on it"}`
                : running.label
            }`,
            since: running.startedAt || null,
          }
        : null,
  };
}

/**
 * When the build can't finish (DASH-21 frame 3): what happened, why — in
 * the Builder's own terms — that nothing changed, and only the choices that
 * are really there, each one explained. From buildChat's answer for a
 * failed step (choices "failed") or the end of the line ("endofline").
 *
 * @param {object} chat  buildChat's result
 * @param {{ edit?: boolean }} [opts]  a change to a widget the user has
 * @returns {{ title, reason, unchanged, options: [{ key, label, explain }] }
 *   | null}  key: retry | fix | closest | plan | leave | carry —
 *   restored (Dash closed since): what needs the build running (try again,
 *   the Builder's fix, the closest) is Carry on building instead.
 */
export function stopTold(chat, state, { edit = false, restored = false } = {}) {
  const told = stopToldNow(chat, state, edit);
  if (!told || !restored) return told;
  const RUNS = new Set(["retry", "fix", "closest"]);
  const kept = told.options.filter((o) => !RUNS.has(o.key));
  return {
    ...told,
    options:
      kept.length === told.options.length
        ? kept
        : [
            {
              key: "carry",
              label: "Carry on building",
              explain: told.closest
                ? "Dash closed since it stopped — this picks the build up again, so it can be built the closest way."
                : "Dash closed since it stopped — this picks the build up again, so it can be tried again or fixed.",
            },
            ...kept,
          ],
  };
}

function stopToldNow(chat, state, edit) {
  if (!chat || (chat.choices !== "failed" && chat.choices !== "endofline"))
    return null;
  const step = chat.failed || null;
  // The Builder's tries are kept on its piece's build step, whichever step
  // ran out (usually the check after its last draft).
  const buildStep = step
    ? stepsOf(state).find(
        (x) => x.kind === "build" && x.piece === step.piece,
      ) || step
    : null;
  const tries = buildStep ? (buildStep.tries || []).length + 1 : 1;
  // What didn't match what the user chose is listed under the reason.
  const listed = (chat.off || []).some((o) => o && o.chose);
  // Who has to connect what, for what's left (another piece).
  const waiting = waitingFor(state).map(providerLabel);
  const waitLine = waiting.length
    ? `What needs ${andList(waiting)} waits for it — connect it above.`
    : "";
  const anyDone = stepsOf(state).some(
    (x) => x.status === "done" && x.role !== "you" && x.kind !== "check",
  );
  const unchanged = edit
    ? "Your widget is unchanged — nothing was installed."
    : anyDone && chat.choices === "failed"
      ? "Everything else that could be done is done — this part wasn't installed."
      : "Nothing was installed.";
  const planOption = {
    key: "plan",
    label: "Change the plan",
    explain:
      "Tell the Planner what to change — you'll see the new plan here before anything builds.",
  };
  if (chat.choices === "endofline") {
    // The Builder's "can't" ("show a time for each note…"), or a
    // sentence of its own — never a list, which is shown below instead.
    const what =
      step && step.endOfLine && !listed
        ? firstLine(step.endOfLine.what).replace(/^[-•*]\s*/, "")
        : "";
    const cantDo = /^(it )?can't /i.test(what) || /^[a-z]/.test(what);
    return {
      title:
        step && step.kind === "build"
          ? "The Builder can't do this as planned."
          : "It can't be done the way you chose.",
      reason: !what
        ? ""
        : cantDo
          ? sentence(`It can't ${what.replace(/^(it )?can't /i, "")}`)
          : sentence(what),
      unchanged,
      waiting: waitLine,
      closest: chat.closest
        ? sentence(`The closest that works: ${chat.closest}`)
        : "",
      options: [
        ...(chat.closest
          ? [
              {
                key: "closest",
                label: "Build it that way",
                explain: "The Builder builds the closest that works, above.",
              },
            ]
          : []),
        planOption,
        {
          key: "leave",
          label: "Stop here",
          explain:
            "Leave it as it is — your answers stay in this conversation.",
        },
      ],
    };
  }
  const usedUp = !!(step && step.fixesUsedUp);
  // Why it stopped: the failed step's own words — unless they're the
  // list of what didn't match, shown below.
  const reason = listed
    ? ""
    : sentence((step && whyOf(step)) || "it didn't finish");
  const label = step ? nameOf(nameOf(step.label, "Build"), "Check") : "";
  return {
    title:
      usedUp && step && step.piece != null && tries > 1
        ? `The Builder couldn't make this ${edit ? "change" : "work"} in ${tries} tries.`
        : step
          ? `${label} didn't work.`
          : "Part of it didn't finish.",
    reason,
    unchanged,
    waiting: waitLine,
    options: [
      ...(step && step.canRetry
        ? [
            {
              key: "retry",
              label: "Try again",
              explain:
                "Run that step again — for a problem another try can get past.",
            },
          ]
        : []),
      ...(step && step.canFix
        ? [
            {
              key: "fix",
              label: "Let the Builder fix it",
              explain: `The Builder reads what went wrong and fixes its draft, then it's checked again${
                step.fixesLeft === 1 ? " — its last try" : ""
              }.`,
            },
          ]
        : []),
      planOption,
      {
        key: "leave",
        label: chat.leave || "Leave it out",
        explain: edit
          ? "Stop here — your widget stays as it was."
          : "Carry on without it — what's built is kept.",
      },
    ],
  };
}

/**
 * A provider the build waits for, asked in the chat (DASH-21 frame 6): for
 * each type, its name and what waits for it ("Inbox Summary").
 */
// What a provider is for, named by what's built — not the steps after it.
const NEEDS_KINDS = new Set(["build", "install", "check", "bot", "widget"]);

export function needsTold(state, types = []) {
  const steps = stepsOf(state);
  return (types || []).map((t) => {
    const what = [
      ...new Set(
        steps
          .filter(
            (x) =>
              x.status === "needs-provider" &&
              NEEDS_KINDS.has(x.kind) &&
              (x.waitingFor || []).some((w) => normalizeType(w) === t),
          )
          .map((x) =>
            String(x.label || "").replace(
              /^(Build|Check|Install|Save|Place|Run|Make|Set up|Connect) /,
              "",
            ),
          )
          .filter(Boolean),
      ),
    ];
    return { type: t, label: providerLabel(t), what };
  });
}

/**
 * The log's rows. Each: { id, label, state, who, side, note, now,
 * activity: [{ time, text, tone }] (earlier tries first, tone "warn"),
 * tries: the try lines alone, badge, detail }.
 * state: "done" | "running" | "bad" | "warn" | "you" (waits for you) |
 * "next" (to come) | "off" (not started, and won't be this time).
 * @param {{ now?: number, edit?: boolean }} [opts] — now: the time the
 *   running step is shown at; edit: a change to a widget the user has.
 */
export function buildLogSteps(state, leftOff = [], opts = {}) {
  const at = typeof opts.now === "number" ? opts.now : Date.now();
  // Still to come: while it builds, and while it waits for the user's look.
  const building =
    isBuilding(state) || (state && state.status) === "waiting-for-you";
  let stoppedSeen = false;
  let waitingOn = null; // a step of the user's, not done, before this one
  let nextSeen = false;
  return stepsOf(state).map((s) => {
    // Each earlier try is a line in the log, before what this try did.
    const tries = (s.tries || []).map((t, i) => {
      const why = whyOf(t);
      return {
        time: logTime(t.finishedAt),
        text: `${ordinal(i + 1)} try ${s.role === "builder" ? "sent back" : "didn't work"}${why ? ` — ${why}` : ""}`,
        tone: "warn",
      };
    });
    const activity = [
      ...tries,
      ...(s.activity || []).map((a) => ({
        time: logTime(a.at),
        text: activityText(a),
        tone: "",
      })),
    ];
    const row = {
      id: s.id,
      label: s.label,
      who: WHO[s.role] || "",
      state: "next",
      side: "",
      note: "",
      now: "",
      activity,
      tries,
      badge: tries.length ? `${ordinal(tries.length + 1)} try` : "",
      // Plain words: the Builder writes Markdown, read here as text.
      detail: String(s.detail || "")
        .replace(/\*\*|__|`/g, "")
        .slice(0, 1200),
    };
    const took = between(s.startedAt, s.finishedAt);
    const triesWord = tries.length ? `${tries.length + 1} tries` : "";
    if (isLeftOff(s, leftOff)) {
      row.state = "warn";
      row.side = "left off";
    } else
      switch (s.status) {
        case "done":
          row.state = "done";
          row.side =
            s.role === "you"
              ? s.kind === "testbot"
                ? "you tested it"
                : "you said it looks good"
              : s.kind === "check"
                ? ["passed", took].filter(Boolean).join(" · ")
                : s.role === "builder" || s.role === "checker"
                  ? [triesWord, took].filter(Boolean).join(" · ") ||
                    logTime(s.finishedAt)
                  : // Dash's own steps take a moment: when it was done.
                    logTime(s.finishedAt);
          break;
        case "running":
          row.state = "running";
          row.side = [
            s.startedAt ? `started ${logTime(s.startedAt)}` : "",
            between(s.startedAt, at),
          ]
            .filter(Boolean)
            .join(" · ");
          row.now = row.who
            ? `${row.who} · ${NOW_WORDS[s.kind] || "working on it"}`
            : "";
          break;
        case "failed":
          row.state = "bad";
          row.note = whyOf(s) || "It didn't work.";
          row.side = [
            [logTime(s.startedAt), logTime(s.finishedAt)]
              .filter(Boolean)
              .join(" – "),
            triesWord,
          ]
            .filter(Boolean)
            .join(" · ");
          break;
        case "needs-you":
          row.state = "warn";
          row.side =
            s.kind === "testbot"
              ? "waiting for your test"
              : "waiting for your look";
          break;
        case "needs-provider":
          row.state = "warn";
          row.side = `waiting for ${andList((s.waitingFor || []).map(providerLabel))}`;
          break;
        case "stopped":
          // Stopped once, on the step it was on; the rest never started.
          row.state = stoppedSeen ? "off" : "warn";
          row.side = stoppedSeen ? "not started" : "stopped";
          stoppedSeen = true;
          break;
        case "skipped":
          // What held it back says why, once — not every step after it.
          row.state = "off";
          row.side = "not started";
          break;
        default:
          // Not started yet — or cut off when the app closed mid-step.
          if (!building && s.startedAt && !s.finishedAt) {
            row.state = "warn";
            row.side = "interrupted";
          } else if (!building) {
            row.state = "off";
            row.side = "not started";
          } else if (s.role === "you") {
            row.state = "you";
            row.side = waitingOn ? youAfter(waitingOn) : youWait(s);
          } else if (waitingOn) {
            row.side = youAfter(waitingOn);
          } else {
            row.side = [row.who, nextSeen ? "" : "next"]
              .filter(Boolean)
              .join(" · ");
            nextSeen = true;
          }
      }
    if (row.state === "off" && opts.edit && s.kind === "save")
      row.side = "not started · your widget is unchanged";
    if (s.role === "you" && s.status !== "done" && !waitingOn) waitingOn = s;
    return row;
  });
}

/**
 * The log's top line (DASH-20): "Step 2 of 4 · building for 2m 40s",
 * "Stopped at step 1 of 4 · 3m 10s", "Done · 4 steps in 6m 20s · sent back
 * once". tone: "running" | "bad" | "warn" | "ok" | "".
 * @returns {{ lead, rest, tone }}
 */
export function buildLogHead(state, leftOff = [], opts = {}) {
  const at = typeof opts.now === "number" ? opts.now : Date.now();
  const steps = stepsOf(state);
  const total = steps.length;
  const status = buildStatus(state, leftOff);
  const nth = (pred) => steps.findIndex(pred) + 1;
  const of = (n) => `${n} of ${total}`;
  const start = state && state.startedAt;
  const sentBack = steps.reduce((n, s) => n + (s.tries || []).length, 0);
  const sent = sentBack
    ? `sent back ${sentBack === 1 ? "once" : `${sentBack} times`}`
    : "";
  const join = (...parts) => parts.filter(Boolean).join(" · ");
  if (isBuilding(state)) {
    const n =
      nth((s) => s.status === "running") ||
      nth((s) => s.status === "waiting") ||
      1;
    return {
      lead: `Step ${of(n)}`,
      rest: start ? `building for ${between(start, at)}` : "starting…",
      tone: "running",
    };
  }
  const took = between(start, state && state.finishedAt);
  switch (status) {
    case "done":
      return {
        lead: "Done",
        rest: join(
          `${total === 1 ? "1 step" : `${total} steps`}${took ? ` in ${took}` : ""}`,
          sent,
        ),
        tone: "ok",
      };
    case "waiting-for-you": {
      const n = nth((s) => s.status === "needs-you");
      return {
        lead: `Waiting for you at step ${of(n)}`,
        rest: took,
        tone: "warn",
      };
    }
    case "waiting-for-providers":
      return {
        lead: `Waiting for ${andList(waitingFor(state).map(providerLabel))}`,
        rest: "",
        tone: "warn",
      };
    case "finished-with-problems": {
      const failed = failedSteps(state, leftOff)[0];
      const n = failed ? steps.indexOf(failed) + 1 : 0;
      return {
        lead: n ? `Stopped at step ${of(n)}` : "Stopped",
        rest: join(took, sent),
        tone: "bad",
      };
    }
    case "stopped": {
      const n = nth((s) => s.status === "stopped");
      return {
        lead: n ? `Stopped at step ${of(n)}` : "Stopped",
        rest: took,
        tone: "warn",
      };
    }
    case "removed":
      return { lead: "Removed", rest: "", tone: "" };
    case "interrupted":
      return { lead: "Interrupted", rest: took, tone: "warn" };
    default:
      return { lead: "Not started", rest: "", tone: "" };
  }
}

const nameOf = (label, verb) =>
  String(label || "").replace(new RegExp(`^${verb}\\s+`), "");

/**
 * The Check report (frame 7): a row per widget the Checker looked at —
 * passed, or what it found.
 */
export function checkRows(state) {
  return stepsOf(state)
    .filter((s) => s.kind === "check" && s.status !== "waiting")
    .map((s) => {
      const name = nameOf(s.label, "Check");
      if (s.status === "done")
        return {
          ok: true,
          main: `${name} — passed`,
          // The Checker's words, without a leading "Passed." (the row says it).
          sub: firstSentence(
            firstLine(s.detail).replace(/^(verdict:\s*)?passed[.:!]?\s*/i, ""),
          ),
        };
      if (s.status === "failed")
        return {
          ok: false,
          main: `${name} — didn't pass`,
          sub: firstLine(s.detail || s.error),
        };
      if (s.status === "running")
        return { ok: null, main: `${name} — checking…`, sub: "" };
      return {
        ok: null,
        main: `${name} — not checked`,
        sub: firstLine(s.error),
      };
    });
}

const things = (n) => (n === 1 ? "1 thing" : `${n} things`);

/**
 * Held to your choices: Dash's own check of a widget's code against what
 * the user chose — its check step, the rows (made[i].held), what doesn't
 * match yet (made[i].mismatch), and a step at the end of the line.
 * @returns {{ step, build, held, mismatch, end } | null}
 */
export function heldOf(state) {
  const steps = stepsOf(state);
  const made = (state && state.made) || {};
  const end = steps.find((s) => s.status === "failed" && s.endOfLine) || null;
  for (const s of steps.filter((x) => x.kind === "check")) {
    const m = made[s.piece] || {};
    const ending = end && end.piece === s.piece ? end : null;
    if (m.held || m.mismatch || ending) {
      return {
        step: s,
        build: steps.find((x) => x.id === `build:${s.piece}`) || null,
        held: m.held || null,
        mismatch:
          Array.isArray(m.mismatch) && m.mismatch.length ? m.mismatch : null,
        end: ending,
      };
    }
  }
  return end
    ? { step: null, build: null, held: null, mismatch: null, end }
    : null;
}

/** The chat's lines once it matches: fixed to match, then checked. */
export function heldLines(h) {
  if (!h || !h.held || h.mismatch || !(h.held.rows || []).length) return [];
  return [
    ...(h.held.fixed
      ? [
          {
            label: `Builder fixed ${things(h.held.fixed)} to match your choices`,
            status: "done",
          },
        ]
      : []),
    {
      label: "Checked — it matches every choice you made",
      status: "done",
      link: "check",
    },
  ];
}

/** The Checker's line once it passed the widget being previewed. */
function checkerLines(state, at) {
  const steps = (state && state.steps) || [];
  const check = at
    ? steps.find((s) => s.id === `check:${at.piece}`)
    : steps.find((s) => s.kind === "check");
  return check && check.status === "done"
    ? [{ label: "Checker passed it", status: "done", role: "checker" }]
    : [];
}

/**
 * Which model ran it: the build's step lines, each with the run behind it —
 * the Builder's or the Checker's model, style, whose choice and how long it
 * took, or Dash itself for its own check of what the user chose.
 */
export function withRuns(chat, state) {
  if (!chat) return chat;
  const steps = (state && state.steps) || [];
  const runOf = (kind, role) => {
    const done = steps.filter((s) => s.kind === kind && s.model);
    const s = done[done.length - 1];
    return s
      ? {
          model: s.model,
          style: s.style || null,
          modelChosen: !!s.modelChosen,
          tookMs: s.tookMs || null,
          role,
        }
      : null;
  };
  const tag = (line) => {
    if (!line || line.run) return line;
    const label = String(line.label || "");
    const run =
      line.role === "checker" || /^Checker\b/.test(label)
        ? runOf("check", "checker")
        : /^Checked —/.test(label)
          ? { dash: true }
          : /^(Builder|Sent to the Builder)\b/.test(label)
            ? runOf("build", "builder")
            : null;
    return run ? { ...line, run } : line;
  };
  return {
    ...chat,
    step: tag(chat.step),
    ...(chat.lines ? { lines: chat.lines.map(tag) } : {}),
  };
}

/**
 * The Check report's "What you chose": each choice, checked in the code —
 * or, while it's being fixed, what doesn't match yet.
 */
export function heldRows(state) {
  const h = heldOf(state);
  if (!h) return [];
  const rows = h.held && Array.isArray(h.held.rows) ? h.held.rows : [];
  const off = (h.mismatch || []).map((p) => ({
    ok: false,
    main: p.main,
    sub: p.chose ? `You chose: ${p.chose}` : "",
  }));
  return off.length ? [...off, ...rows.filter((r) => r.ok)] : rows;
}

/** "2 new widgets checked" — the report's line. */
// Steps the Checker really looked at (or is looking at) — one skipped
// because its build didn't finish was never checked.
const CHECKED = new Set(["running", "done", "failed"]);
export const checkRan = (state) =>
  stepsOf(state).some((s) => s.kind === "check" && CHECKED.has(s.status));

export function checkLine(state) {
  const steps = stepsOf(state).filter((s) => s.kind === "check");
  const n = steps.filter(
    (s) => s.status === "done" || s.status === "failed",
  ).length;
  if (!n && steps.some((s) => s.status === "running")) return "Checking…";
  return n === 1 ? "1 new widget checked" : `${n} new widgets checked`;
}

const tokensOf = (steps) =>
  steps.reduce((sum, s) => sum + (Number(s.tokens) || 0), 0);
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * The Builder's and the Checker's rows while it builds and after (frames 3,
 * 8, 31, 33): { tone, state, line, out? } — or null for a role the build
 * didn't use and won't. `lines` are the live lines by role. `out`: what
 * its row opens — "preview" (frame 31), or false while there's nothing to
 * open yet; otherwise the role's own output.
 */
export function buildMemberState(role, state, leftOff = [], lines = {}) {
  const steps = stepsOf(state).filter((s) => s.role === role);
  if (!steps.length) return null;
  // A preview waiting for your look (frame 31).
  const look = stepsOf(state).find(
    (s) => s.kind === "preview" && s.status === "needs-you",
  );
  if (role === "builder" && look)
    return {
      tone: "idle",
      state: "waiting for you",
      line: `${String(look.label).replace(/^Preview /, "")} built — waiting for your look`,
      out: "preview",
    };
  // The Checker's report has something in it once a check has run.
  const started = steps.some(
    (s) =>
      s.status !== "waiting" &&
      s.status !== "stopped" &&
      s.status !== "skipped",
  );
  const out = role === "checker" && !started ? { out: false } : {};
  const used = tokensOf(steps);
  const spent = used ? ` · ${formatTokens(used)} tokens` : "";
  const running = steps.find((s) => s.status === "running");
  if (running)
    return {
      tone: "working",
      state: "working",
      line: lines[role] || `› ${running.label}`,
      ...out,
    };
  const failed = steps.find(
    (s) => s.status === "failed" && !isLeftOff(s, leftOff),
  );
  if (failed)
    return {
      tone: "bad",
      state: "failed",
      line: `${role === "checker" ? nameOf(failed.label, "Check") : nameOf(failed.label, "Build")} — ${firstLine(role === "checker" ? failed.detail || failed.error : failed.error) || "it didn't work"}`,
    };
  const done = steps.filter((s) => s.status === "done");
  if (role === "builder") {
    if (done.length === steps.length)
      return {
        tone: "ok",
        state: `done${spent}`,
        line: `built ${plural(done.length, "widget")}`,
      };
    if (isBuilding(state))
      return {
        tone: "idle",
        state: "waiting",
        line: done.length ? `built ${done.length} so far` : "builds next",
      };
    return {
      tone: "idle",
      state: done.length ? `done${spent}` : "stopped",
      line: done.length ? `built ${plural(done.length, "widget")}` : "",
    };
  }
  const passed = done.length;
  // What it really looked at — a check that was stopped or skipped wasn't.
  const looked = steps.filter(
    (s) => s.status === "done" || s.status === "failed",
  ).length;
  if (passed === steps.length)
    return {
      tone: "ok",
      state: `done${spent}`,
      line: `passed ${passed} of ${steps.length}`,
    };
  if (!isBuilding(state) && !looked)
    return {
      tone: "idle",
      state:
        state.status === "stopped" || state.status === "interrupted"
          ? "stopped"
          : "not needed",
      line: "",
      ...out,
    };
  if (isBuilding(state) || !looked)
    return {
      tone: "idle",
      state: "waiting",
      line: passed ? `passed ${passed} so far` : "checks them next",
      ...out,
    };
  return {
    tone: "idle",
    state: `done${spent}`,
    line: `passed ${passed} of ${steps.length}`,
  };
}

/** "the Builder is building 2 widgets" — what's going on, for the reply box. */
export function workingLine(state) {
  const steps = stepsOf(state);
  const running = steps.find((s) => s.status === "running");
  if (!running) return "The team is working";
  if (running.role === "builder") {
    const n = steps.filter((s) => s.kind === "build").length;
    return `The team is working · the Builder is building ${plural(n, "widget")}`;
  }
  if (running.role === "checker")
    return `The team is working · the Checker is checking ${nameOf(running.label, "Check")}`;
  return `The team is working · ${running.label}`;
}

/**
 * The build in the chat (frames 3, 8, 31, 33): a step line, an output card,
 * the lead's words, and the reply choices.
 *   step: { label, status: "asking" | "done" | "failed" | "stopped" }
 *   card: { kind: "dashboard" | "widget" | "bot", title, sub } | null
 *   reply: the lead's words
 *   choices: "open" | "failed" | "preview" | "continue" | "again" |
 *     "theme" (Open in the theme editor, theme round) |
 *     "themechange" (Publish the update / your remix, theme change round) |
 *     null
 *   continueLabel: Carry on building, or Start it again (nothing built yet)
 *   failed: the step asked about (choices "failed")
 * A theme change (theme change round): `appThemeKey` — the app's theme
 * now, so "use the remix for the app" is offered only while it applies.
 * A cell build (release 6c): `cell` { dashboardName, placed, canPlace } —
 * placed: true (in the cell, unsaved; nothing to choose), "placing", a
 * reason it didn't go in ("preview", "no-answer", "taken", "gone",
 * "unknown-widget", "failed"), or unknown (a reopened one): choices "place"
 * where it can still go in.
 * A change to one widget (release 6c): kind "settings" (set on that copy)
 * or "edit" (built, previewed, then saved) — `change` { displayName, mode,
 * dashboardName, onDashboard, settingLabels, placed, canPlace }: placed as
 * a cell build's, for a new widget taking that copy's place.
 */
export function buildChat(state, opts = {}) {
  // (opts.appThemeKey: a theme change's app theme now — chatFor)
  const chat = chatFor(state, opts);
  // Nothing runs a build saved before Dash last closed (or carried on from
  // the Create window, release 6c): what it waits on starts it again.
  if (
    opts.restored &&
    (chat.choices === "failed" ||
      chat.choices === "preview" ||
      chat.choices === "testbot" ||
      chat.choices === "endofline" ||
      buildStatus(state, opts.leftOff || []) === "waiting-for-providers")
  ) {
    return {
      ...chat,
      reply: `${
        chat.ask && String(chat.reply).endsWith(chat.ask)
          ? String(chat.reply).slice(0, -chat.ask.length)
          : chat.reply
      }\n\nThis build was saved before Dash last closed — carry on building to pick it up from there.`,
      choices: "continue",
      continueLabel: "Carry on building",
    };
  }
  return chat;
}

/** "the app and 2 dashboards show it" — where a changed theme shows. */
function shownLine(usedBy) {
  const u = usedBy || {};
  const n = (u.dashboards || []).length;
  const dashboards = n === 1 ? u.dashboards[0] : n ? `${n} dashboards` : null;
  if (u.app && dashboards) return `the app and ${dashboards} show it`;
  if (u.app) return "the app shows it";
  if (dashboards) return `${dashboards} ${n === 1 ? "shows" : "show"} it`;
  return "nothing uses it yet";
}

/**
 * A change to a saved theme, built (theme change round, frames 51-52): the
 * user's own is changed — Publish the update when it's published; a
 * downloaded one became a remix — Publish your remix, unless its author
 * doesn't allow that. choices "themechange".
 */
function themeChangeChat(state, appThemeKey) {
  const ch = state && state.changedTheme;
  if (!ch) {
    return {
      step: { label: "The theme wasn't changed", status: "stopped" },
      card: null,
      reply:
        "The theme wasn't changed, so nothing is different. Say if you want to try again.",
      choices: "again",
    };
  }
  if (ch.remix) {
    const of = ch.of || {};
    const by = of.author || "its author";
    const on = (ch.replaced || []).map((r) => r.name);
    const onLine = on.length ? ` and on ${andList(on)}` : "";
    // Whether the app uses the original — now, when the app's theme is
    // known; as it was at the build otherwise.
    const appUses =
      appThemeKey !== undefined && of.key
        ? appThemeKey === of.key
        : !!ch.appUsesOriginal;
    const appNote = appUses
      ? ` The app's theme is still ${of.name || "the original"} — use the remix for the app too?`
      : "";
    return {
      step: {
        label: `Saved ${ch.name}${on.length ? ` · put it on ${andList(on)}` : ""}`,
        status: "done",
      },
      card: {
        kind: "theme",
        title: ch.name,
        sub: `Theme · a remix of ${of.name || "a theme"}${of.author ? ` by ${of.author}` : ""}`,
      },
      reply:
        ch.allowRemix === false
          ? `${ch.name} is in your themes${onLine}. ${by} doesn't allow remixes to be published, so it stays yours to use — it can't go on the registry.${appNote}`
          : appNote
            ? `${ch.name} is in your themes${onLine}. It credits ${by}'s ${of.name || "theme"}.${appNote}`
            : `${ch.name} is in your themes${onLine}. It credits ${by}'s ${of.name || "theme"} — publish it if you'd like to share it.`,
      choices: "themechange",
    };
  }
  const pub = ch.published;
  return {
    step: { label: `Changed ${ch.name}`, status: "done" },
    card: {
      kind: "theme",
      title: ch.name,
      sub: pub ? "Theme · changed · not yet published" : "Theme · changed",
    },
    reply: `${ch.name} is changed — ${shownLine(ch.usedBy)}.${
      pub
        ? ` It's published${pub.visibility ? ` (${pub.visibility})` : ""}${
            pub.version ? ` as v${pub.version}` : ""
          }; the registry still has that version until you publish the update.`
        : ""
    }`,
    choices: "themechange",
  };
}

function chatFor(
  state,
  {
    kind = "dashboard",
    leftOff = [],
    cell = null,
    change = null,
    appThemeKey,
  } = {},
) {
  const steps = stepsOf(state);
  const status = buildStatus(state, leftOff);
  const built = steps.filter((s) => s.kind === "build");
  const builtDone = built.filter((s) => s.status === "done");
  const checks = steps.filter((s) => s.kind === "check");
  const checked = checks.filter((s) => s.status === "done");
  const bots = Object.values((state && state.bots) || {}).filter(
    (b) => b && b.id,
  );
  const dashboard = state && state.dashboard;
  const waiting = waitingFor(state).map(providerLabel);
  const off = leftOffNames(state, leftOff);
  const builtLine = () => {
    const parts = [];
    if (builtDone.length) parts.push(plural(builtDone.length, "widget"));
    if (bots.length)
      parts.push(bots.length === 1 ? "the bot" : `${bots.length} bots`);
    // Nothing built (a widget the user already has): never "built".
    const what = parts.length
      ? `Builder built ${parts.join(" and ")}`
      : built.length
        ? "Built it"
        : "Set it up — nothing to build";
    return checked.length
      ? `${what} · Checker checked ${checked.length === 1 ? "it" : "them"}`
      : what;
  };

  const held = heldOf(state);
  if (
    isBuilding(state) &&
    held &&
    held.mismatch &&
    held.build &&
    (held.build.status === "running" || held.build.status === "waiting")
  ) {
    return {
      step: {
        label: `Checked — ${things(held.mismatch.length)} didn't match what you chose`,
        status: "failed",
        link: "check",
      },
      lines: [
        {
          label: "Builder is fixing them, then it's checked again",
          status: "asking",
        },
      ],
      off: held.mismatch,
      card: null,
      reply:
        "The Builder is bringing it in line with what you chose.\n\nIt fixes and re-checks until it matches — nothing for you to do, and nothing is installed until then.",
      choices: null,
    };
  }
  if (isBuilding(state)) {
    const toBuild = built.some(
      (s) => s.status === "running" || s.status === "waiting",
    )
      ? built.length
      : 0;
    return {
      step: {
        label: toBuild
          ? `Builder is building ${plural(toBuild, "widget")}`
          : "Setting it up",
        status: "asking",
      },
      card: null,
      reply: waiting.length
        ? `Building now. One thing needs you — connect ${andList(waiting)}, above. Everything else carries on.`
        : "Building now — I'll tell you when it's done.",
      choices: null,
    };
  }
  if (status === "waiting-for-you") {
    const at = steps.find((s) => s.status === "needs-you");
    // A bot made but not saved: it waits for the user to test it
    // (bot-test-run TST-003).
    if (at && at.kind === "testbot") {
      const bot = String(at.label).replace(/^Test /, "");
      return {
        step: { label: `Made ${bot} · not saved yet`, status: "done" },
        card: { kind: "bot", title: bot, sub: "Bot · ready to test" },
        reply: `${bot} is made — test it here before it's saved. A test runs it once and shows what it gives back. Save it once a test works; nothing is saved before that.`,
        choices: "testbot",
      };
    }
    const name = at ? String(at.label).replace(/^Preview /, "") : "It";
    // A widget the user already has: nothing was built — it's theirs, set
    // as they chose.
    if (!built.length && kind !== "edit") {
      return {
        step: { label: `${name} is ready to look at`, status: "done" },
        card: {
          kind: "widget",
          title: name,
          sub: "Your widget · preview ready",
        },
        reply: `${name} is on the right, running — the one you already have, set as you chose. Click Looks good to put it in ${
          kind === "cell" ? "the cell you picked" : "place"
        }.`,
        choices: "preview",
      };
    }
    return {
      step: { label: `Builder built ${name}`, status: "done" },
      lines: [...heldLines(held), ...checkerLines(state, at)],
      card: { kind: "widget", title: name, sub: "Widget · preview ready" },
      // A change from here is a fix: the Builder edits its own widget.
      reply: `${name} is ready to look at — it's on the right, running. Tell me what to change and I'll send it to the Builder as a fix — the rest stays as it is — before ${
        kind === "cell"
          ? "it goes in the cell you picked"
          : kind === "edit" && change && change.mode === "update"
            ? `${change.displayName || "it"} changes everywhere it's used`
            : kind === "edit"
              ? "it's saved as a new widget"
              : "it goes into your widgets"
      }.`,
      choices: "preview",
    };
  }
  if (status === "finished-with-problems") {
    const failed = failedSteps(state, leftOff);
    const first = failed[0] || null;
    if (first && first.endOfLine) {
      const e = first.endOfLine;
      const mine = held && held.end === first ? held.mismatch : null;
      const off = mine || [
        { main: firstLine(e.what) || "it couldn't be done", chose: null },
      ];
      return {
        step: {
          label:
            first.kind === "build"
              ? "Builder can't do one thing you chose"
              : `Checked — ${things(off.length)} can't be done as you chose`,
          status: "failed",
          ...(first.kind === "check" ? { link: "check" } : {}),
        },
        off,
        card: null,
        reply: `I couldn't make ${off.length === 1 ? "one thing" : "some things"} match what you chose.\n\nIt isn't something another try can fix. Nothing was installed.`,
        choices: "endofline",
        failed: first,
        closest: e.closest || null,
      };
    }
    const label = first
      ? nameOf(nameOf(first.label, "Build"), "Check")
      : "One step";
    // Only what's offered (BuildChoices): Try again, the Builder's fix, or
    // — neither left — a change said in the reply. Then dropping it.
    const leave =
      kind === "edit" ? "Keep the widget as it was" : "Leave it out";
    const ask = !first
      ? ""
      : first.canRetry
        ? `\n\nTry it again, or ${leave.toLowerCase()}?`
        : first.canFix
          ? `\n\nLet the Builder fix it, or ${leave.toLowerCase()}?`
          : `\n\nSay what to change in the reply, or ${leave.toLowerCase()}.`;
    return {
      step: {
        label: first
          ? `${first.role === "checker" ? "Checker" : first.role === "builder" ? "Builder" : "Dash"} couldn't finish ${label}`
          : "Something didn't finish",
        status: "failed",
      },
      card: null,
      reply: [
        first
          ? `${label} didn't work — ${firstLine(first.error) || "it didn't finish"}. Everything else that could be done is done.`
          : "Part of it didn't finish. Everything else that could be done is done.",
        waiting.length
          ? ` What needs ${andList(waiting)} waits for it — connect it above.`
          : "",
        ask,
      ].join(""),
      choices: first ? "failed" : null,
      failed: first,
      ask,
      leave,
    };
  }
  if (status === "stopped" || status === "interrupted") {
    const any = steps.some((s) => s.status === "done");
    return {
      step: { label: "The build stopped", status: "stopped" },
      card: null,
      reply: !any
        ? status === "interrupted"
          ? "The app closed before anything was built. I can start it again."
          : "Stopped before anything was built. I can start it again."
        : status === "interrupted"
          ? "The app closed while it was building. What's built is kept — I can carry on from there."
          : "Stopped — what's built is kept. I can carry on from there.",
      choices: "continue",
      continueLabel: any ? "Carry on building" : "Start it again",
    };
  }
  // Removed: the plan can be built again.
  if (status === "removed") {
    return {
      step: { label: "Removed what was built", status: "done" },
      card: null,
      reply: "I removed what the build made. Say if you want it built again.",
      choices: "again",
    };
  }
  // Built (or built, waiting for a provider).
  const leftNote = off.length
    ? ` ${andList(off)} ${off.length === 1 ? "is" : "are"} left off.`
    : "";
  const waitNote = waiting.length
    ? ` What needs ${andList(waiting)} runs once it's connected — connect it above.`
    : "";
  if (kind === "theme") {
    const made = state && state.madeTheme;
    // Left off before it was saved: nothing was made.
    if (!made) {
      return {
        step: { label: "The theme wasn't saved", status: "stopped" },
        card: null,
        reply:
          "The theme wasn't saved, so nothing changed. Say if you want to try again.",
        choices: "again",
      };
    }
    const name = made.name;
    return {
      step: { label: `Saved the ${name} theme`, status: "done" },
      card: { kind: "theme", title: name, sub: "Theme · saved" },
      reply: `${name} is in your themes. Use it on any dashboard from its Settings › Theme — or tell me which one and I'll put it on.`,
      choices: "theme",
    };
  }
  if (kind === "themechange") return themeChangeChat(state, appThemeKey);
  if (kind === "settings") {
    const name = (change && change.displayName) || "The widget";
    const labels = (change && change.settingLabels) || {};
    const at = steps.find((s) => s.kind === "settings");
    const keys = at && at.detail ? String(at.detail).split(", ") : [];
    const which = keys.map((k) => labels[k] || k);
    const on = dashboard
      ? dashboard.name
      : (change && change.dashboardName) || "";
    return {
      step: { label: `Changed ${name}'s settings`, status: "done" },
      card: {
        kind: "widget",
        title: name,
        sub: `Settings · ${plural(keys.length, "change")}`,
      },
      reply: `${name}'s settings are changed${on ? ` on ${on}` : ""}${
        which.length ? `: ${andList(which)}` : ""
      }. Only this copy changed.`,
      choices: dashboard ? "open" : null,
    };
  }
  if (kind === "edit") {
    const made = steps.find((s) => s.kind === "save");
    const was = (change && change.displayName) || "The widget";
    const name = made
      ? String(made.label).replace(/^(Install|Update) /, "")
      : was;
    const on = (change && change.dashboardName) || "your dashboard";
    // Its save step didn't finish (left off): nothing changed — never "is
    // updated" while the old code is what runs.
    if (made && made.status !== "done") {
      const asNew = change && change.mode === "new";
      return {
        step: {
          label: asNew ? `${was} wasn't saved as new` : `${was} wasn't updated`,
          status: "stopped",
        },
        card: null,
        reply: asNew
          ? `The new widget wasn't saved — ${was} is unchanged. Say if you want to try again.`
          : `${was} wasn't updated — it still runs the code it had. Say if you want to try again.`,
        choices: "again",
      };
    }
    if (!change || change.mode === "update") {
      return {
        step: { label: builtLine(), status: "done" },
        card: { kind: "widget", title: was, sub: "Widget · updated" },
        reply: `${was} is updated — everywhere it's used shows the change.${waitNote}`,
        choices: null,
      };
    }
    if (!change.onDashboard) {
      return {
        step: { label: builtLine(), status: "done" },
        card: { kind: "widget", title: name, sub: "Widget · in your widgets" },
        reply: `${name} is in your widgets — ${was} stays as it is. Put it on a dashboard from any empty cell's Add widget.${waitNote}`,
        choices: null,
      };
    }
    // A new widget taking that copy's place: the editor swaps it in.
    const placed = change.placed;
    const why = {
      preview: `${on} isn't being edited, so it isn't in ${was}'s place yet. Open ${on}, click Edit, then put it in.`,
      "no-answer": `It isn't in ${was}'s place yet: ${on} isn't open for editing on the page with it. Open it there, click Edit, then put it in.`,
      gone: `${was} isn't on ${on} any more — add the new one to any empty cell with Add widget.`,
      "unknown-widget": "It isn't ready to go in yet. Try again in a moment.",
      failed: "Something went wrong putting it in. Try again.",
    };
    const again =
      !!change.canPlace && placed !== "gone" && placed !== "placing";
    return {
      step: { label: builtLine(), status: "done" },
      card: {
        kind: "widget",
        title: name,
        sub:
          placed === true
            ? `Widget · in ${was}'s place`
            : "Widget · in your widgets",
      },
      reply:
        placed === true
          ? `${name} is in ${was}'s place on ${on}. Save ${on} to keep it.${waitNote}`
          : placed === "placing"
            ? `${name} is ready — putting it in ${was}'s place…`
            : why[placed]
              ? `${name} is in your widgets. ${why[placed]}${waitNote}`
              : `${name} is in your widgets. If it isn't in ${was}'s place yet, put it in while you're editing ${on}.${waitNote}`,
      choices: again && placed !== true ? "swap" : null,
    };
  }
  if (kind === "cell") {
    const made = steps.find((s) => s.kind === "save" || s.kind === "install");
    const name = made
      ? String(made.label).replace(/^Install /, "")
      : "Your widget";
    const on = (cell && cell.dashboardName) || "your dashboard";
    const placed = cell ? cell.placed : null;
    const canPlace = !!(cell && cell.canPlace);
    const why = {
      preview: `${on} isn't being edited any more, so it couldn't go in the cell. Open ${on}, click Edit, then put it in.`,
      "no-answer": `It couldn't go in the cell: ${on} isn't open for editing on the page with that cell. Open it there, click Edit, then put it in.`,
      taken:
        "The cell you picked isn't empty any more, so it wasn't put in — add it to any empty cell with Add widget.",
      gone: "The cell you picked isn't there any more — add it to any empty cell with Add widget.",
      "unknown-widget":
        "It isn't ready to go in the cell yet. Try again in a moment.",
      failed: "Something went wrong putting it in the cell. Try again.",
    };
    // Tried again only where it can still go in.
    const again =
      canPlace &&
      placed !== "taken" &&
      placed !== "gone" &&
      placed !== "placing";
    return {
      step: { label: builtLine(), status: "done" },
      card: {
        kind: "widget",
        title: name,
        sub:
          placed === true
            ? "Widget · in the cell you picked"
            : "Widget · in your widgets",
      },
      reply:
        placed === true
          ? `${name} is in the cell you picked. Save ${on} to keep it.${waitNote}`
          : placed === "placing"
            ? `${name} is ready — putting it in the cell you picked…`
            : why[placed]
              ? `${name} is in your widgets. ${why[placed]}${waitNote}`
              : `${name} is in your widgets. If it isn't in the cell you picked yet, put it in while you're editing ${on}.${waitNote}`,
      // In the cell: done — the window closes. Not in it: put it in.
      choices: again && placed !== true ? "place" : null,
    };
  }
  if (kind === "widget") {
    const made = steps.find((s) => s.kind === "save" || s.kind === "install");
    const name = made
      ? String(made.label).replace(/^Install /, "")
      : "Your widget";
    return {
      step: { label: builtLine(), status: "done" },
      card: { kind: "widget", title: name, sub: "Widget · in your widgets" },
      reply: `${name} is in your widgets. Put it on a dashboard from any empty cell's Add widget.${waitNote}`,
      choices: null,
    };
  }
  if (kind === "bot" || (!dashboard && bots.length)) {
    const bot = bots[0];
    return {
      step: { label: "Saved the bot", status: "done" },
      card: bot
        ? { kind: "bot", title: bot.name, sub: "Bot · tested, saved, paused" }
        : null,
      // Tested before it was saved (TST-003): only turning it on is left.
      reply: `${bot ? bot.name : "The bot"} is saved, paused, with its test kept as its sample. Turn it on when you want it to run on its own.${waitNote}`,
      // Turn on, right here (BuildViews).
      choices: bot ? "turnon" : null,
    };
  }
  const placed = steps.filter(
    (s) => s.kind === "place" && s.status === "done",
  ).length;
  // The theme it applied (theme round: maybe one it made).
  const themed =
    state &&
    state.theme &&
    steps.some((s) => s.kind === "theme" && s.status === "done")
      ? state.theme.name
      : null;
  return {
    step: { label: builtLine(), status: "done" },
    card: dashboard
      ? {
          kind: "dashboard",
          title: dashboard.name,
          // A dashboard the user had: what was added, not its size.
          sub: dashboard.targeted
            ? [
                "Dashboard · changed",
                placed ? `${placed} added` : null,
                themed ? `${themed} theme` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : `Dashboard · built · ${plural(placed, "widget")}`,
        }
      : null,
    reply: [
      dashboard
        ? dashboard.targeted
          ? themed && !placed
            ? `${dashboard.name} is changed — it has the ${themed} theme now.`
            : `${dashboard.name} is changed.`
          : `Your ${dashboard.name} dashboard is ready.`
        : "It's built.",
      checked.length
        ? ` The Checker passed ${
            checked.length === checks.length
              ? checked.length === 1
                ? "the new widget"
                : `all ${checked.length} new widgets`
              : plural(checked.length, "new widget")
          }.`
        : "",
      leftNote,
      waitNote,
      bots.length
        ? ` ${andList(bots.map((b) => b.name || "The bot"))} ${
            bots.length === 1 ? "starts" : "start"
          } paused — turn ${bots.length === 1 ? "it" : "them"} on below when you want ${
            bots.length === 1 ? "it" : "them"
          } to run on ${bots.length === 1 ? "its" : "their"} own.`
        : "",
    ].join(""),
    choices: dashboard ? "open" : null,
  };
}
