/**
 * BudgetController.js
 *
 * Per-run cost capture and monthly spend limits for bots (PRD US-019 / FR-017).
 * Records each run's token usage as a dollar cost (from the provider registry's
 * per-model pricing), accrues it to bot / workspace / global monthly buckets,
 * and reports status: ok, warn (≥80%), or exceeded (≥100%). A bot that has
 * exceeded any applicable budget is over-budget and should auto-pause; the user
 * may explicitly (and audibly) override to keep it running for the rest of the
 * month.
 *
 * Portable (NFR-006): persistence, pricing lookup, clock, and audit sink are
 * injected. No Electron.
 *
 *   new BudgetController({ persistence, getPricing, clock?, audit? })
 *     persistence: { read(): object, write(obj): void }   // { budgets, spend, overrides }
 *     getPricing:  (providerId, model) => { input, output } | null   // USD per 1M tokens
 *     clock:       () => number (epoch ms)
 *     audit:       (entry) => void
 */
"use strict";

const WARN_AT = 0.8;

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function scopeKey(scope, id) {
  if (scope === "global") return "global";
  if (scope === "workspace") return `workspace:${id}`;
  if (scope === "bot") return `bot:${id}`;
  throw new Error(`BudgetController: unknown scope "${scope}"`);
}

function stateFor(spent, budget) {
  if (!(budget > 0)) return "ok"; // no limit set
  const pct = spent / budget;
  if (pct >= 1) return "exceeded";
  if (pct >= WARN_AT) return "warn";
  return "ok";
}

// Most-restrictive wins.
const RANK = { ok: 0, warn: 1, exceeded: 2 };

class BudgetController {
  constructor({ persistence, getPricing, clock, audit } = {}) {
    if (!persistence || typeof persistence.read !== "function") {
      throw new Error(
        "BudgetController: persistence with read()/write() is required",
      );
    }
    this._persistence = persistence;
    this._getPricing = getPricing || (() => null);
    this._now = clock || (() => Date.now());
    this._audit = audit || (() => {});
  }

  _load() {
    const d = this._persistence.read() || {};
    if (!d.budgets) d.budgets = {};
    if (!d.spend) d.spend = {};
    if (!d.overrides) d.overrides = {};
    return d;
  }

  _save(d) {
    this._persistence.write(d);
  }

  /** Set a monthly USD limit for a scope. @param scope "bot"|"workspace"|"global" */
  setBudget(scope, id, monthlyUsd) {
    const key = scopeKey(scope, id);
    const d = this._load();
    if (monthlyUsd == null) delete d.budgets[key];
    else d.budgets[key] = monthlyUsd;
    this._save(d);
    this._audit({ type: "budget-set", scope: key, monthlyUsd });
    return d.budgets[key];
  }

  /** @returns {object} scopeKey → monthly USD limit */
  getBudgets() {
    return { ...this._load().budgets };
  }

  /**
   * Record a run's usage. Accrues cost to the bot/workspace/global buckets for
   * the current month.
   * @returns {{ cost: number, estimated: boolean, status: object }}
   */
  recordUsage({ botId, workspaceId, providerId, model, usage } = {}) {
    const inTok = (usage && usage.inputTokens) || 0;
    const outTok = (usage && usage.outputTokens) || 0;
    const pricing = this._getPricing(providerId, model);
    let cost = 0;
    let estimated = false;
    if (pricing) {
      cost = (inTok / 1e6) * pricing.input + (outTok / 1e6) * pricing.output;
    } else {
      // Unknown pricing — track tokens only and flag the figure as estimated.
      estimated = true;
    }

    const d = this._load();
    const mk = monthKey(this._now());
    if (!d.spend[mk]) d.spend[mk] = {};

    const keys = [scopeKey("bot", botId), scopeKey("global")];
    if (workspaceId) keys.splice(1, 0, scopeKey("workspace", workspaceId));
    for (const key of keys) {
      const bucket = d.spend[mk][key] || {
        usd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      bucket.usd += cost;
      bucket.inputTokens += inTok;
      bucket.outputTokens += outTok;
      d.spend[mk][key] = bucket;
    }
    this._save(d);

    this._audit({
      type: "usage",
      botId,
      workspaceId,
      cost,
      estimated,
      inTok,
      outTok,
    });
    return { cost, estimated, status: this.status(botId, workspaceId) };
  }

  _spent(mk, key) {
    const d = this._load();
    return (d.spend[mk] && d.spend[mk][key] && d.spend[mk][key].usd) || 0;
  }

  /**
   * Budget status for a bot across its applicable scopes.
   * @returns {{ scopes: object[], overall: "ok"|"warn"|"exceeded" }}
   */
  status(botId, workspaceId) {
    const d = this._load();
    const mk = monthKey(this._now());
    const applicable = [scopeKey("bot", botId)];
    if (workspaceId) applicable.push(scopeKey("workspace", workspaceId));
    applicable.push(scopeKey("global"));

    const scopes = [];
    let overall = "ok";
    for (const key of applicable) {
      const budget = d.budgets[key];
      if (budget == null) continue; // no limit for this scope
      const spent = this._spent(mk, key);
      const state = stateFor(spent, budget);
      scopes.push({ scope: key, spent, budget, pct: spent / budget, state });
      if (RANK[state] > RANK[overall]) overall = state;
    }
    return { scopes, overall };
  }

  /**
   * Whether a bot should be paused for budget. True when any applicable budget
   * is exceeded AND the user hasn't overridden for this month.
   */
  isOverBudget(botId, workspaceId) {
    const mk = monthKey(this._now());
    const d = this._load();
    if (d.overrides[mk] && d.overrides[mk][botId]) return false;
    return this.status(botId, workspaceId).overall === "exceeded";
  }

  /**
   * Explicit, audited override to keep a budget-exceeded bot running for the
   * rest of the current month (US-019 AC6). Cleared automatically next month
   * (overrides are keyed by month).
   */
  resumeOverBudget(botId) {
    const d = this._load();
    const mk = monthKey(this._now());
    if (!d.overrides[mk]) d.overrides[mk] = {};
    d.overrides[mk][botId] = true;
    this._save(d);
    this._audit({ type: "budget-override", botId, month: mk });
    return true;
  }

  /** @returns {object} spend buckets for a month (default current) */
  getSpend(mk) {
    const d = this._load();
    return d.spend[mk || monthKey(this._now())] || {};
  }
}

module.exports = BudgetController;
module.exports.WARN_AT = WARN_AT;
