/**
 * spendingText.js — how bot spending reads in the app (bot-factory US-019):
 * "$1.20 · 14.2k tokens", "15.7k tokens · covered by your Claude plan",
 * "80% of budget". Pure.
 */
import { formatTokens } from "../../utils/runCostLabel";

export const money = (n) => "$" + (Number(n) || 0).toFixed(2);

const PROVIDER_NAMES = {
  "claude-code": "Claude Code",
  anthropic: "Anthropic API",
  openai: "OpenAI",
  xai: "xAI",
};

/** A provider id as people know it. */
export function providerName(id) {
  return PROVIDER_NAMES[id] || id || "Unknown";
}

/**
 * A row's spending this month. Runs a Claude plan covers cost nothing, so
 * they show as tokens.
 * @param {{ usd, tokens, planTokens }} row  spendingSummary row
 */
export function spentLine(row) {
  const r = row || {};
  const usd = Number(r.usd) || 0;
  const tokens = Number(r.tokens) || 0;
  const plan = Number(r.planTokens) || 0;
  if (!usd && !tokens) return "Nothing yet this month";
  if (!usd && plan) {
    return `${formatTokens(tokens)} tokens · covered by your Claude plan`;
  }
  return `${money(usd)} · ${formatTokens(tokens)} tokens`;
}

/** "Over budget" | "80% of budget" | null — a word for where a row stands. */
export function budgetStateLabel(row) {
  if (!row) return null;
  if (row.over || row.state === "exceeded") return "Over budget";
  if (row.state === "warn") return "80% of budget";
  return null;
}

/** "of $5.00 a month" | "No limit" */
export function limitLine(row) {
  return row && typeof row.budget === "number"
    ? `of ${money(row.budget)} a month`
    : "No limit";
}

/** "October 2026" for "2026-10". */
export function monthName(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
  if (!m) return "This month";
  return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
