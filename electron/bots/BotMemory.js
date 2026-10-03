/**
 * BotMemory.js
 *
 * Durable, scoped key-value memory for bots (PRD FR-010 / FR-012, US-012/015):
 * a bot can remember facts across runs. Values are namespaced by scope
 * (`workspace` — isolated per workspace — or `global` — shared across a
 * principal's bots) and carry a monotonic `version` + `updatedAt` so a later
 * slice can add history/optimistic concurrency without a data migration.
 *
 * Portable (NFR-006): the durable blob is injected as `persistence` (same shape
 * as BotStore/BudgetController), so this loads and runs under plain Node. The
 * Electron wiring (electron-store) lives in host.js. A KV store needs no SQL for
 * v1; SQLite can later slot in behind this exact interface if volume demands.
 */
"use strict";

const VALID_SCOPES = ["workspace", "global", "bot"];

/**
 * Bucket key for a (scope, id) pair. Global collapses all ids to one bucket;
 * "workspace" is a team's shared memory (id = the dashboard); "bot" is one
 * bot's private memory (id = the bot) — used by bots with no dashboard, so
 * they don't share one bucket.
 */
function bucketKey(scope, id) {
  if (scope === "global") return "global";
  if (scope === "bot") {
    if (!id) throw new Error("BotMemory: the 'bot' scope needs a bot id");
    return `bot:${id}`;
  }
  return `workspace:${id || "default"}`;
}

class BotMemory {
  /**
   * @param {{ persistence: { read: () => object, write: (o: object) => void },
   *           clock?: { now: () => string } }} deps
   */
  constructor({ persistence, clock } = {}) {
    if (!persistence) throw new Error("BotMemory: persistence is required");
    this._persistence = persistence;
    this._now = (clock && clock.now) || (() => new Date().toISOString());
  }

  _read() {
    const blob = this._persistence.read() || {};
    return blob.scopes ? blob : { scopes: {} };
  }

  _write(blob) {
    this._persistence.write(blob);
  }

  /** @returns {*} the stored value, or undefined if absent. */
  get(scope, id, key) {
    const bucket = this._read().scopes[bucketKey(scope, id)] || {};
    const entry = bucket[key];
    return entry ? entry.value : undefined;
  }

  /** Store (or overwrite) a value; bumps version. @returns the stored entry. */
  set(scope, id, key, value) {
    const blob = this._read();
    const bk = bucketKey(scope, id);
    const bucket = blob.scopes[bk] || (blob.scopes[bk] = {});
    const prev = bucket[key];
    const entry = {
      value,
      version: prev ? prev.version + 1 : 1,
      updatedAt: this._now(),
    };
    bucket[key] = entry;
    this._write(blob);
    return entry;
  }

  /** @returns {Array<{key,value,version,updatedAt}>} entries, optionally prefixed. */
  list(scope, id, prefix) {
    const bucket = this._read().scopes[bucketKey(scope, id)] || {};
    return Object.keys(bucket)
      .filter((k) => !prefix || k.startsWith(prefix))
      .sort()
      .map((k) => ({
        key: k,
        value: bucket[k].value,
        version: bucket[k].version,
        updatedAt: bucket[k].updatedAt,
      }));
  }

  /** @returns {boolean} true if a value was removed. */
  /**
   * A bot was deleted: drop its private memory (the "bot" scope). Team and
   * global memory are shared, so they're never touched.
   * @returns {boolean} whether there was anything to remove
   */
  forgetBot(botId) {
    if (!botId) return false;
    const blob = this._read();
    const key = bucketKey("bot", botId);
    if (!blob.scopes[key]) return false;
    delete blob.scopes[key];
    this._write(blob);
    return true;
  }

  delete(scope, id, key) {
    const blob = this._read();
    const bucket = blob.scopes[bucketKey(scope, id)];
    if (!bucket || !(key in bucket)) return false;
    delete bucket[key];
    this._write(blob);
    return true;
  }
}

module.exports = { BotMemory, VALID_SCOPES };
