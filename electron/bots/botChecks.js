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

const CHECKS_FLOW_KIND = "bot-checks";
const ON_FAIL = ["retry", "you", "stop"];
const HANDS_ON = ["answer", "summary", "files"];
const STEP_KINDS = ["check", "reviewer", "you"];
const MAX_CHECK_STEPS = 10;
const WORK_STEP = "step_work";
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
    if (s.held === true && check.kind === "command") step.held = true;
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
      while (ids.has(id) || id === WORK_STEP) id = `${step.id}${n++}`;
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
    if (s.kind === "reviewer" && !s.botId) {
      return "a reviewer check needs the bot that reviews";
    }
    if (s.kind === "reviewer" && selfId && String(s.botId) === String(selfId)) {
      return "a bot can't review its own work";
    }
  }
  if (input.onFail !== undefined && !ON_FAIL.includes(input.onFail)) {
    return `checks.onFail must be one of ${ON_FAIL.join(", ")}`;
  }
  if (input.handsOn !== undefined && !HANDS_ON.includes(input.handsOn)) {
    return `checks.handsOn must be one of ${HANDS_ON.join(", ")}`;
  }
  return null;
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
function checksFlow(bot) {
  const checks = checksOf(bot);
  if (!checks) return null;
  const steps = [
    {
      id: WORK_STEP,
      kind: "bot",
      name: bot.name || "The bot",
      botId: bot.id,
    },
  ];
  for (const c of checks.steps) {
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
  const edges = [];
  for (let i = 1; i < steps.length; i++) {
    edges.push({ from: steps[i - 1].id, to: steps[i].id, kind: "next" });
    if (checks.onFail === "retry" && steps[i].kind !== "you") {
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
function workOutput(answer) {
  return { answer: String(answer == null ? "" : answer) };
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
  if (input && input.fix) {
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
  HELD_NOTE,
  cleanBotChecks,
  checksError,
  checksOf,
  checksFlow,
  isChecksFlow,
  jobTitle,
  jobSource,
  workOutput,
  passedWork,
  handedOn,
  retryPrompt,
};
