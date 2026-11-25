/**
 * busyQueue.js — hand-ons that wait for a busy bot (DASH-73).
 *
 * A bot hands on to the next one; if that bot is still doing another run
 * (or its checks are still trying that run's work), the hand-on used to be
 * skipped. In a team that takes a ticket every few minutes, that lost the
 * second ticket. Now it waits here, in order, and starts when the bot is
 * free. Unlike the paused queue, nothing is coalesced: two tickets are two
 * runs.
 *
 * In memory: after a restart, what was waiting is gone (its job says so).
 *
 * Pure: no Electron.
 */
"use strict";

// The most hand-ons that can wait for one bot; past that one is refused
// (and said), so a runaway schedule can't pile up without end.
const MAX_WAITING_PER_BOT = 10;

class BusyQueue {
  constructor({ max = MAX_WAITING_PER_BOT } = {}) {
    this._max = max;
    /** @type {Map<string, object[]>} botId → events, oldest first */
    this._bots = new Map();
  }

  /** Keep an event for a bot. False when it already has `max` waiting. */
  add(botId, event) {
    if (!botId || !event) return false;
    const list = this._bots.get(botId) || [];
    if (list.length >= this._max) return false;
    list.push(event);
    this._bots.set(botId, list);
    return true;
  }

  /** The oldest waiting event, taken off the queue, or null. */
  shift(botId) {
    const list = this._bots.get(botId);
    if (!list || !list.length) return null;
    const event = list.shift();
    if (!list.length) this._bots.delete(botId);
    return event;
  }

  /** Put an event back at the front (it couldn't start after all). */
  unshift(botId, event) {
    if (!botId || !event) return;
    const list = this._bots.get(botId) || [];
    list.unshift(event);
    this._bots.set(botId, list);
  }

  count(botId) {
    const list = this._bots.get(botId);
    return list ? list.length : 0;
  }

  /** { [botId]: n } for every bot with something waiting. */
  counts() {
    const out = {};
    for (const [botId, list] of this._bots) out[botId] = list.length;
    return out;
  }

  /** Drop what waits for a bot; returns what was dropped. */
  clear(botId) {
    const list = this._bots.get(botId) || [];
    this._bots.delete(botId);
    return list;
  }

  get max() {
    return this._max;
  }
}

module.exports = { BusyQueue, MAX_WAITING_PER_BOT };
