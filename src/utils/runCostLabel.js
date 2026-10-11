/**
 * How a bot run's model, tokens and cost read in the app (create-entry PRD
 * CRE-012 AC4/AC5): dollars for API-key runs, tokens "included in your
 * plan" for Claude Code runs, tokens only when the price is unknown. Runs
 * recorded before costs were kept show tokens only.
 */

const FAMILIES = [
  [/opus/i, "Opus"],
  [/sonnet/i, "Sonnet"],
  [/haiku/i, "Haiku"],
  [/fable/i, "Fable"],
];

/** "claude-sonnet-4-6" → "Sonnet"; unknown ids as they are. */
export function modelLabel(model) {
  if (!model) return null;
  const hit = FAMILIES.find(([re]) => re.test(model));
  return hit ? hit[1] : String(model);
}

/** 950 → "950" · 14230 → "14.2k" · 2400000 → "2.4M". */
export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

/** Every token in a usage object (cache included). */
export function usageTokens(usage) {
  const u = usage || {};
  return (
    (Number(u.inputTokens) || 0) +
    (Number(u.outputTokens) || 0) +
    (Number(u.cacheReadTokens) || 0) +
    (Number(u.cacheWriteTokens) || 0)
  );
}

function dollars(usd) {
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

/** The full line for a run: "Sonnet · 14.2k tokens · $0.06". */
export function runCostLabel(run) {
  if (!run) return "";
  const parts = [];
  const model = modelLabel(run.model);
  if (model) parts.push(model);
  const tokens = usageTokens(run.usage);
  if (tokens > 0) parts.push(`${formatTokens(tokens)} tokens`);
  const c = run.cost;
  if (c && c.includedInPlan) parts.push("included in your plan");
  else if (c && !c.estimated && typeof c.usd === "number") {
    parts.push(dollars(c.usd));
  }
  return parts.join(" · ");
}

/** The short form for a run row: "$0.06", or "14.2k tok" for plan / unknown. */
export function runCostShort(run) {
  if (!run) return "";
  const c = run.cost;
  if (c && !c.includedInPlan && !c.estimated && typeof c.usd === "number") {
    return dollars(c.usd);
  }
  const tokens = usageTokens(run.usage);
  return tokens > 0 ? `${formatTokens(tokens)} tok` : "";
}

/**
 * A bot's spend this month, from bots.getSpend() buckets (`bot:<id>`):
 *   "$1.20 this month" · "48.0k tokens · included in your plan" ·
 *   "$1.20 + 48.0k plan tokens this month" · "No runs this month"
 */
export function formatMonthCost(spend, botId) {
  const b = spend && spend[`bot:${botId}`];
  if (!b) return "No runs this month";
  const usd = Number(b.usd) || 0;
  const planTokens = Number(b.planTokens) || 0;
  if (usd > 0 && planTokens > 0) {
    return `${dollars(usd)} + ${formatTokens(planTokens)} plan tokens this month`;
  }
  if (usd > 0) return `${dollars(usd)} this month`;
  if (planTokens > 0) {
    return `${formatTokens(planTokens)} tokens · included in your plan`;
  }
  const tokens =
    (Number(b.inputTokens) || 0) +
    (Number(b.outputTokens) || 0) +
    (Number(b.cacheTokens) || 0);
  if (tokens > 0) return `${formatTokens(tokens)} tokens this month`;
  return "No runs this month";
}
