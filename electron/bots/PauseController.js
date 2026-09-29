/**
 * PauseController.js
 *
 * Holds bot pause state and answers "is this bot paused?" for the permission
 * gate (PRD US-014). Pause is enforced at the gate: while paused, every tool
 * call is denied, so any engine halts at its next tool boundary. Two levels
 * ship here — a global "pause all" kill switch and per-bot pause; the workspace/
 * project levels layer on later using the same shape.
 *
 * Portable (NFR-006): pure state, injected audit sink, no Electron.
 */
"use strict";

class PauseController {
  constructor({ audit } = {}) {
    this._global = false;
    this._bots = new Set();
    this._audit = audit || (() => {});
  }

  /** Global kill switch — pauses every bot (US-014 AC7). */
  pauseAll() {
    this._global = true;
    this._audit({ type: "pause-all" });
  }

  resumeAll() {
    this._global = false;
    this._audit({ type: "resume-all" });
  }

  isGloballyPaused() {
    return this._global;
  }

  pauseBot(botId) {
    this._bots.add(botId);
    this._audit({ type: "pause-bot", botId });
  }

  resumeBot(botId) {
    this._bots.delete(botId);
    this._audit({ type: "resume-bot", botId });
  }

  /** True when the global switch is on OR this bot is individually paused. */
  isPaused(botId) {
    return this._global || this._bots.has(botId);
  }

  /** @returns {{ global: boolean, bots: string[] }} */
  list() {
    return { global: this._global, bots: [...this._bots] };
  }
}

module.exports = PauseController;
