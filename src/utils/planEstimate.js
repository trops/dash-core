/**
 * planEstimate — what building a Dash team plan should cost (create-entry
 * PRD CRE-012 AC1/AC2, phase 4a): tokens by role and model, plus what the
 * planning has already used.
 *
 * Fixed per-step figures for now (PRD open question 3: calibrate from the
 * user's actual runs later). Roughly what the live test runs used:
 *   new widget   Builder writes + builds it, Checker checks it
 *   update       Builder changes it, Checker checks it
 *   registry     nothing to write; Checker tries it after install
 *   bot          Builder drafts it
 *   layout       Builder places the pieces
 */
import { modelLabel, formatTokens } from "./runCostLabel";

export const STEP_TOKENS = {
  widget: {
    new: { builder: 20000, checker: 6000 },
    update: { builder: 15000, checker: 6000 },
    "ai-built": { builder: 0, checker: 0 },
    yours: { builder: 0, checker: 0 },
    registry: { builder: 0, checker: 4000 },
  },
  bot: { builder: 4000, checker: 0 },
  layout: { builder: 3000, checker: 0 },
};

// A rough API price per token by model family when the role runs on an API
// key (mostly input): Sonnet ~$5.4 / 1M, Opus ~$9 / 1M, Haiku ~$1.8 / 1M.
const USD_PER_TOKEN = { Opus: 9e-6, Sonnet: 5.4e-6, Haiku: 1.8e-6 };

function stepsFor(piece) {
  if (!piece) return { builder: 0, checker: 0 };
  if (piece.kind === "widget") {
    return STEP_TOKENS.widget[piece.source] || STEP_TOKENS.widget.new;
  }
  return STEP_TOKENS[piece.kind] || { builder: 0, checker: 0 };
}

/**
 * @param {object} plan  a validated plan
 * @param {object} [opts]
 *   team: listDashTeam() rows ({ role, runsOn, providerId }) — models and
 *         whether the role runs on the user's Claude plan
 *   planningTokens: tokens the Planner (and its hand-offs) used so far
 * @returns {{ total: number, roles: [{ role, model, tokens }],
 *   planningTokens: number, includedInPlan: boolean, usd: number|null }}
 */
export function estimatePlan(plan, { team = [], planningTokens = 0 } = {}) {
  const pieces = (plan && Array.isArray(plan.pieces) && plan.pieces) || [];
  const sums = { builder: 0, checker: 0 };
  for (const p of pieces) {
    const s = stepsFor(p);
    sums.builder += s.builder;
    sums.checker += s.checker;
  }
  const info = (role) => team.find((b) => b && b.role === role) || {};
  const roles = ["builder", "checker"]
    .filter((role) => sums[role] > 0)
    .map((role) => ({
      role,
      model: modelLabel(info(role).runsOn) || null,
      tokens: sums[role],
    }));
  const buildTokens = sums.builder + sums.checker;
  const builder = info("builder");
  const includedInPlan =
    !builder.providerId || builder.providerId === "claude-code";
  const usd = includedInPlan
    ? null
    : roles.reduce(
        (n, r) =>
          n + r.tokens * (USD_PER_TOKEN[r.model] || USD_PER_TOKEN.Sonnet),
        0,
      );
  return {
    total: buildTokens + (Number(planningTokens) || 0),
    roles,
    planningTokens: Number(planningTokens) || 0,
    includedInPlan,
    usd,
  };
}

/** "~30k tokens — Builder (Sonnet) ~20k · Checker (Sonnet) ~6k · planning so far 6.3k" */
export function describeEstimate(est) {
  if (!est) return "";
  const parts = est.roles.map(
    (r) =>
      `${r.role.charAt(0).toUpperCase()}${r.role.slice(1)}${
        r.model ? ` (${r.model})` : ""
      } ~${formatTokens(r.tokens)}`,
  );
  if (est.planningTokens) {
    parts.push(`planning so far ${formatTokens(est.planningTokens)}`);
  }
  const head =
    est.total > 0 ? `~${formatTokens(est.total)} tokens` : "Nothing to build";
  const cost = est.includedInPlan
    ? "included in your plan"
    : est.usd != null
      ? `about $${est.usd.toFixed(2)}`
      : "";
  return [
    [head, parts.length ? `— ${parts.join(" · ")}` : ""]
      .filter(Boolean)
      .join(" "),
    cost,
  ]
    .filter(Boolean)
    .join(" · ");
}
