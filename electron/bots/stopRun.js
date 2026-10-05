/**
 * stopRun.js
 *
 * Stopping a bot's run: abort it, and deny that bot's pending approvals so a
 * prompt the run was waiting on doesn't linger in the queue (or keep the run
 * waiting). Other bots' approvals are left alone.
 *
 * Pure (NFR-006): the runner and approvals registry are injected.
 */
"use strict";

/**
 * @param {{ runner: { abort(botId: string): boolean },
 *           approvals?: { list(): object[], deny(id: string, reason: string): boolean } | null,
 *           botId: string }} deps
 * @returns {{ stopped: boolean, clearedApprovals: number }}
 */
function stopBotRun({ runner, approvals, botId }) {
  const stopped = !!runner.abort(botId);
  let clearedApprovals = 0;
  if (approvals && typeof approvals.list === "function") {
    for (const a of approvals.list()) {
      if (a && a.request && a.request.botId === botId) {
        if (approvals.deny(a.id, "run stopped")) clearedApprovals++;
      }
    }
  }
  return { stopped, clearedApprovals };
}

module.exports = { stopBotRun };
