/**
 * stopRun.js
 *
 * Stopping a bot's run: abort it, and deny that bot's pending approvals so a
 * prompt the run was waiting on doesn't linger in the queue (or keep the run
 * waiting). Other bots' approvals are left alone. Stopping because Dash is
 * quitting ("quit") records the run as interrupted (US-018 AC6).
 *
 * Pure (NFR-006): the runner and approvals registry are injected.
 */
"use strict";

/**
 * @param {{ runner: { abort(botId: string): boolean },
 *           approvals?: { list(): object[], deny(id: string, reason: string): boolean } | null,
 *           botId: string, reason?: "quit" }} deps
 * @returns {{ stopped: boolean, clearedApprovals: number }}
 */
function stopBotRun({ runner, approvals, botId, reason }) {
  const stopped = !!runner.abort(botId, reason);
  let clearedApprovals = 0;
  if (approvals && typeof approvals.list === "function") {
    for (const a of approvals.list()) {
      if (a && a.request && a.request.botId === botId) {
        if (
          approvals.deny(a.id, reason === "quit" ? "Dash quit" : "run stopped")
        )
          clearedApprovals++;
      }
    }
  }
  return { stopped, clearedApprovals };
}

/**
 * Resolves when no bot is running — or after `timeoutMs`, when given. A run's
 * record is written as it leaves the runner's active list, so idle means
 * every record is saved.
 * @param {{ runner: { listActive(): string[] }, timeoutMs?: number|null,
 *           pollMs?: number }} deps
 * @returns {Promise<boolean>} true when idle, false on timeout
 */
async function whenIdle({ runner, timeoutMs = null, pollMs = 100 }) {
  const until = timeoutMs === null ? Infinity : Date.now() + timeoutMs;
  while (runner.listActive().length) {
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return true;
}

/**
 * Dash is quitting and the user chose to stop the runs (US-018 AC6): stop
 * each (saved as "interrupted") and wait for their records, up to `timeoutMs`.
 * @returns {Promise<{ interrupted: number, unfinished: number }>}
 */
async function interruptAllRuns({
  runner,
  approvals,
  timeoutMs = 5000,
  pollMs,
}) {
  const ids = runner.listActive();
  for (const botId of ids) {
    stopBotRun({ runner, approvals, botId, reason: "quit" });
  }
  await whenIdle({ runner, timeoutMs, pollMs });
  return { interrupted: ids.length, unfinished: runner.listActive().length };
}

module.exports = { stopBotRun, whenIdle, interruptAllRuns };
