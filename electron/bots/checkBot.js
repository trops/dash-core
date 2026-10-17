/**
 * checkBot.js — the one check every bot save runs before anything is
 * written (consolidation Phase 1d; botController.save):
 *
 *   - its shape (validateBotDefinition, as the store checks it);
 *   - each schedule is a valid cron (a bad one used to be saved, then fail
 *     to schedule);
 *   - each connection it uses is one the user has (one that exists but isn't
 *     running is fine — it starts when the bot runs);
 *   - a chosen AI provider is one the app knows;
 *   - what starts it: a widget event names a widget on that dashboard (and
 *     one that sends that event, when the caller can tell — botController
 *     can't read a widget's events synchronously, so that's checked where
 *     triggers are made: plan builds and the trigger picker); a bot trigger
 *     names a bot that exists.
 *
 * Only what's new or changed is held to it: editing a bot that already has
 * a dead trigger or a removed connection warns instead, so it can still be
 * fixed. A check the caller can't make (no context) is skipped, not failed.
 *
 * @param {object} def  the whole bot as it would be saved
 * @param {{
 *   existing?: object|null,
 *   connections?: string[]|null,
 *   knownAiProvider?: (id: string) => boolean,
 *   cronValid?: (expr: string) => boolean,
 *   widgetOnDashboard?: (workspaceId, widgetId, component) => boolean|null,
 *   widgetSends?: (component) => string[]|null,
 *   botExists?: (id) => boolean,
 * }} ctx
 * @returns {{ errors: string[], warnings: string[] }}
 */
const { validateBotDefinition, withDefaults } = require("./botSchema");

const list = (v) => (Array.isArray(v) ? v : []);

function checkBot(def, ctx = {}) {
  const errors = [];
  const warnings = [];
  const existing = ctx.existing || null;

  // As the store checks it: with the defaults filled in.
  const shape = validateBotDefinition(
    def && typeof def === "object" ? withDefaults(def) : def,
  );
  if (!shape.valid) errors.push(...shape.errors);
  if (!def || typeof def !== "object") return { errors, warnings };

  // A problem with something it already had only warns.
  const report = (isNew, message) => (isNew ? errors : warnings).push(message);

  if (typeof ctx.cronValid === "function") {
    for (const s of list(def.schedules)) {
      if (!s || typeof s.cron !== "string" || !s.cron.trim()) continue;
      if (!ctx.cronValid(s.cron)) {
        errors.push(
          `"${s.cron}" isn't a valid schedule — use a cron expression like "0 8 * * *" (every day at 8:00).`,
        );
      }
    }
  }

  if (Array.isArray(ctx.connections)) {
    const have = new Set(ctx.connections.map((n) => String(n)));
    const had = new Set(list(existing && existing.mcpServers).map(String));
    for (const name of list(def.mcpServers)) {
      if (!have.has(String(name))) {
        report(
          !had.has(String(name)),
          `It uses the connection "${name}", which you don't have — connect it in Providers, or take it off the bot.`,
        );
      }
    }
  }

  if (
    typeof ctx.knownAiProvider === "function" &&
    def.provider &&
    def.provider !== (existing && existing.provider) &&
    !ctx.knownAiProvider(def.provider)
  ) {
    errors.push(
      `It runs on the AI provider "${def.provider}", which this app doesn't know.`,
    );
  }

  const hadTrigger = new Set(
    list(existing && existing.subscriptions).map((s) => s && s.eventType),
  );
  for (const sub of list(def.subscriptions)) {
    const src = (sub && sub.source) || {};
    const isNew = !hadTrigger.has(sub && sub.eventType);
    const label = (sub && sub.label) || (sub && sub.eventType) || "a trigger";
    if (src.kind === "widget") {
      if (typeof ctx.widgetOnDashboard === "function") {
        const on = ctx.widgetOnDashboard(
          src.workspaceId,
          src.instanceId,
          src.ref,
        );
        if (on === false) {
          report(
            isNew,
            `It starts on ${label}, but that widget isn't on that dashboard.`,
          );
          continue;
        }
      }
      if (typeof ctx.widgetSends === "function" && src.event) {
        const sends = ctx.widgetSends(src.ref);
        if (Array.isArray(sends) && !sends.includes(src.event)) {
          report(
            isNew,
            `It starts on ${label}, but that widget doesn't send "${src.event}".`,
          );
        }
      }
    } else if (src.kind === "bot" && typeof ctx.botExists === "function") {
      if (src.instanceId && !ctx.botExists(src.instanceId)) {
        report(
          isNew,
          `It starts on ${label}, from a bot that isn't there any more.`,
        );
      }
    }
  }

  return { errors, warnings };
}

module.exports = { checkBot };
