/**
 * helper.js — one @trops/dash-check helper as a check, set with no code
 * (DASH-160):
 *
 *   { kind: "helper", use: "git.changesMatchPlan",
 *     with?: { planKeys: "files, tests", alsoAllow: "CHANGELOG.md" },
 *     handoffFrom?: "answer" | "handed", message?, label? }
 *
 * It's a one-step recipe (checks/kinds/recipe.js): the same validation
 * when the bot is saved, the same {team settings}, {item.*} and {repo.*}
 * filled into `with`, the same run in the job's workspace. The library's
 * own helpers only (a repo's own helpers belong in a repo check).
 *
 * handoffFrom "handed": the helper reads the handoff this bot was handed
 * (the last bot before it in the job that ended with one, e.g. the
 * Planner's) instead of its own answer's. So a Coder's
 * git.changesMatchPlan checks its changes against the Planner's "files"
 * and "tests", and the Coder can't widen its own plan.
 *
 * FACTORY_HELPERS are the helpers offered for it (Bots › Checks and the
 * guides): did the bot do only what it planned (dash-check's "Factory
 * checks"). Any other library helper works too.
 */
"use strict";

const { recipeError, isBuiltInHelper, core } = require("../dashCheck");
const { runRecipeCheck } = require("./recipe");

const FACTORY_HELPERS = [
  "git.validateLeavesTreeClean",
  "git.changesMatchPlan",
  "git.commitsScoped",
  "git.noChangesTo",
  "node.lockfileExplained",
  "git.sourceHasTests",
  "node.newTestsAreRun",
  "git.noNewMatches",
  "files.maxGrowth",
  "node.testScriptIsReal",
];
const HANDOFF_FROM = ["answer", "handed"];
const MAX_TEXT = 300;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** The helper's metadata ({ id, label, params, … }), or null. */
function helperInfo(id) {
  if (!str(id) || !isBuiltInHelper(str(id))) return null;
  return core()
    .listHelpers()
    .find((h) => h.id === str(id));
}

/** The check as the one-step recipe it runs. */
function asRecipe(check) {
  const c = check || {};
  const use = str(c.use);
  const info = helperInfo(use);
  const step = { use };
  if (c.with !== undefined) step.with = c.with;
  if (str(c.message)) step.message = str(c.message);
  if (str(c.label)) step.label = str(c.label);
  return {
    name: str(c.label) || (info && info.label) || use,
    steps: [step],
  };
}

/** What's wrong with a helper step's settings, or null. */
function helperCheckError(check) {
  const c = check || {};
  const use = str(c.use);
  if (!use) {
    return `a helper check names its helper in "use", e.g. "git.changesMatchPlan" (one of ${FACTORY_HELPERS.join(", ")})`;
  }
  if (!isBuiltInHelper(use)) {
    return `"${use.slice(0, 80)}" isn't one of @trops/dash-check's helpers (list_check_helpers lists them)`;
  }
  if (c.with !== undefined && !isObj(c.with)) {
    return "a helper check's with must be an object of its params";
  }
  if (c.handoffFrom !== undefined && !HANDOFF_FROM.includes(c.handoffFrom)) {
    return `handoffFrom must be ${HANDOFF_FROM.join(" or ")}`;
  }
  for (const k of ["message", "label"]) {
    if (c[k] !== undefined && typeof c[k] !== "string") {
      return `a helper check's ${k} must be text`;
    }
    if (typeof c[k] === "string" && c[k].length > MAX_TEXT) {
      return `a helper check's ${k} is too long (at most ${MAX_TEXT} characters)`;
    }
  }
  const bad = recipeError(asRecipe(c));
  return bad ? bad.replace(/^steps\[0\]\.?/, "").replace(/^: /, "") : null;
}

/**
 * The input the helper sees: the job's, with the handoff it was handed in
 * place of its own when handoffFrom is "handed" (or an error).
 */
function inputFor(check, input) {
  if (check.handoffFrom !== "handed") return { input };
  const h = input && input.handedOn;
  if (!h || !isObj(h.handoff)) {
    return {
      error:
        "This bot wasn't handed a handoff in this job (handoffFrom: handed reads the one the bot before it ended with)",
    };
  }
  return { input: { ...input, handoff: { ...h.handoff } }, from: h.from };
}

/**
 * Run a helper step.
 * @param {{ kind: "helper", use: string, with?: object,
 *           handoffFrom?: "answer"|"handed", message?, label? }} check
 * @param {object} input  the standard input (with handedOn, when it had one)
 * @param {object} deps   as a recipe step's (checks/kinds/recipe.js)
 */
async function runHelperCheck(check, input, deps = {}) {
  const bad = helperCheckError(check);
  if (bad) return { pass: false, reason: `This check can't run: ${bad}` };
  const got = inputFor(check, input);
  if (got.error) return { pass: false, reason: got.error };
  const res = await runRecipeCheck(
    { kind: "recipe", recipe: asRecipe(check) },
    got.input,
    deps,
  );
  const details = isObj(res.details) ? { ...res.details } : {};
  delete details.recipe;
  return {
    ...res,
    details: {
      helper: str(check.use),
      ...(check.handoffFrom === "handed"
        ? { handoffFrom: got.from || "the bot before it" }
        : {}),
      ...details,
    },
  };
}

module.exports = {
  FACTORY_HELPERS,
  HANDOFF_FROM,
  helperCheckError,
  runHelperCheck,
  asRecipe,
  helperInfo,
};
