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
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { runCommand } = require("./command");

const CHECKS_DIR = ".dash/checks";
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

/** Which file is the check: its exact name, else name.<ext> (sorted). */
function pickFile(names, name) {
  const files = (names || []).map((n) => path.posix.basename(n));
  if (files.includes(name)) return name;
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
    const body = fs.readFileSync(src);
    if (body.length > MAX_FILE)
      return { error: `${CHECKS_DIR}/${file} is too big to run` };
    const out = tmp();
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
  const body = await git(["show", `${ref}:${CHECKS_DIR}/${file}`], opts);
  if (body == null)
    return { error: `Dash couldn't read ${CHECKS_DIR}/${file} on ${ref}` };
  if (body.length > MAX_FILE)
    return { error: `${CHECKS_DIR}/${file} is too big to run` };
  const out = tmp();
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
 * Run a repo check.
 * @param {object} check   { kind: "repo", name, fallback?, ifMissing?, from?, base? }
 * @param {object} input   the standard input (stepInput.js)
 * @param {{ cwd: string, env?: object, tmpDir?: string, spawn?: Function,
 *           exec?: Function,
 *           runFallback?: (check, input) => Promise<object> }} opts
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
  if (found.missing) {
    const where =
      check.from === "workspace"
        ? "The workspace"
        : `This repo${found.ref ? ` (on ${found.ref})` : ""}`;
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
        ...(opts.env ? { env: opts.env } : {}),
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
  CHECKS_DIR,
};
