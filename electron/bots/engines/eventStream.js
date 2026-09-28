/**
 * eventStream.js
 *
 * A minimal single-consumer async queue used to turn a push-style producer
 * (the engine loop, which emits BotEvents as it streams model output and runs
 * tools) into a pull-style `for await (…)` async-iterable that the bot runner
 * consumes over IPC.
 *
 * Portable by design — no Electron, no Node-only APIs beyond Promises — so the
 * engine layer stays runnable in plain Node (PRD NFR-006).
 */
"use strict";

/**
 * @returns {{
 *   push: (item: any) => void,
 *   end: () => void,
 *   [Symbol.asyncIterator]: () => AsyncIterator<any>
 * }}
 */
function createEventStream() {
  /** @type {any[]} */
  const queue = [];
  /** @type {Array<{ resolve: (r: IteratorResult<any>) => void }>} */
  const waiters = [];
  let ended = false;

  return {
    push(item) {
      if (ended) return;
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ value: item, done: false });
      } else {
        queue.push(item);
      }
    },
    end() {
      if (ended) return;
      ended = true;
      // Release everyone still awaiting a value with a done result.
      while (waiters.length) {
        waiters.shift().resolve({ value: undefined, done: true });
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => waiters.push({ resolve }));
        },
      };
    },
  };
}

module.exports = { createEventStream };
