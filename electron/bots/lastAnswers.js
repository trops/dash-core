/**
 * lastAnswers.js
 *
 * A bot's finished answers, for widgets that show them (team-dashboards
 * TD-009): the last one replays to a widget listening for the bot's
 * `completed` event when its dashboard opens, as a declared result does
 * (TD-002), and the Dash team reads the last few to see what the bot really
 * sends before it writes a widget's listener (`bot_answers`).
 *
 * Pure (NFR-006): the controller passes the store, whose getRuns decrypts.
 */
"use strict";

const { completedPayload, truncateText } = require("./botEvents");

/** How many answers bot_answers reads. */
const MAX_ANSWERS = 3;

/** `bot:<ref>[<botId>].completed` → { botId }, else null. */
function parseCompletedEventType(eventType) {
  const m = /^bot:.+\[(bot_[A-Za-z0-9_-]+)\]\.completed$/.exec(
    typeof eventType === "string" ? eventType : "",
  );
  return m ? { botId: m[1] } : null;
}

function runTime(run) {
  const iso = run && (run.endedAt || run.at || run.startedAt);
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

/** Runs that finished with an answer — the ones that publish `completed`. */
function finished(run) {
  if (!run || run.skipped) return false;
  if (["failed", "stopped", "interrupted"].includes(run.status)) return false;
  return typeof run.output === "string" && run.output.trim() !== "";
}

/**
 * A bot's last finished answers, newest first.
 * @returns {{ at: string, trigger: string|null, output: string }[]}
 */
function lastAnswers(runs, count = MAX_ANSWERS) {
  const n = Math.max(1, Math.min(MAX_ANSWERS, Number(count) || MAX_ANSWERS));
  return (Array.isArray(runs) ? runs : [])
    .filter(finished)
    .map((run) => ({ run, t: runTime(run) }))
    .filter((r) => r.t !== null)
    .sort((a, b) => b.t - a.t)
    .slice(0, n)
    .map(({ run, t }) => ({
      at: new Date(t).toISOString(),
      trigger: run.trigger || null,
      output: truncateText(run.output),
    }));
}

/**
 * The `completed` payload of a bot's last finished run, for a widget that
 * opens later — or null when the event type isn't one or there's no answer.
 */
function latestCompleted(store, eventType) {
  const parsed = parseCompletedEventType(eventType);
  if (!parsed) return null;
  const bot = store.get(parsed.botId);
  if (!bot) return null;
  const [last] = lastAnswers(store.getRuns(bot.id), 1);
  if (!last) return null;
  return {
    ...completedPayload(bot, { trigger: last.trigger, output: last.output }),
    at: last.at,
  };
}

/** bot_answers' text: each answer whole, newest first. */
function describeAnswers(botName, answers) {
  if (!answers.length) {
    return `${botName} hasn't finished a run with an answer yet, so there's nothing to read. Ask the user to run it once (Run it now) and try again — don't guess what it sends.`;
  }
  const blocks = answers.map(
    (a, i) =>
      `--- Answer ${i + 1} of ${answers.length} · ${a.at}${
        a.trigger ? ` · ${a.trigger}` : ""
      } ---\n${a.output}`,
  );
  return `${botName}'s last ${answers.length} answer${
    answers.length === 1 ? "" : "s"
  }, newest first, exactly as a widget receives them (the event's message.output; an answer over 8 KB arrives as its last 8 KB, starting "…[truncated]"):\n\n${blocks.join(
    "\n\n",
  )}`;
}

module.exports = {
  MAX_ANSWERS,
  parseCompletedEventType,
  lastAnswers,
  latestCompleted,
  describeAnswers,
};
