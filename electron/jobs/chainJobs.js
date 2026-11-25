/**
 * chainJobs.js — a chain that starts from one of a team's bots is a job
 * (DASH-70).
 *
 * Jobs used to start only from a team lead's own run. A team like the Code
 * Factory starts from a scheduled Ticket Bot, so each bot's run showed on
 * its own. Now the first run of a chain (a bot whose completed or failed
 * starts another bot on its team) opens the job, and every hand-on, check
 * and retry after it joins.
 *
 * Pure: no Electron.
 */
"use strict";

const { botEventType } = require("../bots/botEvents");

/**
 * Does a run of this bot start a chain? Another bot on its team is started
 * by its completed or failed.
 */
function startsChain(store, bot) {
  if (!bot || !bot.id || bot.workspaceId == null) return false;
  if (!store || typeof store.list !== "function") return false;
  const ws = String(bot.workspaceId);
  const types = new Set([
    botEventType(bot, "completed"),
    botEventType(bot, "failed"),
  ]);
  return store
    .list()
    .some(
      (o) =>
        o &&
        o.id !== bot.id &&
        o.workspaceId != null &&
        String(o.workspaceId) === ws &&
        (o.subscriptions || []).some((s) => s && types.has(s.eventType)),
    );
}

/**
 * Who started a chain's job: its schedule, a trigger, or `asked` (who ran
 * it by hand: you, MCP, a task).
 */
function chainStartedBy(bot, opts = {}, asked = { kind: "you" }) {
  const name = (bot && bot.name) || "";
  const t = opts.trigger;
  if (t === "schedule" || t === "catch-up") {
    return { kind: "schedule", label: name };
  }
  if (t === "event") return { kind: "trigger", label: name };
  return { ...asked, label: asked.label || name };
}

module.exports = { startsChain, chainStartedBy };
