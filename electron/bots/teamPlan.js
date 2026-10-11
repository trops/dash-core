/**
 * teamPlan.js
 *
 * The Dash team's plan (create-entry PRD CRE-002 / CRE-012, scenarios G11):
 * what the Planner hands back before anything is built. The Create screen
 * will show it (phase 4); defined now so the Planner's output can be checked
 * by tests and by the app.
 *
 *   {
 *     summary:   "A widget with your unread Gmail count",
 *     questions: [{ question, options?: [string] }],       // for the user
 *     pieces:    [{ kind: "widget" | "bot" | "layout",
 *                   name,
 *                   source: "yours" | "ai-built" | "registry" | "new" | "update",
 *                   package?,        // yours / ai-built / registry / update
 *                   providers?: [type],
 *                   notes? }],
 *     beforeBuilding: [{ kind: "connect" | "install" | "approve", what }],
 *     checks:    [string],                                 // how to tell it worked
 *     estimate:  { build: string, running?: string|null }
 *   }
 *
 * The Planner ends its answer with the plan as JSON inside <plan></plan>.
 * Pure (NFR-006).
 */
"use strict";

const KINDS = ["widget", "bot", "layout"];
const SOURCES = ["yours", "ai-built", "registry", "new", "update"];
const BEFORE_KINDS = ["connect", "install", "approve"];
// Pieces that already exist somewhere and so must say which package.
const NEEDS_PACKAGE = new Set(["yours", "ai-built", "registry", "update"]);

const isStr = (v) => typeof v === "string" && v.trim().length > 0;

/** The plan inside a Planner answer's <plan>…</plan>, or null. */
function extractPlan(text) {
  const m = /<plan>([\s\S]*?)<\/plan>/i.exec(String(text || ""));
  if (!m) return null;
  const body = m[1].trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(body);
  } catch (_e) {
    return null;
  }
}

/**
 * Check a plan's shape and its promises.
 * @param {object} plan
 * @param {{ providers?: string[] }} [context]  the user's provider types —
 *   a piece needing one they don't have must list it under beforeBuilding.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validatePlan(plan, context = {}) {
  const errors = [];
  const warnings = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { valid: false, errors: ["The plan isn't an object."], warnings };
  }
  if (!isStr(plan.summary)) errors.push("summary is missing.");

  const questions = plan.questions === undefined ? [] : plan.questions;
  if (!Array.isArray(questions)) errors.push("questions must be a list.");
  else {
    questions.forEach((q, i) => {
      if (!q || !isStr(q.question))
        errors.push(`questions[${i}] has no question.`);
      if (q && q.options !== undefined && !Array.isArray(q.options)) {
        errors.push(`questions[${i}].options must be a list.`);
      }
    });
  }

  const pieces = plan.pieces === undefined ? [] : plan.pieces;
  if (!Array.isArray(pieces)) errors.push("pieces must be a list.");
  else if (!pieces.length && !(Array.isArray(questions) && questions.length)) {
    errors.push("A plan needs pieces, or questions to ask first.");
  }

  const before = plan.beforeBuilding === undefined ? [] : plan.beforeBuilding;
  if (!Array.isArray(before)) errors.push("beforeBuilding must be a list.");
  else {
    before.forEach((b, i) => {
      if (!b || !BEFORE_KINDS.includes(b.kind)) {
        errors.push(
          `beforeBuilding[${i}].kind must be one of ${BEFORE_KINDS.join(", ")}.`,
        );
      }
      if (!b || !isStr(b.what))
        errors.push(`beforeBuilding[${i}] has no what.`);
    });
  }
  const beforeText = (Array.isArray(before) ? before : [])
    .map((b) => `${b && b.kind} ${b && b.what}`.toLowerCase())
    .join(" | ");

  const have = new Set(
    (context.providers || []).map((p) => String(p).toLowerCase()),
  );
  if (Array.isArray(pieces)) {
    pieces.forEach((p, i) => {
      const at = `pieces[${i}]`;
      if (!p || typeof p !== "object") {
        errors.push(`${at} isn't an object.`);
        return;
      }
      if (!KINDS.includes(p.kind)) {
        errors.push(`${at}.kind must be one of ${KINDS.join(", ")}.`);
      }
      if (!isStr(p.name)) errors.push(`${at} has no name.`);
      if (!SOURCES.includes(p.source)) {
        errors.push(`${at}.source must be one of ${SOURCES.join(", ")}.`);
      } else if (NEEDS_PACKAGE.has(p.source) && p.kind === "widget") {
        if (!isStr(p.package)) {
          errors.push(`${at} (${p.source}) must say which package.`);
        }
      }
      if (p.providers !== undefined && !Array.isArray(p.providers)) {
        errors.push(`${at}.providers must be a list.`);
      }
      // A registry widget is installed first — the user approves it.
      if (
        p.source === "registry" &&
        isStr(p.package) &&
        !beforeText.includes("install")
      ) {
        warnings.push(
          `${at} comes from the registry, but beforeBuilding doesn't list installing it.`,
        );
      }
      // Providers the user doesn't have must be connected first.
      if (have.size && Array.isArray(p.providers)) {
        for (const type of p.providers) {
          const t = String(type).toLowerCase();
          if (!have.has(t) && !beforeText.includes(t)) {
            errors.push(
              `${at} needs ${type}, which isn't connected — add it to beforeBuilding.`,
            );
          }
        }
      }
    });
  }

  if (plan.checks !== undefined && !Array.isArray(plan.checks)) {
    errors.push("checks must be a list.");
  } else if (
    Array.isArray(pieces) &&
    pieces.some((p) => p && ["new", "update"].includes(p.source)) &&
    !(plan.checks || []).length
  ) {
    warnings.push("Something gets built, but there are no checks.");
  }

  if (!plan.estimate || !isStr(plan.estimate.build)) {
    errors.push("estimate.build is missing.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = {
  KINDS,
  SOURCES,
  BEFORE_KINDS,
  extractPlan,
  validatePlan,
};
