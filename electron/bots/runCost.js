/**
 * runCost — what a bot run cost, one rule for the run record and the monthly
 * totals (create-entry PRD CRE-012 AC4/AC5).
 *
 *   API key runs     dollars from the model's price list — input, output,
 *                    cache reads at 0.1× and cache writes at 1.25× the input
 *                    price (Anthropic's prompt-caching pricing)
 *   Claude Code runs included in the user's Claude plan: $0 against budgets,
 *                    tokens kept, plus what it would have cost on the API
 *                    ("equivalentUsd", the SDK's own figure when it reports
 *                    one)
 *   unknown price    tokens only, flagged estimated (OpenAI / xAI have no
 *                    curated price list)
 */

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

// Providers whose runs are covered by a subscription, not billed per token.
const PLAN_PROVIDERS = new Set(["claude-code"]);

const num = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : 0);

/** Usage with every count present (missing → 0). */
function normalizeUsage(usage) {
  const u = usage || {};
  return {
    inputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    cacheReadTokens: num(u.cacheReadTokens),
    cacheWriteTokens: num(u.cacheWriteTokens),
  };
}

/** Two usages added (for multi-turn runs). Either may be null. */
function addUsage(a, b) {
  if (!a && !b) return null;
  const x = normalizeUsage(a);
  const y = normalizeUsage(b);
  return {
    inputTokens: x.inputTokens + y.inputTokens,
    outputTokens: x.outputTokens + y.outputTokens,
    cacheReadTokens: x.cacheReadTokens + y.cacheReadTokens,
    cacheWriteTokens: x.cacheWriteTokens + y.cacheWriteTokens,
  };
}

/** Every token the run used. */
function totalTokens(usage) {
  const u = normalizeUsage(usage);
  return (
    u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens
  );
}

/** USD at a price list ({ input, output } per 1M tokens), or null. */
function usdAt(usage, pricing) {
  if (
    !pricing ||
    typeof pricing.input !== "number" ||
    typeof pricing.output !== "number"
  ) {
    return null;
  }
  const u = normalizeUsage(usage);
  return (
    (u.inputTokens / 1e6) * pricing.input +
    (u.cacheReadTokens / 1e6) * pricing.input * CACHE_READ_MULTIPLIER +
    (u.cacheWriteTokens / 1e6) * pricing.input * CACHE_WRITE_MULTIPLIER +
    (u.outputTokens / 1e6) * pricing.output
  );
}

/**
 * @param {object} args
 * @param {string} args.providerId     the run's provider ("claude-code", "anthropic", …)
 * @param {object} args.usage          { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, reportedUsd? }
 * @param {object|null} args.pricing   the model's { input, output } per 1M tokens
 * @returns {{ usd: number, includedInPlan: boolean, estimated: boolean, equivalentUsd: number|null }}
 */
function runCost({ providerId, usage, pricing = null } = {}) {
  const reported =
    usage && typeof usage.reportedUsd === "number" && usage.reportedUsd >= 0
      ? usage.reportedUsd
      : null;
  const atPrice = usdAt(usage, pricing);
  if (PLAN_PROVIDERS.has(providerId)) {
    return {
      usd: 0,
      includedInPlan: true,
      estimated: false,
      equivalentUsd: reported != null ? reported : atPrice,
    };
  }
  if (atPrice == null) {
    return {
      usd: 0,
      includedInPlan: false,
      estimated: true,
      equivalentUsd: null,
    };
  }
  return {
    usd: atPrice,
    includedInPlan: false,
    estimated: false,
    equivalentUsd: atPrice,
  };
}

module.exports = {
  runCost,
  normalizeUsage,
  addUsage,
  totalTokens,
  usdAt,
  PLAN_PROVIDERS,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
};
