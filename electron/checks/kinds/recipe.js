/**
 * recipe.js — a check made of dash-check building blocks, kept on the step
 * (DASH-133):
 *
 *   { kind: "recipe", recipe: { name, steps: [
 *       { use: "git.committedSince", with: { base: "{repo.baseBranch}" } },
 *       { expect: "handoff.files", matcher: "toHaveLengthAtLeast", args: [1],
 *         message: "The handoff lists no changed files" } ] } }
 *
 * A recipe holds no code, so it's safe to keep on a bot, travel with a
 * published team and edit in a form. It's checked with the library's
 * validateRecipe when the bot is saved, and runs in Dash's process with the
 * library's own helpers (a repo's own helpers belong in a repo check's
 * .check.json). Its {team settings}, {item.*} and {repo.*} are filled in
 * from the job like any check's (teamValues.withTeamValues), and anything
 * left is filled by the library from the input. It runs in the job's
 * workspace, with a read-only ctx.tool, and gives each step's result in
 * details.
 */
"use strict";

const fs = require("fs");
const { recipeError, runRecipe } = require("../dashCheck");

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** What's wrong with a recipe step's settings, or null. */
function recipeCheckError(check) {
  const c = check || {};
  if (!isObj(c.recipe)) {
    return 'a recipe check needs its recipe: { "name": "…", "steps": [ … ] }';
  }
  const bad = recipeError(c.recipe);
  return bad ? `the recipe isn't valid: ${bad}` : null;
}

function folderOf(input, deps) {
  if (deps.cwd && fs.existsSync(deps.cwd)) return deps.cwd;
  const w = input && input.workspace;
  if (w && typeof w.dir === "string" && w.dir && fs.existsSync(w.dir)) {
    return w.dir;
  }
  return undefined;
}

/**
 * Run a recipe step.
 * @param {{ kind: "recipe", recipe: object }} check
 * @param {object} input  the standard input
 * @param {{ cwd?: string, env?: object, callTool?, isReadOnly?,
 *           selfTest?: boolean, fetch?, now?, sleep? }} deps
 */
async function runRecipeCheck(check, input, deps = {}) {
  const bad = recipeCheckError(check);
  if (bad) return { pass: false, reason: `This check can't run: ${bad}` };
  const recipe = check.recipe;
  const steps = recipe.steps;
  // A self-test (DASH-109) opens no PR: GitHub steps have nothing to see.
  const only = deps.selfTest
    ? steps
        .map((s, i) =>
          s && typeof s.use === "string" && s.use.startsWith("github.")
            ? null
            : i,
        )
        .filter((i) => i !== null)
    : null;
  return runRecipe(recipe, input, {
    cwd: folderOf(input, deps),
    env: deps.env,
    ...(deps.callTool ? { callTool: deps.callTool } : {}),
    ...(deps.isReadOnly ? { isReadOnly: deps.isReadOnly } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    ...(only && only.length < steps.length ? { only } : {}),
    extra: { recipe: recipe.name },
  });
}

module.exports = { recipeCheckError, runRecipeCheck };
