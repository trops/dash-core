/**
 * BotScheduler.js
 *
 * Registers bot schedules with croner in the MAIN process (PRD FR-004 / US-004)
 * so scheduled runs fire independently of any open window — unlike the widget
 * scheduler, which only broadcasts to the renderer. When a schedule fires it
 * calls the injected `runBot`; the runner's own one-run-per-bot guard handles
 * skip-if-running (US-004 AC4).
 *
 * `Cron` (croner's constructor) and `runBot` are injected so this is unit-
 * testable with a fake Cron and no timers. Catch-up (US-004 AC5/AC6) runs a
 * missed schedule once on startup/resume per its policy.
 *
 * Injected deps:
 *   Cron    (expr: string, [fn]) => { stop(), previousRun(date?) }   — croner ctor
 *   runBot  (botId, { prompt, trigger }) => Promise<any>
 *   now?    () => number (epoch ms)   — for catch-up comparisons
 */
"use strict";

class BotScheduler {
  constructor(deps = {}) {
    if (!deps.Cron) throw new Error('BotScheduler: missing dependency "Cron"');
    if (!deps.runBot)
      throw new Error('BotScheduler: missing dependency "runBot"');
    this._Cron = deps.Cron;
    this._runBot = deps.runBot;
    this._now = deps.now || (() => Date.now());
    /** @type {Map<string, any[]>} botId → cron job handles */
    this._jobs = new Map();
  }

  /** Register (replacing) all of a bot's schedules. */
  register(bot) {
    this.unregister(bot.id);
    const schedules = Array.isArray(bot.schedules) ? bot.schedules : [];
    const handles = [];
    for (const sched of schedules) {
      if (!sched || typeof sched.cron !== "string" || !sched.cron) continue;
      const job = new this._Cron(sched.cron, () =>
        this._runBot(bot.id, { prompt: sched.prompt, trigger: "schedule" }),
      );
      handles.push(job);
    }
    if (handles.length) this._jobs.set(bot.id, handles);
  }

  unregister(botId) {
    const handles = this._jobs.get(botId);
    if (!handles) return;
    for (const job of handles) {
      try {
        if (typeof job.stop === "function") job.stop();
      } catch (_e) {
        // best-effort stop
      }
    }
    this._jobs.delete(botId);
  }

  registerAll(bots) {
    for (const bot of bots || []) this.register(bot);
  }

  /** @returns {string[]} bot ids with active schedules */
  list() {
    return [...this._jobs.keys()];
  }

  /**
   * Run any schedule missed while Dash was closed/asleep, once, per policy.
   * `lastRunAtMs` is the bot's most recent run time (from the run log). For a
   * schedule whose previous fire time is after that, and whose catch-up policy
   * isn't "skip", fire one catch-up run. ("all" is treated as a single run in
   * this slice; full missed-occurrence enumeration is a later refinement.)
   *
   * @param {object} bot
   * @param {number} lastRunAtMs epoch ms of the bot's last run (0 if never)
   */
  catchUp(bot, lastRunAtMs = 0) {
    const schedules = Array.isArray(bot.schedules) ? bot.schedules : [];
    const nowMs = this._now();
    for (const sched of schedules) {
      if (!sched || typeof sched.cron !== "string" || !sched.cron) continue;
      const policy = sched.catchUp || "once";
      if (policy === "skip") continue;

      let prev = null;
      try {
        const probe = new this._Cron(sched.cron);
        if (typeof probe.previousRun === "function") {
          prev = probe.previousRun(new Date(nowMs));
        }
        if (typeof probe.stop === "function") probe.stop();
      } catch (_e) {
        prev = null;
      }
      const prevMs = prev ? prev.getTime() : null;
      if (prevMs !== null && prevMs > lastRunAtMs) {
        this._runBot(bot.id, { prompt: sched.prompt, trigger: "catch-up" });
      }
    }
  }
}

module.exports = BotScheduler;
