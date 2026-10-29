/**
 * leadAsk.js — team_ask_bot's run (lead-workspace release 1): a dashboard
 * lead runs one of its own bots with the user's request and waits for the
 * answer. Pure: botController injects the runner.
 *
 * Safety: the lead only passes requests on, and its words can be steered by
 * team data (email text, other bots' answers), so a bot run this way always
 * asks the user before anything that changes things (approvalPolicy "ask";
 * tools the user chose to always allow stay allowed). A lead asked from
 * outside Dash (an MCP client) can't run its bots at all.
 */
"use strict";

// How long a lead waits for a bot it asked before reporting it as still
// going — usually it's waiting on the user's approval.
const LEAD_ASK_WAIT_MS = 3 * 60 * 1000;

// Where a lead's own run can come from that may not run its bots.
const OUTSIDE_CALLERS = new Set(["mcp"]);

/**
 * @param {object} p
 * @param {{ id: string, name: string }} p.lead
 * @param {{ id: string, name: string }} p.member
 * @param {string} p.request
 * @param {string|null} [p.leadVia]  who started the lead's run
 * @param {() => boolean} p.takeHandoff  counts the hand-off; false = over the cap
 * @param {(opts) => Promise<object>} p.run  runs the member with run options
 * @param {(p: Promise) => void} [p.track]  told about the member's run
 * @param {number} [p.waitMs]
 * @returns {Promise<object>} the run record, { pending: true }, or { skipped, reason }
 */
async function askTeamBot({
  lead,
  member,
  request,
  leadVia = null,
  takeHandoff,
  run,
  track = null,
  waitMs = LEAD_ASK_WAIT_MS,
}) {
  if (leadVia && OUTSIDE_CALLERS.has(String(leadVia))) {
    return {
      skipped: true,
      reason:
        "you were asked from outside Dash, so you can't run your bots — the user can ask you in Dash",
    };
  }
  if (!takeHandoff()) {
    return {
      skipped: true,
      reason:
        "you've asked your bots as many times as one answer allows — finish with what you have",
    };
  }
  const started = Promise.resolve(
    run({
      prompt: `${request}\n\n(Asked by ${lead.name}, the team lead, for the user — answer for them.)`,
      trigger: "ask",
      via: `lead:${lead.id}`,
      // Asks before anything that changes things, whatever the bot's own
      // setting — the request came through the lead, not straight from
      // the user.
      approvalPolicy: "ask",
    }),
  );
  if (track) track(started);
  let timer;
  const wait = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ pending: true }), waitMs);
  });
  try {
    return await Promise.race([started, wait]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { askTeamBot, LEAD_ASK_WAIT_MS, OUTSIDE_CALLERS };
