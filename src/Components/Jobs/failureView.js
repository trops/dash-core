/**
 * failureView.js — where a job failed, why in plain words, and the one
 * button that fixes it (DASH-122). Pure: no React, no IPC.
 *
 *   failureView(job, { goal })  → null, or
 *     { verb, stepId, botId, botName, kind, reason, detail, lines,
 *       action, rerun, output }
 *
 *   verb     "Failed" | "Waiting" | "Stopped" — "Failed at Coder: …"
 *   kind     what kind of failure, which picks the button:
 *              blocked      its setup refused a command or tool (DASH-115)
 *              setting      a setting it uses has no value
 *              login        the AI it runs on isn't signed in (DASH-114)
 *              provider     a provider it uses isn't working
 *              setup        another setup problem (a repo, …)
 *              command-off  a check's command came with a package and is
 *                           off, so the step waits for you
 *              budget       it's over its budget
 *              checks       its checks still fail, out of tries
 *              other        anything else
 *   reason   the plain reason after "Failed at <bot>: "
 *   detail   one line more: the failing check's reason, the fix
 *   lines    more setup problems (Check setup lists them all)
 *   action   the button: { type, label, botId?, section?, check? }
 *              type: "settings" (that bot's Settings tab, at `section`),
 *              "check-setup", "turn-on" (the bot's checks), "budget" (its
 *              Spending tab), "rerun"
 *   rerun    the step can be run again (Run again from / Send back to)
 *   output   the failing check's printed output: { name, output, exitCode }
 */
import { jobTimeline, WORK_STEP } from "../Goals/jobTimeline";
import { refusalSectionText } from "./jobText";

// The step a preflight failure is recorded on (botController).
export const SETUP_STEP = "Setup check";

const LOGIN_RE =
  /not logged in|isn't logged in|log ?in again|login (?:has )?expired|reached its time limit|authentication (?:failed|error)|unauthori[sz]ed|invalid (?:x-)?api[ -]?key|no api key|refused the sign-in|\b401\b/i;
const BUDGET_RE =
  /over (?:its|the|your)(?: monthly)? budget|budget (?:is )?used up/i;
const NO_VALUE_RE =
  /setting(?:s)? (.+?) (?:has|have) no value|uses (.+?), which has no value/i;
const NO_ROWS_RE =
  /table (.+?) has no rows|uses the (.+?) table, which has no rows/i;
// A bot's own setting (DASH-136): "Workspace Bot: Work folder has no value".
const OWN_RE = /^(.+?): (.+?) has no (value|rows)\b/;

const str = (v) => (typeof v === "string" ? v.trim() : "");

/** "Work folder ({workFolder})" → "Work folder"; "{workFolder}" → "workFolder". */
export function settingLabel(text) {
  const t = str(text);
  const plain = t.replace(/\s*\(\{[^}]*\}\)\s*$/, "").trim();
  return (plain || t).replace(/^\{([^}]*)\}$/, "$1");
}

/** A summary's first sentence, plain: no Markdown marks, no list dash. */
export function plainReason(text, max = 200) {
  const t = str(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  const m = t.match(/^(.+?[.!?])(?:\s|$)/);
  const first = (m ? m[1] : t).replace(/[.]$/, "");
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** Lower-case its first letter, so it reads after "Failed at Coder: ". */
const lead = (s) =>
  s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;

/** One setup problem (preflight.js), as a failure. */
function setupProblem(p) {
  const msg = str(p && p.message);
  const kind = (p && p.kind) || "setup";
  const botName = (p && p.bot) || null;
  const botId = (p && p.botId) || null;
  if (kind === "setting") {
    const own = msg.match(OWN_RE);
    if (own) {
      const label = settingLabel(own[2]);
      return {
        kind: "setting",
        botName: botName || own[1],
        botId,
        reason:
          own[3] === "rows"
            ? `its ${label} table has no rows`
            : `its ${label} has no value`,
      };
    }
    const rows = msg.match(NO_ROWS_RE);
    const none = msg.match(NO_VALUE_RE);
    const label = settingLabel(
      (rows && (rows[1] || rows[2])) ||
        (none && (none[1] || none[2])) ||
        (p && p.setting) ||
        "a setting",
    );
    return {
      kind: "setting",
      botName,
      botId,
      reason: rows
        ? `its ${label} table has no rows`
        : `its ${label} has no value`,
    };
  }
  if (kind === "ai-login") {
    // "Coder runs on Claude Code, which isn't logged in: run `claude …`"
    const m = msg.match(/^(.+?) runs? on (.+?), which (.+?): (.*)$/);
    const d = msg.match(/^Your default AI, (.+?), (.+?): (.*)$/);
    const bots =
      (p && Array.isArray(p.bots) && p.bots) ||
      (p && p.bot ? String(p.bot).split(/, | and /) : []);
    return {
      kind: "login",
      botName: bots[0] || null,
      botId: null,
      reason: m
        ? `it runs on ${m[2]}, which ${m[3]}`
        : d
          ? `your default AI, ${d[1]}, ${d[2]}`
          : lead(plainReason(msg)),
      detail: m ? m[4] : d ? d[3] : "",
    };
  }
  if (kind === "provider") {
    const m = msg.match(/^(.+?)'s provider (.+?) isn't working/);
    return {
      kind: "provider",
      botName,
      botId,
      reason: m ? `its provider ${m[2]} isn't working` : lead(plainReason(msg)),
    };
  }
  return {
    kind: "setup",
    botName,
    botId,
    reason: lead(plainReason(msg)) || "its team's setup has a problem",
  };
}

/** Setup problems from an older step: its summary's "- …" lines. */
function problemsFromText(text) {
  const t = String(text || "");
  if (!/setup has \d+ problem/.test(t)) return [];
  return t
    .split(/\s+-\s+/)
    .slice(1)
    .map((m) => m.trim())
    .filter(Boolean)
    .map((message) => ({
      kind:
        NO_VALUE_RE.test(message) ||
        NO_ROWS_RE.test(message) ||
        OWN_RE.test(message)
          ? "setting"
          : /runs? on .+, which /.test(message) ||
              /^Your default AI/.test(message)
            ? "ai-login"
            : /'s provider .+ isn't working/.test(message)
              ? "provider"
              : "setup",
      bot: (message.match(/^(.+?)(?:'s provider| uses | runs? on |: )/) ||
        [])[1],
      message,
    }));
}

/** The step a job's failure (or its stop at you) is about, or null. */
export function failureStep(job) {
  const steps = (job && job.steps) || [];
  if (!job) return null;
  if (job.status === "failed") {
    return [...steps].reverse().find((s) => s.status === "failed") || null;
  }
  if (job.status === "needs-you") {
    return (
      steps.find((s) => s.status === "needs-you" && s.waiting === "budget") ||
      steps.find((s) => s.status === "needs-you" && s.goalId) ||
      null
    );
  }
  return null;
}

/** A goal that waits on a check that came with a package and is off. */
function heldCheck(goal) {
  if (!goal || !goal.flow) return null;
  const task = (goal.tasks || [])[0] || null;
  if (!task || task.stepId === WORK_STEP) return null;
  const step = (goal.flow.steps || []).find((s) => s.id === task.stepId);
  if (!step || step.kind !== "you") return null;
  const m = String(step.name || "").match(/^(.*) \(off\)$/);
  if (!m && !/came with a package and is off/.test(String(step.note || ""))) {
    return null;
  }
  return {
    name: (m ? m[1] : step.name) || "its check",
    // What it would run (DASH-125): "Turn on npm test".
    command: String(step.offCommand || ""),
  };
}

/** The checks that failed a step out: name, reason, tries, output. */
function checksOut(goal) {
  const rows = goal ? jobTimeline(goal) : [];
  const fails = rows.filter((r) => r.type === "failed");
  if (!fails.length) return null;
  const now = rows[rows.length - 1] || {};
  const last = fails[fails.length - 1];
  return {
    name: last.name,
    reviewer: last.reviewer,
    reason: last.reason,
    tries: Math.max(
      1,
      now.tries || rows.filter((r) => r.type === "try").length,
    ),
    output: last.output || null,
    exitCode: last.exitCode,
  };
}

const settingsAction = (botId, botName, section = null) =>
  botId
    ? {
        type: "settings",
        label: section
          ? `Open ${botName || "the bot"}'s ${refusalSectionText(section)}`
          : `Open ${botName || "the bot"}'s settings`,
        botId,
        ...(section ? { section } : {}),
      }
    : { type: "check-setup", label: "Check setup" };

/** The button for a kind of failure. */
function actionFor(kind, { botId, botName, section, check, command }) {
  if (kind === "blocked") return settingsAction(botId, botName, section);
  if (kind === "setting") return settingsAction(botId, botName);
  if (kind === "login" || kind === "provider" || kind === "setup") {
    return { type: "check-setup", label: "Check setup" };
  }
  if (kind === "command-off") {
    return {
      type: "turn-on",
      label: `Turn on ${command || check}`,
      botId,
      check,
      ...(command ? { command } : {}),
    };
  }
  if (kind === "budget") {
    return { type: "budget", label: "Raise budget", botId };
  }
  return { type: "rerun", label: `Run again from ${botName || "this step"}` };
}

/** A bot named in a job: its id from one of the job's steps. */
const botIdByName = (job, name) =>
  (((job && job.steps) || []).find((s) => s.botName === name) || {}).botId ||
  null;

/**
 * @param {object} job   a job (with its steps' summaries: useJob)
 * @param {{ goal?: object|null }} [opts]  the failed step's checks job
 */
export function failureView(job, { goal = null } = {}) {
  const step = failureStep(job);
  if (!step) return null;
  const base = {
    verb: "Failed",
    stepId: step.id,
    botId: step.botId || null,
    botName: step.botName || "a bot",
    detail: "",
    lines: [],
    output: null,
  };
  const summary = str(step.summary);
  const finish = (v) => {
    const kind = v.kind;
    const out = { ...base, ...v };
    out.action = actionFor(kind, {
      botId: out.botId,
      botName: out.botName,
      section: v.section,
      check: v.check,
      command: v.command,
    });
    // Run again from this step: a real bot's step of an ended job.
    out.rerun =
      job.status === "failed" &&
      step.botName !== SETUP_STEP &&
      !step.problems &&
      !!step.botId;
    return out;
  };

  // Waiting on you: over its budget, or a check that's off.
  if (job.status === "needs-you") {
    if (step.waiting === "budget") {
      return finish({
        verb: "Stopped",
        kind: "budget",
        reason: "it's over its monthly budget",
      });
    }
    const held = heldCheck(goal);
    if (!held) return null;
    const what =
      held.command && held.command !== held.name
        ? `its ${held.name} check (${held.command})`
        : `its ${held.name} check`;
    return finish({
      verb: "Waiting",
      kind: "command-off",
      reason: `${what} came with the package and is off`,
      detail:
        "Dash won't run it on this computer until you turn it on. Turn it on, or approve the work yourself.",
      check: held.name,
      command: held.command || null,
    });
  }

  // Its setup refused a command or tool (DASH-115): the refusal's reason.
  if (step.refusal) {
    const r = step.refusal;
    return finish({
      kind: "blocked",
      reason: `it can't ${r.kind === "command" ? "run" : "use"} \`${r.what}\`: ${r.why}`,
      detail: r.fix || "",
      section: r.section || null,
    });
  }

  // The team's setup, checked before the job started (DASH-108).
  const problems =
    (Array.isArray(step.problems) && step.problems.length && step.problems) ||
    (step.botName === SETUP_STEP || /setup has \d+ problem/.test(summary)
      ? problemsFromText(summary)
      : []);
  if (problems.length) {
    const all = problems.map((p) => setupProblem(p));
    const first = all[0];
    const botName = first.botName || null;
    const botId =
      first.botId || (botName ? botIdByName(job, botName) : null) || null;
    return finish({
      kind: first.kind,
      botName: botName || "its setup check",
      botId,
      reason:
        all.length > 1
          ? `${first.reason} (and ${all.length - 1} more)`
          : first.reason,
      detail: first.detail || "",
      lines: problems.map((p) => str(p.message)).filter(Boolean),
    });
  }

  // Its checks failed it out.
  const checks = checksOut(goal);
  if (checks || step.failed) {
    const c = checks || {};
    const what = c.reviewer
      ? `${c.reviewer} still doesn't pass its work`
      : `its ${c.name} check still fails`;
    const once = c.reviewer
      ? `${c.reviewer} didn't pass its work`
      : `its ${c.name} check failed`;
    const reason = checks
      ? c.tries > 1
        ? `${what} after ${c.tries} tries`
        : once
      : lead(plainReason(step.failed));
    return finish({
      kind: "checks",
      reason,
      detail: c.reason || "",
      output: c.output
        ? { name: c.name, output: c.output, exitCode: c.exitCode }
        : null,
    });
  }

  const text = str(step.failed) || summary;
  if (BUDGET_RE.test(text)) {
    return finish({ kind: "budget", reason: "it's over its monthly budget" });
  }
  if (LOGIN_RE.test(text)) {
    return finish({ kind: "login", reason: lead(plainReason(text)) });
  }
  const rows = text.match(NO_ROWS_RE);
  const none = text.match(NO_VALUE_RE);
  if (rows || none) {
    const label = settingLabel(
      (rows && (rows[1] || rows[2])) || (none && (none[1] || none[2])),
    );
    return finish({
      kind: "setting",
      reason: rows
        ? `its ${label} table has no rows`
        : `its ${label} has no value`,
    });
  }
  return finish({
    kind: "other",
    reason: lead(plainReason(text)) || "it failed",
  });
}

/** "Failed at Coder: its tests still fail after 2 tries". */
export function failureTitle(view) {
  if (!view) return "";
  return `${view.verb} at ${view.botName}: ${view.reason}`;
}
