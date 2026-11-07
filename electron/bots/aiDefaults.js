/**
 * aiDefaults.js
 *
 * Settings › AI: what Dash's AI runs on (the Claude subscription via the
 * Claude Code CLI, or an Anthropic API key), the default model and style for
 * each job, and the limits on a single run. Stored under `ai` in the bot
 * settings; every value is optional, and an unset one keeps the behaviour
 * from before the setting existed.
 *
 * Pure (NFR-006): decisions only; botController applies them.
 */
"use strict";

const { isDashTeam } = require("./dashTeam");
const { isLead } = require("./teamLeads");

const BACKENDS = ["subscription", "api"];

/** The jobs with a default model and style, in the order Settings shows them. */
const JOBS = [
  "bots",
  "leads",
  "planner",
  "builder",
  "checker",
  "scout",
  "dashLead",
];

// Style → the effort Claude puts in, plus a line on how long to answer.
const STYLES = {
  brief: {
    effort: "low",
    line: "Keep your final answer to a line or two.",
  },
  normal: { effort: "medium", line: null },
  thorough: { effort: "high", line: null },
};

/**
 * Run limits when the user hasn't set one. Steps for Create's roles are
 * higher: building a widget takes many tool uses.
 */
const LIMIT_DEFAULTS = {
  steps: 25,
  createSteps: 80,
  costPerRun: 1,
  minutes: 20,
  // A month's limit for each bot without its own; null = none.
  perBot: null,
};

const CREATE_JOBS = new Set(["planner", "builder", "checker", "scout"]);

/** The job a bot does: a Dash team role, a dashboard lead, or a bot. */
function jobOf(bot) {
  if (isDashTeam(bot)) {
    return bot.role === "dashlead" ? "dashLead" : bot.role;
  }
  if (isLead(bot)) return "leads";
  return "bots";
}

const posNumber = (v) => (typeof v === "number" && v > 0 ? v : null);

/** The `ai` settings with every field present (null = unset). */
function readAi(settings) {
  const ai = (settings && settings.ai) || {};
  const defaults = {};
  for (const job of JOBS) {
    const d = (ai.defaults && ai.defaults[job]) || {};
    defaults[job] = {
      model: typeof d.model === "string" && d.model ? d.model : null,
      style: STYLES[d.style] ? d.style : null,
    };
  }
  const lim = ai.limits || {};
  const limits = {};
  for (const key of Object.keys(LIMIT_DEFAULTS)) {
    limits[key] = key in lim ? posNumber(lim[key]) : LIMIT_DEFAULTS[key];
  }
  return {
    backend: BACKENDS.includes(ai.backend) ? ai.backend : "subscription",
    defaults,
    limits,
    migrated: !!ai.migrated,
  };
}

/**
 * Apply a patch to the `ai` settings: { backend?, defaults?: { <job>:
 * { model?, style? } }, limits?: { <key>: number|null } }. Unknown jobs,
 * styles and limits are dropped; null or "" clears a value (a cleared limit
 * means no limit).
 */
function mergeAiSettings(current, patch) {
  const cur = current || {};
  const p = patch || {};
  const next = { ...cur };
  if (p.backend !== undefined && BACKENDS.includes(p.backend)) {
    next.backend = p.backend;
  }
  if (p.defaults && typeof p.defaults === "object") {
    const defaults = { ...(cur.defaults || {}) };
    for (const [job, d] of Object.entries(p.defaults)) {
      if (!JOBS.includes(job) || !d || typeof d !== "object") continue;
      const row = { ...(defaults[job] || {}) };
      if (d.model !== undefined) {
        if (typeof d.model === "string" && d.model) row.model = d.model;
        else delete row.model;
      }
      if (d.style !== undefined) {
        if (STYLES[d.style]) row.style = d.style;
        else delete row.style;
      }
      defaults[job] = row;
    }
    next.defaults = defaults;
  }
  if (p.limits && typeof p.limits === "object") {
    const limits = { ...(cur.limits || {}) };
    for (const [key, v] of Object.entries(p.limits)) {
      if (!(key in LIMIT_DEFAULTS)) continue;
      // Kept even when null: a cleared limit is "no limit", not the default.
      limits[key] = posNumber(v);
    }
    next.limits = limits;
  }
  if (p.migrated !== undefined) next.migrated = !!p.migrated;
  return next;
}

/** The provider a bot without one of its own runs on. */
function backendProvider(ai) {
  return ai && ai.backend === "api" ? "anthropic" : "claude-code";
}

/** The model a bot's job defaults to, or null (keep the old fallback). */
function defaultModelFor(bot, ai) {
  const d = ai && ai.defaults && ai.defaults[jobOf(bot)];
  return (d && d.model) || null;
}

/**
 * The style a run uses: the bot's own, else its job's default, else none.
 * @returns {{ style: string, effort: string, line: string|null } | null}
 */
function styleFor(bot, ai) {
  const own = bot && STYLES[bot.style] ? bot.style : null;
  const d = ai && ai.defaults && ai.defaults[jobOf(bot)];
  const style = own || (d && d.style) || null;
  return style ? { style, ...STYLES[style] } : null;
}

/**
 * The limits on one run: the bot's own (bot.maxTurns, bot.runLimits), else
 * the defaults. A cost cap only applies on an API key — a subscription run
 * isn't paid per run.
 * @returns {{ maxTurns: number|null, minutes: number|null,
 *   costPerRun: number|null }}
 */
function runLimitsFor(bot, ai, { paid = false } = {}) {
  const own = (bot && bot.runLimits) || {};
  const limits = (ai && ai.limits) || LIMIT_DEFAULTS;
  const create = CREATE_JOBS.has(jobOf(bot));
  const pick = (ownValue, fallback) =>
    ownValue === undefined ? fallback : posNumber(ownValue);
  return {
    maxTurns: pick(
      own.steps !== undefined ? own.steps : bot && bot.maxTurns,
      create ? limits.createSteps : limits.steps,
    ),
    minutes: pick(own.minutes, limits.minutes),
    costPerRun: paid ? pick(own.costPerRun, limits.costPerRun) : null,
  };
}

/**
 * The monthly limit a bot gets when it has none of its own: the per-bot
 * default, for bots only (leads and the Dash team count toward the total).
 */
function defaultMonthlyLimitFor(bot, ai) {
  if (!bot || jobOf(bot) !== "bots") return null;
  return (ai && ai.limits && ai.limits.perBot) || null;
}

/**
 * Whether a bot's next run likely comes within the hour, so its prompt is
 * worth caching for an hour instead of five minutes: Create's roles and
 * leads (a conversation goes back and forth), and bots scheduled at least
 * hourly (a cron whose hour field is "*").
 */
function runsAgainWithinHour(bot) {
  if (!bot) return false;
  if (jobOf(bot) !== "bots") return true;
  return (Array.isArray(bot.schedules) ? bot.schedules : []).some((s) => {
    const fields = String((s && s.cron) || "")
      .trim()
      .split(/\s+/);
    return fields.length >= 5 && fields[1] === "*";
  });
}

/**
 * Bots that should follow the default instead of the Claude Code CLI they
 * have saved. Before Settings › AI, the bot form and Dash itself saved
 * "claude-code" as the default; a bot that also picked no model or engine
 * never chose it on purpose. Returns their ids.
 */
function planFollowDefault(bots) {
  return (Array.isArray(bots) ? bots : [])
    .filter((b) => b && b.provider === "claude-code" && !b.model && !b.engine)
    .map((b) => b.id);
}

module.exports = {
  BACKENDS,
  JOBS,
  STYLES,
  LIMIT_DEFAULTS,
  jobOf,
  readAi,
  mergeAiSettings,
  backendProvider,
  defaultModelFor,
  styleFor,
  runLimitsFor,
  defaultMonthlyLimitFor,
  runsAgainWithinHour,
  planFollowDefault,
};
