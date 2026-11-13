/**
 * modelRunLabel.js — which model ran it, in words (lead workspace: "Which
 * model ran it"): "Opus 5.5 · Thorough", why that model, and how long it
 * took. Pure.
 */

const FAMILY = "(opus|sonnet|haiku|fable)";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * "claude-opus-5-5" → "Opus 5.5" · "claude-sonnet-4-5-20250929" →
 * "Sonnet 4.5" · "claude-opus-4-20250514" → "Opus 4" ·
 * "claude-3-5-sonnet-20241022" → "Sonnet 3.5". Anything else as it is.
 */
export function modelName(id) {
  const s = String(id || "").trim();
  if (!s) return null;
  // The older ids put the version first.
  const old = new RegExp(`claude-(\\d+)(?:-(\\d))?-${FAMILY}`, "i").exec(s);
  if (old) return `${cap(old[3])} ${old[1]}${old[2] ? `.${old[2]}` : ""}`;
  const now = new RegExp(
    `${FAMILY}-(\\d{1,2})(?:-(\\d{1,2}))?(?!\\d)`,
    "i",
  ).exec(s);
  if (now) return `${cap(now[1])} ${now[2]}${now[3] ? `.${now[3]}` : ""}`;
  return s;
}

/** "thorough" → "Thorough"; nothing for none. */
export function styleName(style) {
  const s = String(style || "").trim();
  return s ? cap(s) : null;
}

/** "Opus 5.5 · Thorough" — or "" when the model isn't known. */
export function runModelLabel(run) {
  const model = modelName(run && run.model);
  if (!model) return "";
  const style = styleName(run && run.style);
  return style ? `${model} · ${style}` : model;
}

// Settings › AI's job for each role (aiSettingsText JOB_ROWS).
const JOB_NAMES = {
  planner: "Create · Planner",
  builder: "Create · Builder",
  checker: "Create · Checker",
  scout: "Create · Scout",
  dashlead: "Dash Lead",
  lead: "Dashboard leads",
};
const ROLE_NAMES = {
  planner: "Planner",
  builder: "Builder",
  checker: "Checker",
  scout: "Scout",
  dashlead: "Dash Lead",
  lead: "dashboard's lead",
};

/**
 * Why it ran on that model: "Your choice for Create · Builder in Settings ›
 * AI", or "Built in for the Builder".
 */
export function whyModel(role, chosen) {
  const r = String(role || "").toLowerCase();
  if (chosen) {
    return JOB_NAMES[r]
      ? `Your choice for ${JOB_NAMES[r]} in Settings › AI`
      : "Your choice in Settings › AI";
  }
  return ROLE_NAMES[r] ? `Built in for the ${ROLE_NAMES[r]}` : "Built in";
}

/** 134000 → "2 min 14 s" · 9000 → "9 s"; nothing for none. */
export function tookText(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s <= 0) return null;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (!m) return `${rest} s`;
  return rest ? `${m} min ${rest} s` : `${m} min`;
}
