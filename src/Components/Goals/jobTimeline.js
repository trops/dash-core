/**
 * jobTimeline.js — a bot's job read top to bottom, like a pull request
 * (bot-checks PRD CHK-003, frame 4): who asked, each try the bot made, what
 * its checks said about it, what you did, where it is now, and where its
 * work goes next.
 *
 * A bot's job is a goal whose flow is `kind: "bot-checks"`
 * (electron/bots/botChecks.js): its first step `step_work` is the bot's own
 * run; the rest are its checks (Dash checks, reviewer bots, you).
 *
 * Pure: no React, no IPC.
 */

export const WORK_STEP = "step_work";

export const isBotJob = (goal) =>
  !!(goal && goal.flow && goal.flow.kind === "bot-checks");

/** The bot whose job it is: { id, name }. */
export function jobBot(goal) {
  const flow = (goal && goal.flow) || {};
  const work = (flow.steps || []).find((s) => s.id === WORK_STEP) || {};
  return {
    id:
      flow.botId ||
      work.botId ||
      (goal && goal.createdBy && goal.createdBy.botId) ||
      null,
    name:
      work.name ||
      (goal && goal.createdBy && goal.createdBy.botName) ||
      "The bot",
  };
}

/**
 * Who asked for the work: { kind: "lead"|"schedule"|"you"|"event"|"bot",
 * who, verb }.
 * @param {(id) => string|null} nameOf  a bot's name (the lead's)
 */
export function askedBy(goal, nameOf = () => null) {
  const src = (goal && goal.source) || {};
  const kind = src.kind;
  if (kind === "lead") {
    const name = (src.ref && nameOf(src.ref)) || "The lead";
    return { kind: "lead", who: name, verb: "asked" };
  }
  if (kind === "schedule") return { kind, who: "Its schedule", verb: "ran it" };
  if (kind === "event") return { kind, who: "An event", verb: "started it" };
  if (kind === "bot") {
    const name = (src.ref && nameOf(src.ref)) || src.label || "A bot";
    return { kind, who: name, verb: "asked" };
  }
  return { kind: "you", who: "You", verb: "asked" };
}

/** "you asked the lead", "its schedule", "an event" — the list's words. */
export function askedText(goal, nameOf = () => null) {
  const a = askedBy(goal, nameOf);
  if (a.kind === "lead") return "the lead asked";
  if (a.kind === "schedule") return "its schedule";
  if (a.kind === "event") return "an event";
  if (a.kind === "bot") return `${a.who} asked`;
  return "you asked";
}

/** What it hands on: the whole answer, or its first paragraph. */
export function handedOnText(answer, handsOn = "answer") {
  const text = String(answer == null ? "" : answer).trim();
  if (handsOn !== "summary") return text;
  return text.split(/\n\s*\n/)[0].trim();
}

const answerOf = (record) =>
  record && record.output && typeof record.output === "object"
    ? record.output.answer
    : null;

// A run's times are ISO strings; a record's are numbers.
const msOf = (v) => (typeof v === "number" ? v : Date.parse(v));

/** How long the run a try came from took (by its time), or null. */
function tryMs(record, runs, botId) {
  let best = null;
  let bestGap = Infinity;
  for (const r of runs || []) {
    if (!r || !r.endedAt || (r.checks && r.checks.state === "review")) continue;
    // Only the bot's own runs (a reviewer's are the job's too).
    if (botId && r.botId && String(r.botId) !== String(botId)) continue;
    const gap = msOf(record.at) - msOf(r.endedAt);
    if (!isFinite(gap) || gap < -5000 || gap > 120000) continue;
    if (Math.abs(gap) < bestGap) {
      best = r;
      bestGap = Math.abs(gap);
    }
  }
  if (!best) return null;
  const ms = msOf(best.endedAt) - msOf(best.startedAt);
  return isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * The job's rows, top to bottom:
 *   asked    { who, kind, text, at }
 *   try      { n, at, ms, answer }
 *   passed   { names: [{ name, reviewer?, said? }] }  checks that passed
 *   failed   { name, reason, reviewer, then: "back"|"you"|"stop"|null }
 *   you      { action, reason, at }                    your move
 *   came     { reason, at }                            it came to you
 *   now      { state: "working"|"checking"|"waiting"|"needs-you"|"done"|
 *              "closed", since, work, round }
 *
 * @param {object} goal  a bot's job (useGoal: with tasks and runs)
 */
export function jobTimeline(goal, { nameOf = () => null } = {}) {
  if (!isBotJob(goal)) return [];
  const flow = goal.flow;
  const task = (goal.tasks || [])[0] || null;
  const history = (task && task.history) || [];
  const steps = new Map((flow.steps || []).map((s) => [s.id, s]));
  const bot = jobBot(goal);
  const asked = askedBy(goal, nameOf);
  const rows = [
    {
      type: "asked",
      who: asked.who,
      kind: asked.kind,
      text: goal.body || "",
      at: goal.createdAt,
    },
  ];
  let tries = 0;
  let passed = [];
  const flush = () => {
    if (passed.length) rows.push({ type: "passed", names: passed });
    passed = [];
  };
  history.forEach((r, i) => {
    // "It stops": Dash closes the job right after the fail — not a move of
    // yours (checkJobs closes it through the same user move).
    const prev = history[i - 1];
    if (
      r.by === "you" &&
      r.status === "close" &&
      (r.dash ||
        (flow.onFail === "stop" &&
          prev &&
          prev.status === "failed" &&
          prev.to === "needs-you"))
    ) {
      return;
    }
    if (r.by === "you") {
      flush();
      rows.push({
        type: "you",
        action: r.status,
        reason: r.summary || "",
        at: r.at,
      });
      return;
    }
    if (r.stepId === WORK_STEP) {
      flush();
      tries += 1;
      rows.push({
        type: "try",
        n: tries,
        at: r.at,
        ms: tryMs(r, goal.runs, bot.id),
        answer: answerOf(r),
      });
      return;
    }
    const step = steps.get(r.stepId) || {};
    const reviewer = step.kind === "bot";
    const name = step.name || (reviewer ? r.botName : null) || "A check";
    if (r.status === "passed") {
      passed.push({
        name,
        ...(reviewer
          ? { reviewer: r.botName || "a reviewer", said: r.summary || "" }
          : {}),
      });
      return;
    }
    flush();
    if (r.status === "failed") {
      // Where the fail sent the work, from the record itself: back to the
      // bot, to you ("It comes to you"), or nowhere: out of tries, or "It
      // fails" — the job failed (DASH-12).
      // It failed when Dash closed it right after (or "It stops", before
      // that was marked); otherwise it came to you.
      const next = history[i + 1];
      const failedHere =
        !!(next && next.status === "close" && next.dash) ||
        (flow.onFail === "stop" && !!next && next.status === "close");
      const then =
        r.to === "needs-you" ? (failedHere ? "stop" : "you") : "back";
      rows.push({
        type: "failed",
        name,
        reason: r.summary || "",
        reviewer: reviewer ? r.botName || "a reviewer" : null,
        then,
        at: r.at,
      });
      return;
    }
    // Dash couldn't go on (no record, out of tries): it came to you.
    rows.push({ type: "came", reason: r.summary || "", at: r.at });
  });
  flush();

  const last = history[history.length - 1] || null;
  const lastTry = [...history].reverse().find((r) => r.stepId === WORK_STEP);
  const work = handedOnText(answerOf(lastTry), flow.handsOn);
  const status = task ? task.status : null;
  const since = last ? last.at : goal.createdAt;
  let state;
  if (goal.closed || status === "closed") state = "closed";
  else if (status === "done") state = "done";
  else if (status === "ready") state = "waiting";
  else if (status === "needs-you") state = "needs-you";
  else if (task && task.stepId === WORK_STEP && tries > 0) state = "working";
  else state = "checking";
  rows.push({
    type: "now",
    state,
    since,
    work,
    round: (task && task.round) || 1,
    maxRounds: (task && task.maxRounds) || flow.maxRounds || 3,
    bot: bot.name,
    approved: history.some((r) => r.by === "you" && r.status === "done"),
    // It came to you because a check failed (not, say, a missing record).
    failed: !!(last && last.status === "failed"),
    // Closed by Dash because it failed (out of tries, or "It fails"), not
    // by you; either way its Failed event went out.
    failedOut: state === "closed" && dashClosed(history),
    // Its close sent its Failed event (any close since DASH-12).
    failedSent: state === "closed" && closedFailed(history),
    tries,
  });
  return rows;
}

/** "48s", "2m 5s", "1h 3m". */
/** The job's close, newest. */
const closeOf = (history) =>
  [...history].reverse().find((r) => r && r.status === "close") || null;

/** Dash closed the job because it failed (not your Close). */
function dashClosed(history) {
  const c = closeOf(history);
  return !!(c && c.dash);
}

/** Its close sent its Failed event (marked since DASH-12). */
function closedFailed(history) {
  const c = closeOf(history);
  return !!(c && c.failed);
}

export function durationText(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * The last row: where its work goes. `targets`: checksView.handsOnTargets
 * ({ type: "bot"|"widget", name }).
 */
export function nextText(goal, state, targets = [], nameOf = () => null) {
  const bots = targets.filter((t) => t.type === "bot").map((t) => t.name);
  const widgets = targets.filter((t) => t.type === "widget").map((t) => t.name);
  const lead = askedBy(goal, nameOf).kind === "lead";
  const done = state === "done";
  const parts = [
    ...bots.map((n) => (done ? `${n} got it` : `${n} gets it`)),
    ...widgets.map((n) => (done ? `${n} shows it` : `${n} shows it`)),
    ...(lead ? [done ? "the lead was told" : "the lead tells you"] : []),
  ];
  if (!parts.length) {
    return done
      ? "Passed. Nothing after it: the checks only proved its own work."
      : "Nothing after it: the checks only prove its own work.";
  }
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return done ? `Handed on: ${list}.` : `Next: ${list}.`;
}

/**
 * The event a finished job sent, and who listens for it (DASH-12): "Writer's
 * Failed event went out → Fixer runs on it", or "… · nothing listens for it
 * yet" — shown either way, so you know it's there.
 */
export function eventText(botName, event, targets = []) {
  const label = event === "failed" ? "Failed" : "Completed";
  const head = `${botName}'s ${label} event went out`;
  const parts = [
    ...targets
      .filter((t) => t.type === "bot")
      .map((t) => `${t.name} runs on it`),
    ...targets
      .filter((t) => t.type === "widget")
      .map((t) => `${t.name} shows it`),
  ];
  if (!parts.length) return `${head} · nothing listens for it yet`;
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${head} → ${list}`;
}

/**
 * The list's line for a bot's job: "Coordinator · the lead asked ·
 * waiting for you".
 */
export function jobLine(goal, nameOf = () => null) {
  const bot = jobBot(goal);
  const rows = jobTimeline(goal, { nameOf });
  const now = rows[rows.length - 1] || {};
  const tries = rows.filter((r) => r.type === "try").length;
  const state = {
    waiting: "waiting for you",
    "needs-you": now.failed
      ? `didn't pass on try ${Math.max(1, tries)}`
      : "came to you",
    done: tries > 1 ? `passed on try ${tries}` : "passed first try",
    closed: now.failedOut ? `failed on try ${Math.max(1, tries)}` : "closed",
    working: `trying again (try ${tries + 1})`,
    checking: tries > 1 ? `checking try ${tries}` : "checking",
  }[now.state];
  return [bot.name, askedText(goal, nameOf), state].filter(Boolean).join(" · ");
}

/**
 * Each check's result in order, with the try it was on — the lead
 * conversation's card (frame 3): { name, status, tryN, reason }.
 */
export function checkResults(goal) {
  if (!isBotJob(goal)) return [];
  const steps = new Map((goal.flow.steps || []).map((s) => [s.id, s]));
  const task = (goal.tasks || [])[0] || null;
  let tryN = 0;
  const out = [];
  for (const r of (task && task.history) || []) {
    if (r.stepId === WORK_STEP) {
      tryN += 1;
      continue;
    }
    if (r.by === "you") continue;
    if (r.status !== "passed" && r.status !== "failed") continue;
    const step = steps.get(r.stepId) || {};
    out.push({
      name: step.name || r.botName || "A check",
      status: r.status,
      tryN: Math.max(1, tryN),
      reason: r.status === "failed" ? r.summary || "" : "",
    });
  }
  return out;
}

/** Where a job is now, in a few words for the lead conversation's card. */
export function jobStateText(goal) {
  const rows = jobTimeline(goal);
  const now = rows[rows.length - 1];
  if (!now) return "";
  const tries = rows.filter((r) => r.type === "try").length;
  return {
    waiting: "Its work is waiting for you to approve it",
    "needs-you": now.failed
      ? `It didn't pass on try ${Math.max(1, tries)}: it's waiting for you`
      : "It came to you",
    done: now.approved ? "Approved and handed on" : "Passed and handed on",
    closed: now.failedOut
      ? `It failed on try ${Math.max(1, tries)}: nothing was handed on`
      : "Closed: nothing was handed on",
    working: `${now.bot} is trying again (try ${tries + 1})`,
    checking: "Being checked…",
  }[now.state];
}

/**
 * What a bot's checks did with one of its runs, for its Activity (DASH-13):
 * { state (a StatusBadge state), text } from the run's `checks` mark and
 * its job (when it's still there), or null for a run that wasn't held.
 * `tryN`: which of the job's tries this run was — an earlier try says what
 * failed on it ("Try 1 · didn't pass …: sent back").
 */
export function runChecksLine(run, goal = null, tryN = null) {
  const c = run && run.checks;
  if (!c || !c.state) return null;
  const held = "Held for its checks";
  if (c.state === "review") {
    return {
      state: "neutral",
      text: "Reviewed another bot's work, for its checks",
    };
  }
  const rows = goal && isBotJob(goal) ? jobTimeline(goal) : [];
  const now = rows[rows.length - 1] || {};
  // An earlier try: the job went on without it.
  if (tryN && now.tries && tryN < now.tries) {
    let at = 0;
    let failed = null;
    for (const r of rows) {
      if (r.type === "try") at = r.n;
      else if (r.type === "failed" && at === tryN && !failed) failed = r;
    }
    return {
      state: "neutral",
      text: failed
        ? `Try ${tryN} · didn't pass "${failed.name}": sent back`
        : `Try ${tryN} · a later try replaced this answer`,
    };
  }
  if (c.state === "checking") {
    if (now.state === "waiting") {
      return {
        state: "warning",
        text: `${held} · waiting for you to approve it`,
      };
    }
    if (now.state === "needs-you") {
      return { state: "warning", text: `${held} · it came to you` };
    }
    if (now.state === "working") {
      return { state: "info", text: `${held} · sent back: trying again` };
    }
    return { state: "info", text: `${held} · being checked` };
  }
  if (c.state === "replaced") {
    return {
      state: "neutral",
      text: `${held} · a later try replaced this answer`,
    };
  }
  if (c.state === "passed") {
    return {
      state: "success",
      text: now.approved
        ? `${held} · passed, then you approved it: handed on`
        : `${held} · passed: handed on`,
    };
  }
  // Stopped: it failed (its Failed event went out), or it was closed.
  if (now.failedOut || now.failedSent) {
    const fails = rows.filter((r) => r.type === "failed");
    const last = fails[fails.length - 1];
    const why = last
      ? `didn't pass "${last.name}" on try ${Math.max(1, now.tries)}: `
      : "";
    return {
      state: "error",
      text: `${held} · ${why}it failed, nothing was handed on`,
    };
  }
  return { state: "neutral", text: `${held} · closed: nothing was handed on` };
}
