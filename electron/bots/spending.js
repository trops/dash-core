/**
 * spending.js — this month's bot spending, for the Spending view and the
 * budget fields (bot-factory US-019 AC2/AC5): by bot, by dashboard, by AI
 * provider, and overall, each with its limit and where it stands.
 *
 * Pure (NFR-006): the controller passes the budget data, bots and dashboards.
 */
"use strict";

const WARN_AT = 0.8;

/** "ok" | "warn" | "exceeded" — like BudgetController, from dollars. */
function stateOf(usd, budget) {
  if (!(budget > 0)) return "ok";
  const pct = usd / budget;
  if (pct >= 1) return "exceeded";
  if (pct >= WARN_AT) return "warn";
  return "ok";
}

/** One bucket as a row: dollars, tokens, plan tokens, limit, state. */
function rowOf(spend, budgets, key) {
  const b = (spend && spend[key]) || {};
  const budget =
    budgets && typeof budgets[key] === "number" ? budgets[key] : null;
  const usd = b.usd || 0;
  return {
    usd,
    tokens: (b.inputTokens || 0) + (b.outputTokens || 0) + (b.cacheTokens || 0),
    planTokens: b.planTokens || 0,
    budget,
    state: stateOf(usd, budget),
  };
}

const hasActivity = (r) => r.usd > 0 || r.tokens > 0 || r.budget !== null;

/**
 * @param {{ month: string, spend: object, budgets: object,
 *   bots: object[], workspaces: object[],
 *   isOver: (botId: string, workspaceId: any) => boolean }} args
 *   spend — this month's buckets (BudgetController.getSpend())
 * @returns {{ month, overall, bots, dashboards, providers }}
 *   bots: every user bot; dashboards and providers: those with spending or
 *   a limit
 */
function summarizeSpending({
  month,
  spend = {},
  budgets = {},
  bots = [],
  workspaces = [],
  isOver = () => false,
}) {
  const byUsd = (a, b) =>
    b.usd - a.usd || b.tokens - a.tokens || a.name.localeCompare(b.name);
  const botRows = (bots || [])
    .filter((b) => b && b.id)
    .map((b) => ({
      id: b.id,
      name: b.name || b.id,
      workspaceId:
        b.workspaceId === null || b.workspaceId === undefined
          ? null
          : String(b.workspaceId),
      over: !!isOver(b.id, b.workspaceId),
      ...rowOf(spend, budgets, `bot:${b.id}`),
    }))
    .sort(byUsd);
  const dashboards = (workspaces || [])
    .filter((w) => w && w.id !== undefined && w.id !== null)
    .map((w) => ({
      id: String(w.id),
      name: w.name || w.label || `Dashboard ${w.id}`,
      ...rowOf(spend, budgets, `workspace:${w.id}`),
    }))
    .filter(hasActivity)
    .sort(byUsd);
  const providers = Object.keys(spend || {})
    .filter((k) => k.startsWith("provider:"))
    .map((k) => ({
      id: k.slice("provider:".length),
      name: k.slice("provider:".length),
      ...rowOf(spend, budgets, k),
    }))
    .sort(byUsd);
  return {
    month,
    overall: rowOf(spend, budgets, "global"),
    bots: botRows,
    dashboards,
    providers,
  };
}

module.exports = { summarizeSpending, stateOf };
