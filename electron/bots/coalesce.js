/**
 * coalesce.js — collapse a burst of calls into one call on the next tick.
 * Used for the "bots changed" broadcast, so a bulk edit (a deleted
 * dashboard's team unassigned) sends one message, not one per bot.
 */
"use strict";

/**
 * @param {() => void} fn
 * @param {(cb: () => void) => void} [schedule] defaults to setImmediate
 * @returns {() => void} trigger
 */
function coalesce(fn, schedule = (cb) => setImmediate(cb)) {
  let pending = false;
  return function trigger() {
    if (pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      fn();
    });
  };
}

module.exports = { coalesce };
