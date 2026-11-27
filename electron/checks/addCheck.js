/**
 * addCheck.js — the Add check screen's work (DASH-110), pure apart from
 * what it's given:
 *
 *   suggestChecks   checks ranked for a bot: its repo's own (.dash/checks),
 *                   Dash's built-in kinds and its packages, each a step
 *                   ready to add, inputs filled from the team's settings
 *   draftPrompt     what the team's lead is asked, to write a check from a
 *                   description (with the checks guide and the helpers'
 *                   palette): a dash-check recipe (DASH-133), not a script
 *   parseDraft      its answer: the recipe (validated with validateRecipe;
 *                   one that isn't valid is refused with its errors) as
 *                   .dash/checks/<name>.check.json, a plain summary, a bad
 *                   sample
 *   tryDraft        a draft must pass on a good input and fail, saying
 *                   why, on a bad one before it can be saved
 *   draftRepoChecks "Set up checks": setup and validate from a repo's
 *                   lockfile, package.json scripts and CI workflows
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { runPackageFiles } = require("./kinds/package");
const { CHECKS_GUIDE } = require("../mcp/checksGuide");
const {
  recipeLib,
  recipeError,
  builtInPalette,
  builtInHelper,
  runRecipe,
} = require("./dashCheck");

const FILE_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(\.(sh|js|cjs|mjs|py)|\.check\.json)$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** A check's name from its file: validate.check.json, validate.sh → validate. */
function checkNameOf(file) {
  return String(file || "").replace(/(\.check)?\.[^.]+$/, "");
}

/** The palette in a few lines, for the lead: each helper and matcher. */
function paletteText() {
  const { helpers, matchers } = builtInPalette();
  const param = ([k, p]) =>
    `${k}${p.required ? "" : "?"}: ${p.type}${p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : ""}`;
  return [
    "Helpers (use):",
    ...helpers.map(
      (h) =>
        `- ${h.id}(${Object.entries(h.params || {})
          .map(param)
          .join(
            ", ",
          )}): ${h.label}${h.description ? `. ${h.description}` : ""}`,
    ),
    "Matchers (expect):",
    ...matchers.map(
      (m) =>
        `- ${m.id}(${(m.params || []).map((p) => `${p.name}: ${p.type}`).join(", ")}): ${m.sentence}`,
    ),
  ].join("\n");
}

// What a bot's words say it does, and the checks that prove that kind of work.
const ROLES = [
  {
    re: /\b(code|coder|implement|commit|fix)\b/i,
    want: ["validate", "tests", "git-committed", "node-tests-pass"],
  },
  {
    re: /\b(workspace|clone|branch|setup|set up)\b/i,
    want: ["setup", "git-on-branch"],
  },
  {
    re: /\b(plan|planner|triage)\b/i,
    want: ["plan", "plan-has-sections", "handoff-has"],
  },
  {
    re: /\b(pull request|pr bot|open a pr|create_pull_request)\b/i,
    want: ["pr-ci", "handoff-has"],
  },
  {
    re: /\b(ticket|jira|issue)\b/i,
    want: ["jira-ticket-exists", "github-issue-exists", "handoff-has"],
  },
];

function wantsOf(bot) {
  const text = [bot && bot.name, bot && bot.instructions]
    .filter(Boolean)
    .join("\n");
  const out = [];
  for (const r of ROLES)
    if (r.re.test(text))
      for (const w of r.want) if (!out.includes(w)) out.push(w);
  return out;
}

const has = (bot, pred) =>
  !!(
    bot &&
    bot.checks &&
    Array.isArray(bot.checks.steps) &&
    bot.checks.steps.some(
      (s) => s && s.kind === "check" && s.check && pred(s.check),
    )
  );

/** A team setting that fits an input (same name, or {table.col}). */
function prefill(input, team) {
  const declared = (team && team.declared) || [];
  const direct = declared.find((s) => s && s.name === input.name);
  if (direct) return `{${direct.name}}`;
  for (const t of declared) {
    if (
      t &&
      t.type === "table" &&
      (t.columns || []).some((c) => c && c.name === input.name)
    ) {
      return `{${t.name}.${input.name}}`;
    }
  }
  return undefined;
}

/**
 * Suggested checks for a bot, best first.
 * @param {{ bot, team?, repoChecks?: string[], packages?: object[],
 *           builtIns?: object[] }} p
 * @returns {{ id, label, why, source: "repo"|"built-in"|"dash"|"registry",
 *             step }[]}
 */
function suggestChecks({
  bot,
  team = null,
  repoChecks = [],
  packages = [],
  builtIns = [],
}) {
  const wants = wantsOf(bot);
  const rank = (name) => {
    const i = wants.findIndex((w) => name === w || name.startsWith(w));
    return i === -1 ? 100 : i;
  };
  const out = [];
  for (const name of repoChecks || []) {
    if (has(bot, (c) => c.kind === "repo" && c.name === name)) continue;
    out.push({
      id: `repo:${name}`,
      label: `.dash/checks/${name}`,
      why: "In the repo: the repo's own check, read from its base branch.",
      source: "repo",
      rank: rank(name) - 0.5,
      step: {
        kind: "check",
        name: `${name} passes`,
        check: { kind: "repo", name },
      },
    });
  }
  for (const b of builtIns || []) {
    if (has(bot, (c) => c.kind === b.kind)) continue;
    const check = { kind: b.kind };
    if (b.kind === "git-committed") {
      const base = prefill({ name: "baseBranch" }, team);
      if (base) check.base = base;
    }
    if (b.kind === "pr-ci")
      Object.assign(check, { prKey: "prUrl", timeoutSec: 1200 });
    if (b.kind === "handoff-has") check.keys = ["summary"];
    out.push({
      id: `built-in:${b.kind}`,
      label: b.name,
      why: `Built in: ${b.description}`,
      source: "built-in",
      rank: rank(b.kind),
      step: { kind: "check", name: b.description.replace(/\.$/, ""), check },
    });
  }
  for (const p of packages || []) {
    if (has(bot, (c) => c.kind === "package" && c.package === p.id)) continue;
    const inputs = {};
    for (const i of p.inputs || []) {
      const v = prefill(i, team);
      if (v !== undefined) inputs[i.name] = v;
    }
    out.push({
      id: `package:${p.id}`,
      label: p.id,
      why: `${p.source === "dash" ? "Ships with Dash" : "Registry"}: ${p.description || ""}`.trim(),
      source: p.source === "dash" ? "dash" : "registry",
      rank: rank(p.name),
      step: {
        kind: "check",
        name: p.name,
        check: { kind: "package", package: p.id, inputs },
      },
    });
  }
  return out
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .map(({ rank: _r, ...s }) => s);
}

/** What the lead is asked, to write a check from the user's words. */
function draftPrompt(ask, { bot = null, sample = null } = {}) {
  return [
    `Write a Dash check for ${bot && bot.name ? `the bot "${bot.name}"` : "a bot"}: ${String(ask || "").slice(0, 1500)}`,
    "",
    "Write it as a dash-check recipe (JSON, no code), made only of these helpers and matchers:",
    "",
    paletteText(),
    "",
    "Follow this guide exactly (section 2 is the recipe format):",
    "",
    CHECKS_GUIDE,
    "",
    sample
      ? `A real input it will get (the bot's last run), as JSON:\n${JSON.stringify(sample).slice(0, 6000)}`
      : "There's no real input yet: the input is { input: { answer }, item, workspace } as the guide says.",
    "",
    "Answer with exactly three parts and nothing else:",
    '<recipe name="name">the recipe, { "name": …, "steps": [ … ] }, as JSON</recipe>  (name: letters, numbers, "-" and "_"; it is saved as .dash/checks/name.check.json)',
    "<summary>one or two plain sentences: what it checks, and what it says when it fails</summary>",
    "<bad_sample>a JSON input on which the check must FAIL</bad_sample>",
  ].join("\n");
}

const unfence = (t) => t.replace(/^\s*```[a-z]*\n?|\n?```\s*$/g, "").trim();

/**
 * The lead's answer: { file, code, recipe, summary, badSample } or
 * { error, errors? }. A recipe that isn't valid is refused, with its errors.
 */
function parseDraft(text) {
  const t = String(text || "");
  const c = /<recipe(?:\s+name="([^"]*)")?\s*>([\s\S]*?)<\/recipe>/i.exec(t);
  if (!c) return { error: "The answer has no <recipe> part." };
  let recipe;
  try {
    recipe = JSON.parse(unfence(c[2]));
  } catch (e) {
    return { error: `The recipe isn't JSON: ${e.message}` };
  }
  const v = recipeLib().validateRecipe(recipe, { getHelper: builtInHelper });
  if (!v.valid) {
    return {
      error: `The recipe isn't valid: ${recipeError(recipe)}`,
      errors: v.errors,
      recipe,
    };
  }
  const given = (c[1] || "").trim();
  const name = given || recipeLib().slug(recipe.name);
  if (!NAME_RE.test(name) || name.includes("..")) {
    return {
      error: `"${name}" can't be a check's name (letters, numbers, ".", "-" and "_")`,
    };
  }
  const s = /<summary>([\s\S]*?)<\/summary>/i.exec(t);
  const b = /<bad_sample>([\s\S]*?)<\/bad_sample>/i.exec(t);
  let badSample = null;
  if (b) {
    try {
      badSample = JSON.parse(unfence(b[1]));
    } catch (_e) {
      badSample = null;
    }
  }
  return {
    file: `${name}.check.json`,
    code: `${JSON.stringify(recipe, null, 2)}\n`,
    recipe,
    summary: s ? s[1].trim() : "",
    badSample,
  };
}

/**
 * Try a draft: it must pass on the good input and fail on the bad one,
 * with a reason. { ok, good, bad, problem? }.
 * @param {{ file, code }} draft
 * @param {{ good: object, bad: object, cwd: string, tmpDir?: string,
 *           env?: object, spawn?: Function }} opts
 */
async function tryDraft(
  draft,
  { good, bad, cwd, tmpDir = os.tmpdir(), env = null, spawn = null },
) {
  if (
    !draft ||
    !FILE_RE.test(String(draft.file || "")) ||
    typeof draft.code !== "string"
  ) {
    return { ok: false, problem: "There's no check to try yet." };
  }
  if (!cwd || !fs.existsSync(cwd))
    return { ok: false, problem: "There's no folder to try it in." };
  if (/\.check\.json$/.test(draft.file))
    return tryRecipe(draft, { good, bad, cwd, env });
  const name = draft.file.replace(/\.[^.]+$/, "");
  const pkg = {
    manifest: { name, run: draft.file },
    files: { [draft.file]: draft.code },
    label: `.dash/checks/${draft.file}`,
  };
  const run = (input) =>
    runPackageFiles(
      pkg,
      input || {},
      {},
      { cwd, tmpDir, env, spawn, timeoutSec: 120 },
    );
  const g = await run(good);
  const b = await run(bad || { input: { answer: "" } });
  const generic = (r) =>
    /: (Passed|Failed) \(exit \d+\)$/.test(String(r.reason || ""));
  let problem = null;
  if (!g.pass) problem = `It fails on the good input: ${g.reason}`;
  else if (b.pass)
    problem = "It passes on the bad input too, so it doesn't catch anything.";
  else if (generic(b))
    problem =
      'It fails on the bad input without saying why: print {"reason": "…"} last.';
  return {
    ok: !problem,
    good: { pass: g.pass, reason: g.reason, output: g.output || "" },
    bad: { pass: b.pass, reason: b.reason, output: b.output || "" },
    ...(problem ? { problem } : {}),
  };
}

/** Try a recipe draft (DASH-133): in this process, on both inputs. */
async function tryRecipe(draft, { good, bad, cwd, env }) {
  let recipe;
  try {
    recipe = JSON.parse(draft.code);
  } catch (e) {
    return { ok: false, problem: `The recipe isn't JSON: ${e.message}` };
  }
  const invalid = recipeError(recipe);
  if (invalid)
    return { ok: false, problem: `The recipe isn't valid: ${invalid}` };
  const run = (input) =>
    runRecipe(recipe, input || {}, { cwd, ...(env ? { env } : {}) });
  const g = await run(good);
  const b = await run(bad || { input: { answer: "" } });
  let problem = null;
  if (!g.pass) problem = `It fails on the good input: ${g.reason}`;
  else if (b.pass)
    problem = "It passes on the bad input too, so it doesn't catch anything.";
  return {
    ok: !problem,
    good: { pass: g.pass, reason: g.reason, output: "", details: g.details },
    bad: { pass: b.pass, reason: b.reason, output: "", details: b.details },
    ...(problem ? { problem } : {}),
  };
}

// What CI runs that isn't installing.
const INSTALL_RE =
  /^(npm (ci|install|i)\b|yarn( install)?\b|pnpm (install|i)\b|bun install\b|pip install\b|poetry install\b)/;
const SKIP_RE =
  /^(echo |cd |git |npx? (semantic-release|changeset)|.*\b(deploy|publish|release)\b)/;

/** The `run:` lines of a GitHub Actions workflow (one per step, joined). */
function workflowRuns(yml) {
  const out = [];
  const lines = String(yml || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let body = m[2].trim();
    if (body === "|" || body === ">" || body === "|-" || body === ">-") {
      const indent = m[1].length;
      const parts = [];
      for (i = i + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.trim() && l.search(/\S/) <= indent) {
          i--;
          break;
        }
        if (l.trim()) parts.push(l.trim());
      }
      out.push(...parts);
    } else if (body) {
      out.push(body.replace(/^["']|["']$/g, ""));
    }
  }
  return out;
}

/**
 * Draft a repo's setup and validate checks from what its CI already does.
 * @param {{ [path]: string }} files  package.json, lockfiles,
 *   .github/workflows/*.yml (whatever the repo has)
 * @returns {{ files: { "setup.sh", "validate.sh" }, notes: string[] } | { error }}
 */
function draftRepoChecks(files) {
  const f = files || {};
  const notes = [];
  let pkg = null;
  if (typeof f["package.json"] === "string") {
    try {
      pkg = JSON.parse(f["package.json"]);
    } catch (_e) {
      return { error: "package.json doesn't parse" };
    }
  }
  const install = f["pnpm-lock.yaml"]
    ? "pnpm install --frozen-lockfile"
    : f["yarn.lock"]
      ? "yarn install --frozen-lockfile"
      : f["package-lock.json"] || f["npm-shrinkwrap.json"]
        ? "npm ci"
        : pkg
          ? "npm install"
          : f["requirements.txt"]
            ? "pip install -r requirements.txt"
            : null;
  if (!install)
    return {
      error: "This repo has no package.json or requirements.txt to set up from",
    };
  notes.push(
    `setup runs ${install}${f["package-lock.json"] ? " (it has package-lock.json)" : ""}.`,
  );

  const fromCi = [];
  for (const [p, body] of Object.entries(f)) {
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)) continue;
    for (const r of workflowRuns(body)) {
      if (INSTALL_RE.test(r) || SKIP_RE.test(r) || fromCi.includes(r)) continue;
      fromCi.push(r);
    }
  }
  const run = pkg
    ? (s) =>
        f["yarn.lock"]
          ? `yarn ${s}`
          : f["pnpm-lock.yaml"]
            ? `pnpm run ${s}`
            : `npm run ${s}`
    : null;
  const scripts = (pkg && pkg.scripts) || {};
  const fromScripts = ["lint", "test", "build"]
    .filter(
      (s) =>
        typeof scripts[s] === "string" && !/no test specified/.test(scripts[s]),
    )
    .map((s) =>
      s === "test" ? run(s).replace("npm run test", "npm test") : run(s),
    );
  const validate = fromCi.length ? fromCi : fromScripts;
  if (!validate.length)
    return {
      error:
        "This repo's CI and package.json have no test, lint or build to validate with",
    };
  notes.push(
    fromCi.length
      ? `validate runs what its CI workflows run: ${validate.join(", ")}.`
      : `validate runs its package.json scripts: ${validate.join(", ")}.`,
  );

  const script = (title, cmds, ok) =>
    [
      "#!/usr/bin/env bash",
      `# ${title}, drafted by Dash from this repo's own setup (DASH-110).`,
      "# Runs in the job's workspace. Exit 0 passes; the last line says why.",
      "set -o pipefail",
      ...cmds.flatMap((c) => [
        `echo "+ ${c.replace(/"/g, '\\"')}"`,
        `${c} || { echo '{"reason": "${c.replace(/'/g, "").replace(/"/g, '\\\\"')} failed: see the output above"}'; exit 1; }`,
      ]),
      `echo '{"reason": "${ok}"}'`,
      "",
    ].join("\n");
  return {
    files: {
      "setup.sh": script(
        "setup: installs what the repo needs",
        [install],
        `${install} passed`,
      ),
      "validate.sh": script(
        "validate: what the repo's CI checks",
        validate,
        `${validate.join(", ")} passed`,
      ),
    },
    notes,
  };
}

module.exports = {
  suggestChecks,
  draftPrompt,
  parseDraft,
  tryDraft,
  draftRepoChecks,
  workflowRuns,
  checkNameOf,
  FILE_RE,
};
