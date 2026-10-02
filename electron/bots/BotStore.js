/**
 * BotStore.js
 *
 * CRUD for bot definitions, per-bot run history, and engine session state
 * (PRD FR-001). Portable by design (NFR-006): no Electron, no electron-store.
 * Persistence, the bots root directory, and the clock are injected, so the
 * store loads and runs in plain Node (the runner package can move to a headless
 * process later). Only Node built-ins (fs, path) are used directly.
 *
 * Construction:
 *   new BotStore({ persistence, paths, clock })
 *     persistence: { read(): object, write(obj): void }   // durable blob
 *     paths:       { botsRoot: string }                    // e.g. userData/bots
 *     clock:       { now(): string }                       // ISO timestamps
 *
 * Persisted blob shape:
 *   { bots: { [id]: BotDefinition }, runs: { [id]: Run[] } }
 *
 * Each bot gets a private working directory at <botsRoot>/<id>/files, created
 * on create() and removed on delete().
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  newBotId,
  isValidBotId,
  withDefaults,
  validateBotDefinition,
} = require("./botSchema");
const { botRef } = require("./botEvents");

// Keep only the most recent N runs per bot so the blob doesn't grow without
// bound (full history migrates to SQLite in a later phase).
const MAX_RUNS_PER_BOT = 100;

// Run fields that can hold sensitive text — sealed at rest via secretBox.
const SEALED_RUN_FIELDS = ["output", "prompt"];

class BotStore {
  /**
   * @param {{ persistence: {read: () => object, write: (o: object) => void},
   *           paths: { botsRoot: string },
   *           clock?: { now: () => string } }} deps
   */
  constructor({ persistence, paths, clock, secretBox = null } = {}) {
    if (
      !persistence ||
      typeof persistence.read !== "function" ||
      typeof persistence.write !== "function"
    ) {
      throw new Error("BotStore: persistence with read()/write() is required");
    }
    if (!paths || typeof paths.botsRoot !== "string" || !paths.botsRoot) {
      throw new Error("BotStore: paths.botsRoot is required");
    }
    this._persistence = persistence;
    this._botsRoot = paths.botsRoot;
    this._now = (clock && clock.now) || (() => new Date().toISOString());
    // Seals sensitive run fields at rest (run answers). Optional: without one
    // (plain-Node host) they're stored as-is.
    this._box = secretBox;
    /** Listeners for bot definition changes (create / update / delete). */
    this._listeners = new Set();
  }

  /**
   * Be told when a bot definition is created, updated or deleted — not runs,
   * sessions or settings. The Bots view uses it (via the controller's
   * broadcast) to refresh team lists.
   * @param {(change: { type: "created"|"updated"|"deleted", id: string }) => void} listener
   * @returns {() => void} unsubscribe
   */
  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _changed(type, id) {
    for (const listener of this._listeners) {
      try {
        listener({ type, id });
      } catch (_e) {
        // A listener's bug must never break a save.
      }
    }
  }

  _load() {
    const data = this._persistence.read() || {};
    if (!data.bots) data.bots = {};
    if (!data.runs) data.runs = {};
    // Bots saved before `ref` existed get their stable identity once, and it's
    // persisted so a later rename can't change it.
    let backfilled = false;
    for (const bot of Object.values(data.bots)) {
      if (bot && !bot.ref) {
        bot.ref = botRef(bot);
        backfilled = true;
      }
    }
    if (backfilled) this._save(data);
    return data;
  }

  _save(data) {
    this._persistence.write(data);
  }

  /** Absolute path to a bot's private working directory. */
  workingDir(id) {
    if (!isValidBotId(id)) {
      throw new Error(`BotStore: invalid bot id "${id}"`);
    }
    return path.join(this._botsRoot, id, "files");
  }

  /** @returns {object[]} all bot definitions */
  list() {
    const { bots } = this._load();
    return Object.values(bots);
  }

  /** @returns {object|null} */
  get(id) {
    const { bots } = this._load();
    return bots[id] || null;
  }

  /**
   * Create a bot from a partial definition. Fills defaults, validates, stamps
   * id + timestamps, persists, and creates the working directory.
   * @returns {object} the stored definition
   * @throws if validation fails
   */
  create(def) {
    const filled = withDefaults(def);
    const { valid, errors } = validateBotDefinition(filled);
    if (!valid) {
      throw new Error(`BotStore.create: invalid bot — ${errors.join("; ")}`);
    }
    const id = newBotId();
    const ts = this._now();
    // Stable identity for bot events (bot:<ref>[<id>].<event>): a template's
    // registry id when supplied, else local/<slug of name>. Never changes.
    const bot = {
      ...filled,
      ref: botRef(filled),
      id,
      createdAt: ts,
      updatedAt: ts,
    };

    const data = this._load();
    data.bots[id] = bot;
    this._save(data);

    fs.mkdirSync(this.workingDir(id), { recursive: true });
    this._changed("created", id);
    return bot;
  }

  /**
   * Update a bot's definition without discarding its session or run history.
   * `id`, `createdAt`, and `session` are protected from the patch (session has
   * its own methods).
   * @returns {object} the updated definition
   */
  update(id, patch) {
    const data = this._load();
    const existing = data.bots[id];
    if (!existing) throw new Error(`BotStore.update: no bot "${id}"`);

    // `ref` is the bot's stable identity — protected like `id`.
    const {
      id: _i,
      createdAt: _c,
      session: _s,
      ref: _r,
      ...safePatch
    } = patch || {};
    const merged = { ...existing, ...safePatch, updatedAt: this._now() };

    const { valid, errors } = validateBotDefinition(merged);
    if (!valid) {
      throw new Error(`BotStore.update: invalid bot — ${errors.join("; ")}`);
    }
    data.bots[id] = merged;
    this._save(data);
    this._changed("updated", id);
    return merged;
  }

  /** Delete a bot, its runs, and its working directory. */
  delete(id) {
    const data = this._load();
    if (!data.bots[id]) return false;
    delete data.bots[id];
    delete data.runs[id];
    this._save(data);

    if (isValidBotId(id)) {
      fs.rmSync(path.join(this._botsRoot, id), {
        recursive: true,
        force: true,
      });
    }
    this._changed("deleted", id);
    return true;
  }

  /**
   * Persist the engine's resume state on the bot record (US-005). Stored as
   * { engine, state } so a provider/engine change can detect a mismatch.
   */
  saveSession(id, engineId, state) {
    const data = this._load();
    const bot = data.bots[id];
    if (!bot) throw new Error(`BotStore.saveSession: no bot "${id}"`);
    bot.session = { engine: engineId, state };
    bot.updatedAt = this._now();
    this._save(data);
    return bot.session;
  }

  /** Clear stored session state (US-005 "Reset memory"). */
  resetSession(id) {
    const data = this._load();
    const bot = data.bots[id];
    if (!bot) throw new Error(`BotStore.resetSession: no bot "${id}"`);
    bot.session = null;
    bot.updatedAt = this._now();
    this._save(data);
  }

  /** Append a run record to a bot's activity log (capped, newest kept). */
  appendRun(id, run) {
    const data = this._load();
    if (!data.bots[id]) throw new Error(`BotStore.appendRun: no bot "${id}"`);
    const entry = { ...run, at: (run && run.at) || this._now() };
    // The run's answer and prompt can hold sensitive text (emails, what the
    // user asked) — sealed at rest. Tool summaries (names only) stay plain.
    const stored = { ...entry };
    if (this._box) {
      for (const field of SEALED_RUN_FIELDS) {
        if (typeof stored[field] === "string") {
          stored[field] = this._box.seal(stored[field]);
        }
      }
    }
    const runs = data.runs[id] || [];
    runs.push(stored);
    data.runs[id] = runs.slice(-MAX_RUNS_PER_BOT);
    this._save(data);
    return entry;
  }

  /**
   * @returns {object[]} run records for a bot, oldest first. Sealed fields
   * that can't be decrypted (keychain reset, another app identity) come back
   * as null, with `outputUnavailable: true` when the answer is affected.
   */
  getRuns(id) {
    const { runs } = this._load();
    const list = runs[id] || [];
    if (!this._box) return list;
    return list.map((r) => {
      if (!r) return r;
      const out = { ...r };
      for (const field of SEALED_RUN_FIELDS) {
        if (typeof out[field] !== "string") continue;
        out[field] = this._box.open(out[field]);
        if (out[field] === null && field === "output") {
          out.outputUnavailable = true;
        }
      }
      return out;
    });
  }

  // ---- Team settings (bot-teams TEAM-002) --------------------------------

  /** Per-dashboard team settings; defaults { leadEnabled: true }. */
  getTeamSettings(workspaceId) {
    const { teams } = this._load();
    const key = String(workspaceId);
    return { leadEnabled: true, ...((teams && teams[key]) || {}) };
  }

  setTeamSettings(workspaceId, patch) {
    const data = this._load();
    const key = String(workspaceId);
    data.teams = data.teams || {};
    data.teams[key] = { ...this.getTeamSettings(key), ...(patch || {}) };
    this._save(data);
    return data.teams[key];
  }

  /** Global bot settings; defaults { autoLeads: true }. */
  getSettings() {
    const { settings } = this._load();
    return { autoLeads: true, ...(settings || {}) };
  }

  setSettings(patch) {
    const data = this._load();
    data.settings = { ...this.getSettings(), ...(patch || {}) };
    this._save(data);
    return data.settings;
  }
}

module.exports = BotStore;
module.exports.MAX_RUNS_PER_BOT = MAX_RUNS_PER_BOT;
