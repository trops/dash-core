/**
 * userRun.js — the run options for a run the user starts from the app
 * (botController.run: a chat message, a reply, Run now). Pure.
 */
"use strict";

const { isDashTeam } = require("./dashTeam");

/**
 * @param {object|null} bot
 * @param {{ prompt?: string, continueConversation?: boolean,
 *   planId?: string|null }} opts  planId only when the run is inside a plan
 *   the Dash team keeps memory for (the caller checks that)
 */
function userRunOptions(
  bot,
  { prompt, continueConversation = false, planId = null } = {},
) {
  return {
    prompt,
    trigger: continueConversation ? "reply" : "manual",
    continueSession: !!continueConversation,
    ...(planId ? { planId: String(planId) } : {}),
    // A Dash team role the user talks to answers only: building and placing
    // widgets happen in a plan build the user approved (_planAskRole),
    // never from a chat.
    ...(isDashTeam(bot) ? { adviseOnly: true } : {}),
  };
}

module.exports = { userRunOptions };
