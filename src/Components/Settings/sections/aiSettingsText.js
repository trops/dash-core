/**
 * aiSettingsText.js — what Settings › AI and the bot form say about models,
 * styles, limits and costs (electron/bots/aiDefaults.js decides; this only
 * labels). Pure, so it's tested on its own.
 */
import { scheduleLabel } from "../../Create/planChecklist";

/** Each job with a default model and style, in Settings' order. */
export const JOB_ROWS = [
  { job: "bots", name: "Bots", sub: "New bots start on this" },
  {
    job: "leads",
    name: "Dashboard leads",
    sub: "Answer questions about their dashboard",
  },
  { job: "planner", name: "Create · Planner", sub: "Plans what to build" },
  { job: "builder", name: "Create · Builder", sub: "Writes widgets" },
  { job: "checker", name: "Create · Checker", sub: "Checks what was built" },
  { job: "scout", name: "Create · Scout", sub: "Looks things up" },
  { job: "dashLead", name: "Dash Lead", sub: "Answers questions about Dash" },
];

// What each job runs on with no default set (the model tier, as before).
const JOB_TIER = {
  leads: "fast",
  planner: "deep",
  builder: "balanced",
  checker: "balanced",
  scout: "fast",
  dashLead: "fast",
};

// The cheaper defaults the switch to an API key offers.
const CHEAPER_TIER = {
  bots: ["fast", "brief"],
  leads: ["fast", "brief"],
  planner: ["balanced", "thorough"],
  builder: ["balanced", "normal"],
  checker: ["balanced", "brief"],
  scout: ["fast", "brief"],
  dashLead: ["fast", "brief"],
};

export const STYLE_LABELS = {
  brief: "Brief",
  normal: "Normal",
  thorough: "Thorough",
};

export const STYLE_OPTIONS = [
  { value: "brief", label: "Brief" },
  { value: "normal", label: "Normal" },
  { value: "thorough", label: "Thorough" },
];

const tierModel = (models, tier) =>
  (models || []).find((m) => m.tier === tier) || null;

/** The model list entry for an id, or null. */
export function modelInfo(models, id) {
  return (models || []).find((m) => m.value === id) || null;
}

/** "Claude Haiku 5.5" → "Haiku 5.5"; an unknown id stays as it is. */
export function shortModel(models, id) {
  const m = modelInfo(models, id);
  return m ? String(m.label).replace(/^Claude /, "") : id || "";
}

/**
 * The model a job runs on: its default, else what it ran on before the
 * setting (bots: the provider's first deep model — Opus; the rest: their
 * tier).
 */
export function effectiveJobModel(job, ai, models) {
  const own = ai && ai.defaults && ai.defaults[job] && ai.defaults[job].model;
  if (own) return own;
  const m = tierModel(models, job === "bots" ? "deep" : JOB_TIER[job]);
  return m ? m.value : null;
}

/** The deepest (and dearest) models: Opus and up. */
export function isMostExpensive(models, id) {
  const m = modelInfo(models, id);
  return !!m && m.tier === "deep";
}

/**
 * About what one run costs on an API key: a small bot run reads ~5,500
 * tokens it hasn't cached (most of the prompt is cached) and writes ~300.
 * Measured runs on Haiku 5.5 / Sonnet 5.5 land within 2–3× of this.
 * @returns {number|null}
 */
export function runCostEstimate(models, id) {
  const m = modelInfo(models, id);
  const p = m && m.pricing;
  if (!p || typeof p.input !== "number" || typeof p.output !== "number") {
    return null;
  }
  return (5500 * p.input + 300 * p.output) / 1e6;
}

/** "≈ $0.002 a run" — two significant figures, or "" when unknown. */
export function perRunText(models, id, suffix = " a run") {
  const usd = runCostEstimate(models, id);
  if (usd === null) return "";
  const shown =
    usd >= 0.1 ? usd.toFixed(2) : usd >= 0.01 ? usd.toFixed(3) : usd.toFixed(4);
  return `≈ $${Number(shown)}${suffix}`;
}

/** The cheaper defaults for every job: { <job>: { model, style } }. */
export function cheaperDefaults(models) {
  const out = {};
  for (const [job, [tier, style]] of Object.entries(CHEAPER_TIER)) {
    const m = tierModel(models, tier);
    if (m) out[job] = { model: m.value, style };
  }
  return out;
}

/** Whether any job would run on a most-expensive model now. */
export function anyOnMostExpensive(ai, models) {
  return JOB_ROWS.some(({ job }) =>
    isMostExpensive(models, effectiveJobModel(job, ai, models)),
  );
}

/** What starts a bot, in words: its schedule, an event, or being asked. */
export function runsText(bot) {
  const schedules = Array.isArray(bot && bot.schedules) ? bot.schedules : [];
  const cron = schedules.map((s) => s && s.cron).find(Boolean);
  if (cron) {
    const label = scheduleLabel(cron);
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : "";
  }
  const subs = Array.isArray(bot && bot.subscriptions) ? bot.subscriptions : [];
  if (subs.length) return "When an event arrives";
  return "When asked";
}

/** "$0.00 of $10.00" / "$0.30" — spent this month, against its limit. */
export function monthText(spent, limit) {
  const money = (n) => "$" + (Number(n) || 0).toFixed(2);
  return limit ? `${money(spent)} of ${money(limit)}` : money(spent);
}
