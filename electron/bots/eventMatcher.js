/**
 * eventMatcher.js
 *
 * Given a fired event and the set of bots, returns the bots that subscribe to
 * it (PRD FR-009 / US-010). A bot subscribes via `subscriptions: [{ eventType }]`.
 *
 * Workspace scoping is designed in but not yet exercised: when an event carries
 * a `workspaceId`, a bot only matches if it's unscoped (`workspaceId` falsy) or
 * its `workspaceId` equals the event's. Events aren't stamped with a workspace
 * yet (a follow-up slice), so today every subscribed bot matches — but the
 * scoping "just works" once stamping lands, with no matcher change.
 *
 * Pure (NFR-006): no Electron, no I/O.
 */
"use strict";

/**
 * Copied dashboards reuse widget ids, so one eventType can come from several
 * dashboards. A subscription picked in the bot form records its dashboard
 * (`source.workspaceId`); it then only matches events published from that
 * dashboard. Unstamped events and dashboard-less subscriptions still match.
 */
function sameDashboard(sub, event) {
  const want = sub.source && sub.source.workspaceId;
  const got = event.workspaceId;
  if (want == null || want === "" || got == null || got === "") return true;
  return String(want) === String(got);
}

/**
 * @param {Array<object>} bots  bot definitions (each may have `subscriptions`)
 * @param {{ eventType: string, workspaceId?: string }} event
 * @param {{ excludeBotId?: string }} [opts]  loop guard — never match this bot
 * @returns {Array<object>} the subscribing bots
 */
function matchSubscribedBots(bots, event, opts = {}) {
  if (!Array.isArray(bots) || !event || !event.eventType) return [];
  const excludeBotId = opts.excludeBotId || null;
  const eventWorkspace = event.workspaceId || null;

  return bots.filter((bot) => {
    if (!bot || bot.id === excludeBotId) return false;
    const subs = Array.isArray(bot.subscriptions) ? bot.subscriptions : [];
    const subscribed = subs.some(
      (s) => s && s.eventType === event.eventType && sameDashboard(s, event),
    );
    if (!subscribed) return false;

    // Workspace scoping (forward-compatible): only enforced once events carry a
    // workspaceId. An unscoped bot (no workspaceId) listens everywhere.
    if (eventWorkspace && bot.workspaceId) {
      return bot.workspaceId === eventWorkspace;
    }
    return true;
  });
}

module.exports = { matchSubscribedBots };
