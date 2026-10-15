/**
 * pausedQueue.js — events that arrive for a paused (or over-budget) bot,
 * kept until it's resumed (bot-factory US-011 AC8, whilePaused "queue").
 *
 * Coalesced per subscription: a bot keeps only the latest event for each
 * trigger, so a burst while it was paused becomes one run with the newest
 * data. Saved through an injected { load, save } pair so the queue survives
 * a restart.
 *
 * Pure (NFR-006): no Electron; the clock is injected.
 */
"use strict";

// A bot can't pile up more than this many distinct triggers.
const MAX_PER_BOT = 50;

class PausedQueue {
  /**
   * @param {{ persistence?: { load: () => object|null, save: (o) => void },
   *           now?: () => string }} [opts]
   */
  constructor({ persistence = null, now } = {}) {
    this._persistence = persistence;
    this._now = now || (() => new Date().toISOString());
    /** @type {Record<string, Record<string, object>>} botId → key → item */
    this._bots = {};
    let saved = null;
    try {
      saved = persistence ? persistence.load() : null;
    } catch (_e) {
      saved = null;
    }
    if (saved && typeof saved === "object") {
      for (const [botId, items] of Object.entries(saved)) {
        if (items && typeof items === "object") this._bots[botId] = items;
      }
    }
  }

  _persist() {
    if (!this._persistence) return;
    try {
      this._persistence.save(this._bots);
    } catch (_e) {
      // A failed save leaves the in-memory queue; the next change retries.
    }
  }

  /**
   * Keep an event for a bot, replacing any earlier one for the same trigger.
   * @param {string} botId
   * @param {string} key    the subscription it matched (its eventType)
   * @param {{ event: object, label?: string }} item
   * @returns {number} how many triggers the bot has waiting
   */
  add(botId, key, { event, label = null }) {
    if (!botId || !key) return this.count(botId);
    const items = this._bots[botId] || {};
    const prev = items[key];
    if (!prev && Object.keys(items).length >= MAX_PER_BOT) {
      return this.count(botId);
    }
    items[key] = {
      key,
      event,
      label: label || (prev && prev.label) || null,
      // When the first one came in (its place in line) and how many arrived.
      firstAt: prev ? prev.firstAt : this._now(),
      lastAt: this._now(),
      received: (prev ? prev.received : 0) + 1,
    };
    this._bots[botId] = items;
    this._persist();
    return this.count(botId);
  }

  /** @returns {number} triggers waiting for this bot */
  count(botId) {
    return Object.keys(this._bots[botId] || {}).length;
  }

  /** @returns {Record<string, number>} botId → triggers waiting */
  counts() {
    const out = {};
    for (const id of Object.keys(this._bots)) {
      const n = this.count(id);
      if (n) out[id] = n;
    }
    return out;
  }

  /** Bots with something waiting. */
  botIds() {
    return Object.keys(this.counts());
  }

  /**
   * Take a bot's waiting events, oldest trigger first, and clear them.
   * @returns {object[]} items ({ key, event, label, firstAt, lastAt, received })
   */
  take(botId) {
    const items = Object.values(this._bots[botId] || {}).sort((a, b) =>
      String(a.firstAt).localeCompare(String(b.firstAt)),
    );
    if (items.length) {
      delete this._bots[botId];
      this._persist();
    }
    return items;
  }

  /** Put events back (the bot was paused again before they all ran). */
  putBack(botId, items) {
    if (!botId || !Array.isArray(items) || !items.length) return;
    const cur = this._bots[botId] || {};
    for (const it of items) {
      // A newer event that came in meanwhile wins.
      if (!cur[it.key]) cur[it.key] = it;
    }
    this._bots[botId] = cur;
    this._persist();
  }

  /** Drop a bot's waiting events (it was deleted). */
  clear(botId) {
    if (!this._bots[botId]) return;
    delete this._bots[botId];
    this._persist();
  }
}

/**
 * Run a resumed bot's waiting events one after another. If the bot is held
 * again (paused, over budget) before they've all run, the rest go back.
 * @param {{ queue: PausedQueue, botId: string,
 *           isHeld: (botId: string) => boolean,
 *           runOne: (item: object) => Promise<any> }} deps
 * @returns {Promise<number>} how many ran
 */
async function drainBot({ queue, botId, isHeld, runOne }) {
  if (isHeld(botId)) return 0;
  const items = queue.take(botId);
  let i = 0;
  for (; i < items.length; i++) {
    if (isHeld(botId)) break;
    try {
      await runOne(items[i]);
    } catch (_e) {
      // One event's run failing doesn't stop the others.
    }
  }
  if (i < items.length) queue.putBack(botId, items.slice(i));
  return i;
}

module.exports = { PausedQueue, MAX_PER_BOT, drainBot };
