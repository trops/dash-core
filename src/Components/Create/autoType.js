/**
 * autoType.js — Type: Auto (create-entry PRD CRE-001 AC3, phase 5c): what to
 * make from a description. One short AI question; a keyword guess when
 * there's no AI or it fails.
 */
import { aiOnce, firstJson } from "../../utils/aiOnce";

export const AUTO_TYPES = ["widget", "bot", "dashboard", "theme"];

/** What Auto says it picked: "a widget, picked by Auto" (QA 2026-10-22). */
export function autoPickLabel(pick) {
  const how = pick && pick.by === "ai" ? "picked" : "guessed";
  const type = pick && AUTO_TYPES.includes(pick.type) ? pick.type : null;
  return type ? `a ${type}, ${how} by Auto` : `${how} by Auto`;
}

export const AUTO_SYSTEM = `You sort requests in Dash, a desktop dashboard app, into what to make. Answer with JSON only: {"type": "widget" | "bot" | "dashboard" | "theme", "why": "<one short sentence>"}.
- widget: one panel that shows or does one thing (a chart, a list, a clock, a button).
- bot: something that works on its own — on a schedule or when something happens — e.g. "every morning summarize my email", "when a PR opens, review it".
- dashboard: several things together, or widgets plus bots ("a morning brief with my calendar, unread mail and a bot that…") — and any change to a dashboard the user already has: adding a widget or bot to it, or switching its theme ("add a clock to my Sales dashboard", "switch Sales to the Nordic theme").
- theme: making a new theme — colors or the look of the app.`;

/** The system prompt, with the user's dashboards named (5e-2b). */
export function autoSystem(dashboards = []) {
  const names = (dashboards || []).filter(Boolean);
  return names.length
    ? `${AUTO_SYSTEM}\nThe user's dashboards: ${names.join(", ")}.`
    : AUTO_SYSTEM;
}

const escapeRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The dashboard a request names, if any (whole words, any case). */
export function namedDashboard(prompt, dashboards = []) {
  const p = String(prompt || "");
  return (
    (dashboards || [])
      .filter((n) => n && String(n).trim().length > 1)
      .sort((a, b) => String(b).length - String(a).length)
      .find((n) =>
        new RegExp(`(^|\\W)${escapeRe(String(n).trim())}(\\W|$)`, "i").test(p),
      ) || null
  );
}

const WORDS = {
  theme: /\b(theme|colou?rs?|palette|look and feel|dark mode|light mode)\b/i,
  dashboard: /\b(dashboard|several|overview|morning brief|command center)\b/i,
  bot: /\b(bot|every (day|morning|evening|hour|week|monday)|daily|weekly|each (day|morning)|whenever|when .* (arrives|opens|happens|changes)|automatically|remind me)\b/i,
};

/**
 * A keyword guess: a change to a dashboard the user names, then theme,
 * dashboard, bot, else widget.
 */
export function guessType(prompt, dashboards = []) {
  const p = String(prompt || "");
  if (namedDashboard(p, dashboards)) return "dashboard";
  for (const t of ["theme", "dashboard", "bot"]) {
    if (WORDS[t].test(p)) return t;
  }
  return "widget";
}

/** { type, why } from the AI's answer, or null. */
export function parseAutoAnswer(text) {
  const j = firstJson(text);
  if (!j || !AUTO_TYPES.includes(String(j.type || "").toLowerCase())) {
    return null;
  }
  return {
    type: String(j.type).toLowerCase(),
    why: String(j.why || "")
      .trim()
      .slice(0, 200),
  };
}

/**
 * What to make: { type, why, by: "ai" | "guess" }.
 * @param {string} prompt
 * @param {{ backend, providers, dashboards?: string[], ask? }} opts
 *   dashboards = the user's dashboard names; ask = aiOnce (for tests)
 */
export async function pickType(
  prompt,
  { backend, providers, dashboards = [], ask = aiOnce } = {},
) {
  if (backend) {
    try {
      const answer = await ask({
        system: autoSystem(dashboards),
        prompt: String(prompt || ""),
        backend,
        providers,
      });
      const parsed = parseAutoAnswer(answer);
      if (parsed) return { ...parsed, by: "ai" };
    } catch (_e) {
      // fall through to the guess
    }
  }
  return { type: guessType(prompt, dashboards), why: "", by: "guess" };
}
