/**
 * botChecks.js
 *
 * A bot's own checks (bot-checks PRD, DASH-9): they prove its work is done,
 * every time it runs — on its schedule, when its lead asks, when you ask.
 * Its finished work is held while they run, top to bottom:
 *
 *   a check     Dash runs it (rules, a command, a script, a read-only tool)
 *   a reviewer  another bot judges the work and says why
 *   you         it waits for you to approve it or send it back
 *
 * A fail goes back to the bot with what failed (up to its tries, then to
 * you), or straight to you, or stops it. Only work that passed is handed
 * on: its next bots run, its widgets show it, its lead gets the answer.
 *
 * Each held run is a job on the dashboard's ledger, following a small flow
 * made from the checks — so the flow runner does the rounds, the records,
 * Approve and Send back, as it does for any flow.
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const {
  normalizeFlow,
  CHECK_KINDS,
  clampRounds,
} = require("../flows/flowModel");
const { repoCheckError } = require("../checks/kinds/repo");
const { factoryCheckError } = require("../checks/kinds/factory");
const { packageCheckError } = require("../checks/kinds/package");
const { recipeCheckError } = require("../checks/kinds/recipe");
const { helperCheckError } = require("../checks/kinds/helper");
// What a check that came with a package would run (DASH-125).
const { offCommandOf } = require("../../src/utils/offCommands");

const CHECKS_FLOW_KIND = "bot-checks";
const ON_FAIL = ["retry", "you", "stop"];
// What a passed job hands on: its whole answer, or its first paragraph.
// ("files" was accepted but did nothing; DASH-101 took it out, and a bot
// saved with it hands on its answer.)
const HANDS_ON = ["answer", "summary"];
const STEP_KINDS = ["check", "reviewer", "you"];
const MAX_CHECK_STEPS = 10;
const WORK_STEP = "step_work";
// The built-in Handoff check (DASH-101), first after the work.
const HANDOFF_STEP = "step_handoff";
const MAX_TITLE = 120;
const HELD_NOTE =
  "This command came with a package and is off, so Dash didn't run it. Approve the work yourself, or turn the check on in the bot's checks.";

const str = (v, max = 400) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** One of a bot's checks, cleaned; null when it can't be used. */
function cleanCheckStep(s, i) {
  if (!s || typeof s !== "object" || !STEP_KINDS.includes(s.kind)) return null;
  const id = /^step_[a-z0-9]{1,40}$/.test(s.id || "") ? s.id : `step_c${i + 1}`;
  const name =
    str(s.name, 80) ||
    (s.kind === "you"
      ? "You approve"
      : s.kind === "reviewer"
        ? "Reviewer"
        : `Check ${i + 1}`);
  const step = { id, kind: s.kind, name };
  // Only when a team setting says so (DASH-85), e.g. "{approvePlans}".
  const when = str(s.when, 200);
  if (when) step.when = when;
  const note = str(s.note, 300);
  if (note) step.note = note;
  if (s.kind === "check") {
    const check = s.check && typeof s.check === "object" ? s.check : null;
    if (!check || !CHECK_KINDS.includes(check.kind)) return null;
    try {
      step.check = JSON.parse(JSON.stringify(check));
    } catch (_e) {
      return null;
    }
    // A command that came with a package stays off until you turn it on
    // (DASH-57): nothing it says runs on this computer before then.
    // So does a repo check (DASH-102): it runs the repo's own code.
    if (s.held === true && ["command", "repo", "package"].includes(check.kind))
      step.held = true;
  }
  if (s.kind === "reviewer") {
    // A reviewer with no bot could never answer: left out.
    if (!s.botId) return null;
    step.botId = String(s.botId);
  }
  return step;
}

/**
 * A bot's checks as saved: `{ steps, onFail, maxTries, handsOn }`, or null
 * when it has none (its work goes straight on, as before).
 */
function cleanBotChecks(input) {
  if (!input || typeof input !== "object") return null;
  const steps = [];
  const ids = new Set();
  (Array.isArray(input.steps) ? input.steps : [])
    .slice(0, MAX_CHECK_STEPS)
    .forEach((s, i) => {
      const step = cleanCheckStep(s, i);
      if (!step) return;
      let id = step.id;
      let n = 1;
      while (ids.has(id) || id === WORK_STEP || id === HANDOFF_STEP)
        id = `${step.id}${n++}`;
      step.id = id;
      ids.add(id);
      steps.push(step);
    });
  if (!steps.length) return null;
  return {
    steps,
    onFail: ON_FAIL.includes(input.onFail) ? input.onFail : "retry",
    maxTries: clampRounds(input.maxTries),
    handsOn: HANDS_ON.includes(input.handsOn) ? input.handsOn : "answer",
  };
}

/**
 * What's wrong with a bot's checks as given, or null (botSchema).
 * @param {object} input
 * @param {string|null} [selfId]  the bot's own id: it can't review itself
 */
function checksError(input, selfId = null) {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    return "checks must be an object";
  }
  if (input.steps !== undefined && !Array.isArray(input.steps)) {
    return "checks.steps must be an array";
  }
  const list = Array.isArray(input.steps) ? input.steps : [];
  if (list.length > MAX_CHECK_STEPS) {
    return `a bot can have at most ${MAX_CHECK_STEPS} checks`;
  }
  for (const s of list) {
    if (!s || !STEP_KINDS.includes(s.kind)) {
      return `each check's kind must be one of ${STEP_KINDS.join(", ")}`;
    }
    if (
      s.kind === "check" &&
      !(s.check && CHECK_KINDS.includes(s.check.kind))
    ) {
      return `a check needs settings of a known kind (${CHECK_KINDS.join(", ")})`;
    }
    if (s.kind === "check" && s.check.kind === "repo") {
      const bad = repoCheckError(s.check);
      if (bad) return bad;
    }
    if (s.kind === "check") {
      const bad =
        factoryCheckError(s.check) ||
        (s.check.kind === "package" ? packageCheckError(s.check) : null) ||
        // A recipe is checked with dash-check's validateRecipe (DASH-133).
        (s.check.kind === "recipe" ? recipeCheckError(s.check) : null) ||
        // One dash-check helper (DASH-160).
        (s.check.kind === "helper" ? helperCheckError(s.check) : null);
      if (bad) return bad;
    }
    if (s.kind === "reviewer" && !s.botId) {
      return "a reviewer check needs the bot that reviews";
    }
    if (s.kind === "reviewer" && selfId && String(s.botId) === String(selfId)) {
      return "a bot can't review its own work";
    }
    if (s.when !== undefined && typeof s.when !== "string") {
      return 'a check\'s when must be text, like "{approvePlans}"';
    }
  }
  if (input.onFail !== undefined && !ON_FAIL.includes(input.onFail)) {
    return `checks.onFail must be one of ${ON_FAIL.join(", ")}`;
  }
  if (
    input.handsOn !== undefined &&
    // Taken out (DASH-101), still accepted so an app that sends it isn't
    // refused: it's saved as "answer".
    input.handsOn !== "files" &&
    !HANDS_ON.includes(input.handsOn)
  ) {
    return `checks.handsOn must be one of ${HANDS_ON.join(", ")}`;
  }
  return null;
}

const OFF_WORDS = ["", "no", "false", "off", "0"];

/**
 * Whether a step is left out (DASH-85): its `when`, filled in with the
 * team's settings, reads no ("no", "false", "off", "0" or empty). A
 * `when` still unfilled (e.g. "{approvePlans}") counts as on: when in
 * doubt, the step runs.
 */
function stepOff(step) {
  if (!step || typeof step.when !== "string") return false;
  return OFF_WORDS.includes(step.when.trim().toLowerCase());
}

/** The bot's checks, or null when its work goes straight on. */
function checksOf(bot) {
  return bot ? cleanBotChecks(bot.checks) : null;
}

/** A flow a job follows: made from a bot's checks. */
function isChecksFlow(flow) {
  return !!flow && flow.kind === CHECKS_FLOW_KIND;
}

/**
 * The flow a bot's job follows: its work, then each check in order. A
 * check that fails sends the work back to the bot ("retry"), or to you;
 * a you step sends it back to the bot. Null when the bot has no checks.
 */
function checksFlow(bot, { handoff = false, tables = [] } = {}) {
  if (!bot) return null;
  const own = checksOf(bot);
  if (!own && !handoff) return null;
  // A team that uses handoffs (DASH-101): a bot with no checks of its own
  // still has its handoff checked.
  const checks = own || {
    steps: [],
    onFail: "retry",
    maxTries: clampRounds(undefined),
    handsOn: "answer",
  };
  const steps = [
    {
      id: WORK_STEP,
      kind: "bot",
      name: bot.name || "The bot",
      botId: bot.id,
    },
  ];
  if (handoff) {
    steps.push({
      id: HANDOFF_STEP,
      kind: "check",
      name: "Handoff",
      note: "Dash checks the answer's handoff: it parses, its status is known, its work item is the job's, and its workspace is inside the bot's folders.",
      check: {
        kind: "handoff",
        folders: (Array.isArray(bot.projects) ? bot.projects : []).filter(
          (f) => typeof f === "string",
        ),
        tables: (Array.isArray(tables) ? tables : []).filter(
          (t) => typeof t === "string",
        ),
      },
    });
  }
  for (const c of checks.steps) {
    // Its `when` reads no once the team's settings are filled in (DASH-85):
    // this job leaves it out.
    if (stepOff(c)) continue;
    if (c.kind === "check" && c.held) {
      // Off until you turn it on: you look at the work in its place.
      steps.push({
        id: c.id,
        kind: "you",
        name: `${c.name} (off)`,
        note: HELD_NOTE,
        mode: "approve",
        action: "Approve",
        sendBackTo: WORK_STEP,
        // What's off (DASH-125): the job says "Turn on npm test".
        ...(offCommandOf(c) ? { offCommand: offCommandOf(c) } : {}),
      });
    } else if (c.kind === "check") {
      steps.push({
        id: c.id,
        kind: "check",
        name: c.name,
        note: c.note,
        check: c.check,
      });
    } else if (c.kind === "reviewer") {
      // A bot never reviews its own work.
      if (c.botId === bot.id) continue;
      steps.push({
        id: c.id,
        kind: "bot",
        name: c.name,
        note: c.note,
        botId: c.botId,
        judgment: true,
      });
    } else {
      steps.push({
        id: c.id,
        kind: "you",
        name: c.name,
        note: c.note,
        mode: "approve",
        action: "Approve",
        sendBackTo: WORK_STEP,
      });
    }
  }
  // Every check left out for this run: its work goes straight on.
  if (steps.length === 1) return null;
  const edges = [];
  for (let i = 1; i < steps.length; i++) {
    edges.push({ from: steps[i - 1].id, to: steps[i].id, kind: "next" });
    // A handoff that's wrong always goes back to the bot with what's wrong.
    if (
      steps[i].id === HANDOFF_STEP ||
      (checks.onFail === "retry" && steps[i].kind !== "you")
    ) {
      edges.push({ from: steps[i].id, to: WORK_STEP, kind: "fail" });
    }
  }
  const flow = normalizeFlow({
    id: `checks_${bot.id}`,
    workspaceId: bot.workspaceId,
    name: `${bot.name || "The bot"}'s checks`,
    maxRounds: checks.maxTries,
    steps,
    edges,
  });
  return {
    ...flow,
    kind: CHECKS_FLOW_KIND,
    botId: bot.id,
    onFail: checks.onFail,
    handsOn: checks.handsOn,
  };
}

/** A job's title: the bot and what it was asked, in a line. */
function jobTitle(bot, { prompt = "", trigger = "" } = {}) {
  const line = String(prompt || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  const what =
    line ||
    (trigger === "schedule" || trigger === "catch-up"
      ? "its scheduled run"
      : "its run");
  const title = `${(bot && bot.name) || "A bot"}: ${what}`;
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;
}

/** Where a job came from, for the ledger's `source`. */
function jobSource({ trigger = "", via = "" } = {}) {
  const v = String(via || "");
  if (v.startsWith("lead:")) return { kind: "lead", ref: v.slice(5) };
  if (trigger === "schedule" || trigger === "catch-up") {
    return { kind: "schedule" };
  }
  if (trigger === "event") return { kind: "event" };
  return { kind: trigger ? String(trigger).slice(0, 40) : "bot" };
}

/** The work's record: the run's answer, as the checks read it. */
function workOutput(answer, refusals = null) {
  return {
    answer: String(answer == null ? "" : answer),
    // What Dash refused in the run (DASH-115), for the Handoff check.
    ...(Array.isArray(refusals) && refusals.length ? { refusals } : {}),
  };
}

/** The latest work that passed on a job's task: its answer text. */
function passedWork(task) {
  const history = (task && task.history) || [];
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    if (r && r.stepId === WORK_STEP && r.status === "passed") {
      const out = r.output;
      if (out && typeof out === "object" && typeof out.answer === "string") {
        return out.answer;
      }
      return typeof out === "string" ? out : "";
    }
  }
  return "";
}

/** What a passed job hands on (`handsOn`): its whole answer or a summary. */
function handedOn(flow, answer) {
  const text = String(answer || "");
  if (flow && flow.handsOn === "summary") {
    const first = text.split(/\n\s*\n/)[0] || "";
    return first.trim();
  }
  return text;
}

/**
 * What the bot is told when its work comes back: what it was asked, what
 * it answered last time, and what failed. Dash records its answer, so the
 * bot doesn't claim the task or write a done record itself.
 */
function retryPrompt({ goal, task, input }) {
  const lines = [
    `Your work goes through your checks before it's handed on. It came back: try ${task.round || 1} of ${task.maxRounds || 3}.`,
  ];
  if (goal.body) lines.push("", "What you were asked:", goal.body);
  const last = passedWork(task);
  if (last) {
    lines.push(
      "",
      "Your last answer:",
      last.length > 8000 ? `${last.slice(0, 8000)}\n… (cut)` : last,
    );
  }
  // It asked a person in its handoff (DASH-101), and they answered.
  const history = (task && task.history) || [];
  const move = history[history.length - 1];
  const asked =
    move && move.by === "you" && move.status === "answer"
      ? [...history].reverse().find((r) => r && r.ask)
      : null;
  if (asked) {
    lines.push(
      "",
      `You asked: ${asked.ask}`,
      `The user answered: ${move.summary}`,
      "",
      "Go on with the work using that answer, then answer again in full, ending with your handoff.",
    );
  } else if (input && input.fix) {
    lines.push(
      "",
      input.fix.byYou
        ? `The user sent it back: ${input.fix.reason}`
        : `"${input.fix.step}" failed: ${input.fix.reason}`,
    );
    if (input.fix.details != null) {
      let details = "";
      try {
        details = JSON.stringify(input.fix.details);
      } catch (_e) {
        details = "";
      }
      if (details) lines.push(`Details: ${details.slice(0, 4000)}`);
    }
    lines.push("Fix that, then answer again in full.");
  } else {
    lines.push("", "Answer again in full.");
  }
  return lines.join("\n");
}

module.exports = {
  CHECKS_FLOW_KIND,
  ON_FAIL,
  HANDS_ON,
  STEP_KINDS,
  MAX_CHECK_STEPS,
  WORK_STEP,
  HANDOFF_STEP,
  HELD_NOTE,
  cleanBotChecks,
  checksError,
  checksOf,
  checksFlow,
  stepOff,
  isChecksFlow,
  jobTitle,
  jobSource,
  workOutput,
  passedWork,
  handedOn,
  retryPrompt,
};
