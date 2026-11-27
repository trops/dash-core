/**
 * repo.js — a check kept in the repo, like CI (DASH-102).
 *
 * { kind: "repo", name: "validate", fallback?, ifMissing?, from?, base? }
 *
 * Dash looks for `.dash/checks/<name>` (any extension: validate, validate.sh,
 * validate.js…) in the job's workspace repo and runs it there, the way a
 * command check runs: the step's input as JSON on stdin and in $DASH_INPUT,
 * DASH_ITEM_*, DASH_WORKSPACE, DASH_BRANCH and DASH_STEP in its
 * environment, exit 0 passes, and a last line of {"reason", "details"} JSON
 * becomes the proof.
 *
 * By default the file is read from the repo's base branch (origin/HEAD,
 * e.g. origin/main), not from the workspace: a bot working on a branch
 * can't change the check that judges its work. `from: "workspace"` reads
 * the workspace's own copy instead (for a repo that's adding its checks).
 *
 * When the repo has no such file: the `fallback` check runs if one is set
 * (any other kind), else `ifMissing` says what happens: "fail" (the
 * default) or "skip" (passes, saying it was skipped).
 *
 * How it's run: its #! line when it has one, else by extension (.js .cjs
 * .mjs → node, .sh → bash, .py → python3), else sh.
 *
 * A dash-check file (DASH-133) is found by the same name: `validate` finds
 * .dash/checks/validate.check.js or validate.check.json (before
 * validate.<ext>). A .check.js file runs in its own node with the
 * library's runner; a .check.json recipe runs in Dash's process with the
 * library's helpers (in its own node when it uses the repo's own, from
 * .dash/checks/helpers). Both read from the base branch (helpers too), get
 * the same input and environment, a read-only ctx.tool, and come back with
 * each check's and each step's result in details.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { runCommand } = require("./command");
const { readCheckFiles, inputValues, inputEnv } = require("../checkPackage");

/** A plain repo check's step inputs as DASH_CHECK_<NAME> (names it can use). */
function stepInputEnv(inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return {};
  const ok = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (
      /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) &&
      v != null &&
      typeof v !== "object"
    )
      ok[k] = v;
  }
  return inputEnv(ok);
}
const { runPackageFiles } = require("./package");
const {
  runCheckFile,
  runRecipe,
  recipeError,
  helpersUsed,
  isBuiltInHelper,
} = require("../dashCheck");

const CHECKS_DIR = ".dash/checks";
// A repo's own dash-check helpers (DASH-133), inside CHECKS_DIR.
const HELPERS_DIR = "helpers";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const IF_MISSING = ["fail", "skip"];
const FROM = ["base", "workspace"];
const MAX_FILE = 512 * 1024;
const RUNNERS = {
  ".js": "node",
  ".cjs": "node",
  ".mjs": "node",
  ".sh": "bash",
  ".bash": "bash",
  ".py": "python3",
};

/** What's wrong with a repo check's settings, or null. */
function repoCheckError(check) {
  const c = check || {};
  const name = typeof c.name === "string" ? c.name.trim() : "";
  if (!name) return "a repo check needs the name of its file in .dash/checks";
  if (!NAME_RE.test(name) || name.includes("..")) {
    return `"${name}" can't be a check's name: use letters, numbers, ".", "-" and "_"`;
  }
  if (c.ifMissing !== undefined && !IF_MISSING.includes(c.ifMissing)) {
    return `ifMissing must be one of ${IF_MISSING.join(", ")}`;
  }
  if (c.from !== undefined && !FROM.includes(c.from)) {
    return `from must be one of ${FROM.join(", ")}`;
  }
  if (
    c.fallback !== undefined &&
    c.fallback !== null &&
    !(c.fallback && typeof c.fallback === "object" && c.fallback.kind)
  ) {
    return "a repo check's fallback must be a check with a kind";
  }
  if (c.fallback && c.fallback.kind === "repo") {
    return "a repo check's fallback can't be another repo check";
  }
  return null;
}

/** A dash-check file (DASH-133): "js" (.check.js), "recipe" (.check.json) or null. */
function libKind(file) {
  const f = String(file || "");
  if (/\.check\.c?js$/.test(f)) return "js";
  if (/\.check\.json$/.test(f)) return "recipe";
  return null;
}

/**
 * Which file is the check: its exact name, else name.check.js,
 * name.check.cjs or name.check.json (dash-check, DASH-133), else
 * name.<ext> (sorted).
 */
function pickFile(names, name) {
  const files = (names || []).map((n) => path.posix.basename(n));
  if (files.includes(name)) return name;
  for (const ext of [".check.js", ".check.cjs", ".check.json"]) {
    if (files.includes(`${name}${ext}`)) return `${name}${ext}`;
  }
  const withExt = files
    .filter(
      (f) =>
        f.startsWith(`${name}.`) && !f.slice(name.length + 1).includes("."),
    )
    .sort();
  return withExt[0] || null;
}

/** How a check file is run: its #! line, else its extension. */
function runnerFor(file, firstLine) {
  if (typeof firstLine === "string" && firstLine.startsWith("#!")) return null;
  return RUNNERS[path.extname(file).toLowerCase()] || "sh";
}

const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function git(args, { cwd, exec = execFile }) {
  return new Promise((resolve) => {
    exec(
      "git",
      args,
      { cwd, maxBuffer: MAX_FILE * 2, encoding: "buffer" },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

/** The base branch's ref: the check's `base`, else origin/HEAD's. */
async function baseRef(check, opts) {
  const given = typeof check.base === "string" ? check.base.trim() : "";
  const candidates = [];
  if (given) {
    candidates.push(given.includes("/") ? given : `origin/${given}`, given);
  } else {
    const head = await git(
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      opts,
    );
    const ref = head && head.toString().trim();
    if (ref) candidates.push(ref.replace(/^refs\/remotes\//, ""));
    candidates.push("origin/main", "origin/master");
  }
  for (const c of candidates) {
    const ok = await git(
      ["rev-parse", "--verify", "--quiet", `${c}^{commit}`],
      opts,
    );
    if (ok) return c;
  }
  return null;
}

/**
 * Find a check's file and copy it to a temp folder.
 * @returns {Promise<{ file?: string, shown?: string, dir?: string,
 *                     missing?: true, error?: string }>}
 */
async function findCheck(check, opts) {
  const name = check.name.trim();
  const cwd = opts.cwd;
  const tmp = () =>
    fs.mkdtempSync(path.join(opts.tmpDir || os.tmpdir(), "dash-repo-check-"));
  if (check.from === "workspace") {
    const dir = path.join(cwd, CHECKS_DIR);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (_e) {
      return { missing: true };
    }
    const file = pickFile(names, name);
    if (!file) return { missing: true };
    const src = path.join(dir, file);
    // A check package vendored as a folder (DASH-106).
    if (fs.statSync(src).isDirectory()) {
      const files = {};
      for (const f of fs.readdirSync(src)) {
        const p = path.join(src, f);
        if (fs.statSync(p).isFile()) files[f] = fs.readFileSync(p, "utf8");
      }
      return { pkgFiles: files, shown: `${CHECKS_DIR}/${file}` };
    }
    const body = fs.readFileSync(src);
    if (body.length > MAX_FILE)
      return { error: `${CHECKS_DIR}/${file} is too big to run` };
    const out = tmp();
    if (libKind(file)) {
      // A dash-check file, with the repo's helpers beside it (DASH-133).
      const helpers = {};
      const hdir = path.join(dir, HELPERS_DIR);
      try {
        for (const f of fs.readdirSync(hdir)) {
          const p = path.join(hdir, f);
          if (/\.c?js$/.test(f) && fs.statSync(p).isFile())
            helpers[f] = fs.readFileSync(p);
        }
      } catch (_e) {
        // No helpers of its own.
      }
      return {
        ...placeLibFile(out, file, body, helpers),
        shown: `${CHECKS_DIR}/${file}`,
      };
    }
    const dest = path.join(out, file);
    fs.writeFileSync(dest, body, { mode: 0o755 });
    return { file: dest, shown: `${CHECKS_DIR}/${file}`, dir: out };
  }
  const inRepo = await git(["rev-parse", "--is-inside-work-tree"], opts);
  if (!inRepo) {
    return {
      error: `The workspace isn't a git repo, so its base branch has no ${CHECKS_DIR}/${name}. Use "from": "workspace" to read the workspace's own copy.`,
    };
  }
  const ref = await baseRef(check, opts);
  if (!ref) {
    return {
      error: check.base
        ? `The base branch "${check.base}" isn't there`
        : "This repo has no base branch Dash can find (origin/HEAD, origin/main or origin/master). Set the check's base.",
    };
  }
  const listing = await git(
    ["ls-tree", "--name-only", `${ref}:${CHECKS_DIR}`],
    opts,
  );
  if (!listing) return { missing: true, ref };
  const file = pickFile(listing.toString().split("\n").filter(Boolean), name);
  if (!file) return { missing: true, ref };
  // A check package vendored as a folder (DASH-106): its files from there.
  const type = await git(
    ["cat-file", "-t", `${ref}:${CHECKS_DIR}/${file}`],
    opts,
  );
  if (type && type.toString().trim() === "tree") {
    const inside = await git(
      ["ls-tree", "--name-only", `${ref}:${CHECKS_DIR}/${file}`],
      opts,
    );
    const files = {};
    for (const f of (inside ? inside.toString().split("\n") : []).filter(
      Boolean,
    )) {
      const body = await git(
        ["show", `${ref}:${CHECKS_DIR}/${file}/${f}`],
        opts,
      );
      if (body != null) files[f] = body.toString("utf8");
    }
    return { pkgFiles: files, shown: `${CHECKS_DIR}/${file} on ${ref}`, ref };
  }
  const body = await git(["show", `${ref}:${CHECKS_DIR}/${file}`], opts);
  if (body == null)
    return { error: `Dash couldn't read ${CHECKS_DIR}/${file} on ${ref}` };
  if (body.length > MAX_FILE)
    return { error: `${CHECKS_DIR}/${file} is too big to run` };
  const out = tmp();
  if (libKind(file)) {
    // A dash-check file: the base branch's helpers too, so the branch can't
    // change those either (DASH-133).
    const helpers = {};
    const inside = await git(
      ["ls-tree", "--name-only", `${ref}:${CHECKS_DIR}/${HELPERS_DIR}`],
      opts,
    );
    for (const f of (inside ? inside.toString().split("\n") : []).filter((n) =>
      /\.c?js$/.test(n),
    )) {
      const b = await git(
        ["show", `${ref}:${CHECKS_DIR}/${HELPERS_DIR}/${f}`],
        opts,
      );
      if (b != null) helpers[f] = b;
    }
    return {
      ...placeLibFile(out, file, body, helpers),
      shown: `${CHECKS_DIR}/${file} on ${ref}`,
      ref,
    };
  }
  const dest = path.join(out, file);
  fs.writeFileSync(dest, body, { mode: 0o755 });
  return {
    file: dest,
    shown: `${CHECKS_DIR}/${file} on ${ref}`,
    dir: out,
    ref,
  };
}

/**
 * A dash-check file laid out as in its repo: <out>/.dash/checks/<file>,
 * its helpers in <out>/.dash/checks/helpers/, so its relative requires and
 * the repo's own helpers are the copies Dash read.
 */
function placeLibFile(out, file, body, helpers = {}) {
  const checks = path.join(out, CHECKS_DIR);
  fs.mkdirSync(path.join(checks, HELPERS_DIR), { recursive: true });
  for (const [f, b] of Object.entries(helpers)) {
    fs.writeFileSync(path.join(checks, HELPERS_DIR, f), b);
  }
  const dest = path.join(checks, file);
  fs.writeFileSync(dest, body);
  return { file: dest, dir: out, root: out, lib: libKind(file) };
}

/**
 * Run a dash-check file (DASH-133): a .check.js file in its own node with
 * the library's runner; a .check.json recipe in this process when it uses
 * only the library's helpers, else in its own node with the repo's.
 */
async function runLibFile(found, check, input, opts) {
  const common = {
    cwd: opts.cwd,
    env: { ...(opts.env || {}), ...stepInputEnv(check.inputs) },
    tmpDir: opts.tmpDir,
    timeoutSec: check.timeoutSec,
    shown: found.shown,
    ...(opts.spawn ? { spawn: opts.spawn } : {}),
    ...(opts.callTool ? { callTool: opts.callTool } : {}),
    ...(opts.isReadOnly ? { isReadOnly: opts.isReadOnly } : {}),
  };
  if (found.lib === "js") {
    return runCheckFile(found.file, input, common);
  }
  let recipe;
  try {
    recipe = JSON.parse(fs.readFileSync(found.file, "utf8"));
  } catch (e) {
    return {
      pass: false,
      reason: `${found.shown} isn't valid JSON (${e.message})`,
    };
  }
  const bad = recipeError(recipe, { repoHelpers: true });
  if (bad) {
    return {
      pass: false,
      reason: `${found.shown} isn't a valid recipe: ${bad}`,
    };
  }
  if (helpersUsed(recipe).every(isBuiltInHelper)) {
    return runRecipe(recipe, input, {
      ...common,
      extra: { file: found.shown, recipe: recipe.name },
    });
  }
  const res = await runCheckFile(found.file, input, {
    ...common,
    root: found.root,
  });
  return {
    ...res,
    details: { ...(res.details || {}), recipe: recipe.name },
  };
}

/**
 * Run a repo check.
 * @param {object} check   { kind: "repo", name, fallback?, ifMissing?, from?, base? }
 * @param {object} input   the standard input (stepInput.js)
 * @param {{ cwd: string, env?: object, tmpDir?: string, spawn?: Function,
 *           exec?: Function, callTool?, isReadOnly?,
 *           runFallback?: (check, input) => Promise<object> }} opts
 *   callTool and isReadOnly answer a dash-check file's ctx.tool
 */
async function runRepoCheck(check, input, opts = {}) {
  const bad = repoCheckError(check);
  if (bad) return { pass: false, reason: `This check can't run: ${bad}` };
  const cwd = opts.cwd;
  if (!cwd || !fs.existsSync(cwd)) {
    return { pass: false, reason: "The folder it runs in isn't there" };
  }
  const name = check.name.trim();
  const found = await findCheck(check, {
    cwd,
    tmpDir: opts.tmpDir,
    exec: opts.exec,
  });
  if (found.error) return { pass: false, reason: found.error };
  if (found.pkgFiles) {
    const read = readCheckFiles(found.pkgFiles);
    if (read.error) {
      return { pass: false, reason: `${found.shown}: ${read.error}` };
    }
    if (read.manifest.kind !== "file") {
      return {
        pass: false,
        reason: `${found.shown} is a tool check: use it as a package step, not a repo check`,
      };
    }
    const { values, missing } = inputValues(read.manifest, check.inputs || {});
    if (missing.length) {
      return {
        pass: false,
        reason: `${found.shown} needs ${missing.join(", ")}: set it in the step's inputs`,
      };
    }
    return runPackageFiles(
      { manifest: read.manifest, files: read.files, label: found.shown },
      input,
      values,
      {
        cwd,
        env: opts.env,
        tmpDir: opts.tmpDir,
        spawn: opts.spawn,
        timeoutSec: check.timeoutSec,
      },
    );
  }
  if (found.missing) {
    const where =
      check.from === "workspace"
        ? "The workspace"
        : `This repo${found.ref ? ` (on ${found.ref})` : ""}`;
    // The team's copy (DASH-110): saved to the repo by a PR not merged yet,
    // or kept for this team only.
    const tc = opts.teamCheck ? opts.teamCheck(name) : null;
    if (tc && libKind(tc.file)) {
      // A dash-check team copy (DASH-133): run as the repo's file would be.
      const label = `Team copy of .dash/checks/${tc.file}${tc.state === "pr-open" ? ` (PR open${tc.pr && tc.pr.url ? `: ${tc.pr.url}` : ""})` : ""}`;
      const out = fs.mkdtempSync(
        path.join(opts.tmpDir || os.tmpdir(), "dash-repo-check-"),
      );
      try {
        const res = await runLibFile(
          { ...placeLibFile(out, tc.file, tc.code), shown: label },
          check,
          input,
          { ...opts, cwd },
        );
        return {
          ...res,
          details: {
            ...(res.details || {}),
            teamCopy: tc.file,
            state: tc.state,
          },
        };
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    }
    if (tc) {
      const label =
        tc.state === "pr-open"
          ? `Team copy of .dash/checks/${tc.file} (PR open${tc.pr && tc.pr.url ? `: ${tc.pr.url}` : ""})`
          : tc.state === "pr-closed"
            ? `Team copy of .dash/checks/${tc.file} (its PR was closed: keep it or remove it on the bot's Checks)`
            : `Team copy of .dash/checks/${tc.file}`;
      const res = await runPackageFiles(
        {
          manifest: { name, run: tc.file },
          files: { [tc.file]: tc.code },
          label,
        },
        input,
        {},
        {
          cwd,
          env: opts.env,
          tmpDir: opts.tmpDir,
          spawn: opts.spawn,
          timeoutSec: check.timeoutSec,
        },
      );
      return {
        ...res,
        details:
          res.details == null
            ? { teamCopy: tc.file, state: tc.state }
            : res.details,
      };
    }
    if (check.fallback && opts.runFallback) {
      const res = await opts.runFallback(check.fallback, input);
      return {
        ...res,
        reason: `${where} has no ${CHECKS_DIR}/${name}, so its fallback ran: ${res.reason || (res.pass ? "Passed" : "Failed")}`,
      };
    }
    if (check.ifMissing === "skip") {
      return {
        pass: true,
        reason: `Skipped: ${where} has no ${CHECKS_DIR}/${name}`,
      };
    }
    return {
      pass: false,
      reason: `${where} has no ${CHECKS_DIR}/${name}: add it, or give the step a fallback`,
    };
  }
  try {
    if (found.lib) return await runLibFile(found, check, input, opts);
    let first = "";
    try {
      first = fs.readFileSync(found.file, "utf8").split(/\r?\n/, 1)[0] || "";
    } catch (_e) {
      first = "";
    }
    const runner = runnerFor(found.file, first);
    const command = runner
      ? `${runner} ${quote(found.file)}`
      : quote(found.file);
    const res = await runCommand(
      { command, timeoutSec: check.timeoutSec, passWhen: { type: "exit0" } },
      input,
      {
        cwd,
        tmpDir: opts.tmpDir,
        ...(opts.spawn ? { spawn: opts.spawn } : {}),
        // The step's inputs (DASH-107), as for a package: DASH_CHECK_<NAME>.
        env: { ...(opts.env || {}), ...stepInputEnv(check.inputs) },
      },
    );
    const said = /^(Passed|Failed) \(exit/.test(String(res.reason || ""));
    return {
      ...res,
      // Where it came from, when the check didn't say why itself.
      reason: said ? `${found.shown}: ${res.reason}` : res.reason,
      details: res.details == null ? { file: found.shown } : res.details,
    };
  } finally {
    try {
      fs.rmSync(found.dir, { recursive: true, force: true });
    } catch (_e) {
      // A temp folder left behind is harmless.
    }
  }
}

module.exports = {
  runRepoCheck,
  repoCheckError,
  pickFile,
  runnerFor,
  libKind,
  CHECKS_DIR,
};
