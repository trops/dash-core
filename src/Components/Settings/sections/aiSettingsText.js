/**
 * aiSettingsText.js — what Settings › AI and the bot form say about models,
 * styles, limits and costs (electron/bots/aiDefaults.js decides; this only
 * labels). Pure, so it's tested on its own.
 */
import { scheduleLabel } from "../../Create/planChecklist";
import { latestOf, resolveModel } from "../modelChoices";

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

// The cheaper defaults the switch to an API key offers. Create's roles stay
// Normal or Thorough: their answers have formats the next step reads.
const CHEAPER_TIER = {
  bots: ["fast", "brief"],
  leads: ["fast", "brief"],
  planner: ["balanced", "thorough"],
  builder: ["balanced", "normal"],
  checker: ["balanced", "normal"],
  scout: ["fast", "normal"],
  dashLead: ["fast", "normal"],
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
  (models || []).find((m) => m.tier === tier && m.status !== "retired") || null;

/**
 * The model list entry an id runs on, or null: "latest:haiku" is the
 * newest Haiku.
 */
export function modelInfo(models, id) {
  return resolveModel(models, id);
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
 * About what one run costs on an API key: a small bot run reads the
 * equivalent of ~10,000 full-price tokens (most of its prompt comes from the
 * cache at a tenth) and writes ~300. Measured runs (Haiku 5.5 $0.0006–0.002,
 * Sonnet 5.5 $0.006–0.035, Opus 5.5 $0.066 uncached) sit around this.
 * @returns {number|null}
 */
export function runCostEstimate(models, id) {
  const m = modelInfo(models, id);
  const p = m && m.pricing;
  if (!p || typeof p.input !== "number" || typeof p.output !== "number") {
    return null;
  }
  return (10000 * p.input + 300 * p.output) / 1e6;
}

/** "≈ $0.002 a run" — two significant figures, or "" when unknown. */
export function perRunText(models, id, suffix = " a run") {
  const usd = runCostEstimate(models, id);
  if (usd === null) return "";
  const shown =
    usd >= 0.1 ? usd.toFixed(2) : usd >= 0.01 ? usd.toFixed(3) : usd.toFixed(4);
  return `≈ $${Number(shown)}${suffix}`;
}

/**
 * The cheaper defaults: { <job>: { model, style } } — only for jobs the
 * user hasn't set (a model or style they chose stays).
 */
export function cheaperDefaults(models, ai = null) {
  const out = {};
  for (const [job, [tier, style]] of Object.entries(CHEAPER_TIER)) {
    const own = (ai && ai.defaults && ai.defaults[job]) || {};
    const m = tierModel(models, tier);
    const row = {};
    // The family's newest, kept current: "Latest Haiku".
    if (!own.model && m) row.model = m.family ? latestOf(m.family) : m.value;
    if (!own.style) row.style = style;
    if (Object.keys(row).length) out[job] = row;
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

/** "today at 9:12" / "yesterday at 9:12" / "Nov 3 at 9:12". */
export function whenText(ms, now = Date.now()) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (x) => new Date(x).toDateString();
  if (day(ms) === day(now)) return `today at ${time}`;
  if (day(ms) === day(now - 86400000)) return `yesterday at ${time}`;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${date} at ${time}`;
}

/**
 * The model list's line in Settings › AI: when it was last checked, that it
 * just changed, or why the last check failed (the last good list is kept).
 */
export function listStatusText(status, now = Date.now()) {
  if (!status) return "";
  if (status.error) {
    return status.checkedAt
      ? `Last checked ${whenText(status.checkedAt, now)} · couldn't reach the list`
      : "Couldn't reach the model list · using the one built in";
  }
  if (!status.checkedAt) return "Checking the model list…";
  return status.added && status.added.length
    ? `Model list updated ${whenText(status.checkedAt, now)}`
    : `Model list up to date · checked ${whenText(status.checkedAt, now)}`;
}
