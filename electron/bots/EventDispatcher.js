/**
 * EventDispatcher.js
 *
 * Rate guard for event-triggered bot runs (PRD FR-009): a chatty event must not
 * spawn a flood of runs. Enforces a per-bot cooldown — a given bot won't be
 * event-triggered more often than once per `cooldownMs`. The dispatch decision
 * (pause, already-running) lives in botController; this owns only the timing.
 *
 * Pure (NFR-006): the clock is injected, so it's deterministic under test and
 * Electron-free.
 */
"use strict";

const DEFAULT_COOLDOWN_MS = 10_000;

class EventDispatcher {
  /**
   * @param {{ cooldownMs?: number, clock?: { nowMs: () => number } }} [opts]
   */
  constructor(opts = {}) {
    this._cooldownMs =
      typeof opts.cooldownMs === "number"
        ? opts.cooldownMs
        : DEFAULT_COOLDOWN_MS;
    this._nowMs = (opts.clock && opts.clock.nowMs) || (() => Date.now());
    /** @type {Map<string, number>} botId → last dispatch time (ms) */
    this._last = new Map();
  }

  /** @returns {boolean} true if the bot is allowed to run for an event now. */
  shouldDispatch(botId) {
    const last = this._last.get(botId);
    if (last === undefined) return true;
    return this._nowMs() - last >= this._cooldownMs;
  }

  /** Record that the bot was just event-dispatched (starts its cooldown). */
  note(botId) {
    this._last.set(botId, this._nowMs());
  }
}

module.exports = { EventDispatcher, DEFAULT_COOLDOWN_MS };
