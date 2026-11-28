/**
 * factory.js — Dash's built-in checks about the factory, not the code
 * (DASH-103). Each used to be ~20 lines of shell typed into a bot; here
 * they're settings, deterministic, with no AI and no typed shell:
 *
 *   git-on-branch  { branch? }   the workspace is on its branch
 *                                (default: the job's workspace.branch)
 *   git-committed  { base? }     at least one commit past origin/<base>,
 *                                and nothing uncommitted (default base:
 *                                origin/HEAD's branch)
 *   pr-ci          { prKey?, repo?, timeoutSec?, noChecksSec?,
 *                    ifNoChecks? }
 *                                the PR in the handoff (prUrl, or pr plus
 *                                repo) has CI that passed: check runs, else
 *                                Actions runs. Waits up to timeoutSec, with
 *                                the bot's GitHub sign-in (GH_TOKEN).
 *   handoff-has    { keys }      the handoff has each key ("plan.cause"
 *                                reaches in), not empty
 *
 * The workspace is the job's (input.workspace.dir), else the folder the
 * check runs in.
 *
 * Each runs through @trops/dash-check's helpers (DASH-133): git.onBranch,
 * git.committedSince, github.ciPassed and handoff.has, so a recipe, a
 * .check.js file and these built-ins share one implementation. The helper
 * decides pass or fail; Dash says it in its own words (its reasons, which
 * the tests pin), from what the helper read.
 */
"use strict";

const fs = require("fs");
const { execFile } = require("child_process");
const { readHandoff } = require("../../bots/botHandoff");
const { goneText } = require("../workspaceGuard");

/** The library, loaded when first used. */
const core = () => require("@trops/dash-check");
const helpers = () => require("@trops/dash-check/helpers");

/** A context for a helper: the job's data, in `dir`. */
function contextFor(input, { cwd, env, fetch, now, sleep } = {}) {
  return core().createContext(input || {}, {
    cwd: cwd || process.cwd(),
    env: env || {},
    ...(fetch ? { fetch } : {}),
    ...(now ? { now } : {}),
    ...(sleep ? { sleep } : {}),
  });
}

/** Run one helper: its failures and notes (it never throws). */
function runHelper(fn, ctx, params) {
  return core().collect(() => fn(ctx, params));
}

/** Record what an adapter call gives or throws, still giving it back. */
function spy(obj, name, rec, key) {
  const real = obj[name];
  obj[name] = async (...args) => {
    try {
      const v = await real(...args);
      rec[key] = v;
      return v;
    } catch (e) {
      rec[`${key}Error`] = e;
      throw e;
    }
  };
}

/** The environment a helper's git runs with: the user's, plus the check's. */
function gitEnv(deps) {
  return { ...process.env, ...(deps.env || {}) };
}

const FACTORY_KINDS = [
  "git-on-branch",
  "git-committed",
  "pr-ci",
  "handoff-has",
];
const DEFAULT_CI_SEC = 20 * 60;
const MAX_CI_SEC = 60 * 60;
const DEFAULT_NO_CHECKS_SEC = 180;
const PR_URL_RE =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/;
const REPO_RE =
  /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const KEY_RE = /^[A-Za-z_$][\w$-]*(\.[A-Za-z_$][\w$-]*)*$/;

const mins = (sec) => {
  const m = Math.max(1, Math.round(sec / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
};
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** What's wrong with a built-in check's settings, or null. */
function factoryCheckError(check) {
  const c = check || {};
  if (c.kind === "handoff-has") {
    const keys = Array.isArray(c.keys) ? c.keys.map(str).filter(Boolean) : [];
    if (!keys.length) return "a handoff-has check needs the keys it looks for";
    const bad = keys.find((k) => !KEY_RE.test(k));
    if (bad) return `"${bad}" isn't a key (e.g. prUrl, or plan.cause)`;
  }
  if (c.kind === "pr-ci") {
    if (
      c.ifNoChecks !== undefined &&
      !["pass", "fail"].includes(c.ifNoChecks)
    ) {
      return "ifNoChecks must be pass or fail";
    }
    if (c.prKey !== undefined && !KEY_RE.test(str(c.prKey))) {
      return "prKey must be a key in the handoff (e.g. prUrl)";
    }
  }
  return null;
}

function workspaceOf(input, deps) {
  const w = input && input.workspace;
  if (w && typeof w.dir === "string" && w.dir) return w.dir;
  return deps.cwd || null;
}

function git(args, cwd, exec = execFile) {
  return new Promise((resolve) => {
    exec("git", args, { cwd, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({
        ok: !err,
        out: String(stdout || "").trim(),
        err: String(stderr || (err && err.message) || "").trim(),
      }),
    );
  });
}

async function gitDir(input, deps) {
  const dir = workspaceOf(input, deps);
  // The job's workspace, gone (DASH-165): said plainly, never a pass.
  const ws = input && input.workspace && input.workspace.dir;
  if (ws && ws === dir && !fs.existsSync(dir)) return { error: goneText(dir) };
  if (!dir || !fs.existsSync(dir)) {
    return { error: dir ? `${dir} isn't there` : "The job has no workspace" };
  }
  const inside = await git(
    ["rev-parse", "--is-inside-work-tree"],
    dir,
    deps.exec,
  );
  if (!inside.ok) return { error: `${dir} isn't a git repo` };
  return { dir };
}

async function gitOnBranch(check, input, deps) {
  const g = await gitDir(input, deps);
  if (g.error) return { pass: false, reason: g.error };
  const want =
    str(check.branch) ||
    str(input && input.workspace && input.workspace.branch);
  if (!want) {
    return {
      pass: false,
      reason:
        "No branch to check: the job's workspace has none. Name it in the handoff's workspace.branch, or set the check's branch.",
    };
  }
  const ctx = contextFor(
    { workspace: { dir: g.dir, branch: want } },
    { cwd: g.dir, env: gitEnv(deps) },
  );
  const rec = {};
  spy(ctx.git, "branch", rec, "branch");
  const r = await runHelper(helpers().git.onBranch, ctx, { branch: want });
  if (rec.branchError) {
    return {
      pass: false,
      reason: `Can't read ${g.dir}'s branch: ${rec.branchError.message}`,
    };
  }
  if (r.failures.length) {
    const cur = rec.branch;
    return {
      pass: false,
      reason: `${g.dir} is on ${cur === "HEAD" ? "no branch (a detached HEAD)" : cur}, not ${want}`,
      details: { dir: g.dir, branch: cur, want },
    };
  }
  return {
    pass: true,
    reason: `${g.dir} is on ${want}`,
    details: { dir: g.dir, branch: want },
  };
}

async function baseBranch(check, dir, exec) {
  const given = str(check.base);
  if (given) return given.replace(/^origin\//, "");
  const head = await git(
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    dir,
    exec,
  );
  if (head.ok && head.out)
    return head.out.replace(/^refs\/remotes\/origin\//, "");
  for (const b of ["main", "master"]) {
    const ok = await git(
      ["rev-parse", "--verify", "--quiet", `origin/${b}^{commit}`],
      dir,
      exec,
    );
    if (ok.ok) return b;
  }
  return null;
}

async function gitCommitted(check, input, deps) {
  const g = await gitDir(input, deps);
  if (g.error) return { pass: false, reason: g.error };
  const base = await baseBranch(check, g.dir, deps.exec);
  if (!base) {
    return {
      pass: false,
      reason:
        "No base branch to count from (origin/HEAD, origin/main or origin/master): set the check's base",
    };
  }
  const ref = `origin/${base}`;
  const ctx = contextFor({}, { cwd: g.dir, env: gitEnv(deps) });
  const rec = {};
  spy(ctx.git, "commitsSince", rec, "commits");
  spy(ctx.git, "uncommitted", rec, "dirty");
  const r = await runHelper(helpers().git.committedSince, ctx, {
    base: ref,
    min: 1,
  });
  if (rec.commitsError) {
    return {
      pass: false,
      reason: `Can't compare with ${ref}: ${rec.commitsError.message}`,
    };
  }
  const n = Number(rec.commits) || 0;
  if (n < 1) {
    return {
      pass: false,
      reason: `No commits past ${ref}: commit the work (git add -A; git commit)`,
      details: { dir: g.dir, base, commits: 0 },
    };
  }
  if (rec.dirtyError) {
    return {
      pass: false,
      reason: `Can't read ${g.dir}'s status: ${rec.dirtyError.message}`,
    };
  }
  const files = Array.isArray(rec.dirty) ? rec.dirty : [];
  if (files.length) {
    const shown = files.slice(0, 5).join(", ");
    return {
      pass: false,
      reason: `There are uncommitted changes: ${shown}${files.length > 5 ? `, and ${files.length - 5} more` : ""}`,
      details: {
        dir: g.dir,
        base,
        commits: n,
        uncommitted: files.slice(0, 50),
      },
    };
  }
  if (r.failures.length) {
    return {
      pass: false,
      reason: r.failures.map((f) => f.message).join("; "),
      details: { dir: g.dir, base, commits: n },
    };
  }
  return {
    pass: true,
    reason: `${n} commit${n === 1 ? "" : "s"} past ${ref}, nothing uncommitted`,
    details: { dir: g.dir, base, commits: n },
  };
}

/** A value at a dotted key ("plan.cause"). */
function at(obj, key) {
  return key
    .split(".")
    .reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

/** The handoff as one object: Dash's keys and the bot's own data. */
function handoffObject(input) {
  const work = input && input.input;
  const answer =
    work && typeof work === "object" && typeof work.answer === "string"
      ? work.answer
      : typeof work === "string"
        ? work
        : "";
  const h = readHandoff(answer);
  if (!h.found) return { h, obj: null };
  return {
    h,
    obj: {
      ...h.data,
      ...(h.summary ? { summary: h.summary } : {}),
      ...(h.question ? { question: h.question } : {}),
      ...(h.items.length ? { items: h.items } : {}),
      ...(h.statusGiven === undefined ? { status: h.status } : {}),
      ...(h.item ? { item: h.item } : {}),
      ...(h.workspace ? { workspace: h.workspace } : {}),
    },
  };
}

async function handoffHas(check, input) {
  const keys = (Array.isArray(check.keys) ? check.keys : [])
    .map(str)
    .filter(Boolean);
  const { h, obj } = handoffObject(input);
  if (!obj) {
    return {
      pass: false,
      reason: h.broken
        ? "The answer's last ```json block doesn't parse"
        : "The answer has no handoff (a ```json block)",
    };
  }
  // Dash's handoff (its own keys and the bot's), given to the helper.
  const r = await runHelper(
    helpers().handoff.has,
    contextFor({ handoff: obj }),
    {
      keys,
    },
  );
  const missing = r.failures
    .map((f) => String(f.label || "").replace(/^handoff\./, ""))
    .filter((k) => keys.includes(k));
  if (r.failures.length && !missing.length) {
    return {
      pass: false,
      reason: r.failures.map((f) => f.message).join("; "),
    };
  }
  if (missing.length) {
    return {
      pass: false,
      reason: `The handoff has no ${missing.join(", ")}${missing.length < keys.length ? ` (it has ${keys.filter((k) => !missing.includes(k)).join(", ")})` : ""}`,
      details: { missing },
    };
  }
  return {
    pass: true,
    reason: `The handoff has ${keys.join(", ")}`,
    details: { keys },
  };
}

/** The PR a handoff names: { owner, repo, number, url } or an error. */
function prOf(check, input) {
  const { obj } = handoffObject(input);
  if (!obj)
    return { error: "The answer has no handoff (a ```json block) with the PR" };
  const key = str(check.prKey) || "prUrl";
  const url = str(at(obj, key));
  let m = url && url.match(PR_URL_RE);
  if (m)
    return {
      owner: m[1],
      repo: m[2],
      number: Number(m[3]),
      url: `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`,
    };
  const n = Number(at(obj, "pr"));
  const repo = str(check.repo) || str(obj.repoUrl) || "";
  m = repo.match(REPO_RE);
  if (Number.isInteger(n) && n > 0 && m) {
    return {
      owner: m[1],
      repo: m[2],
      number: n,
      url: `https://github.com/${m[1]}/${m[2]}/pull/${n}`,
    };
  }
  return {
    error: url
      ? `"${key}" isn't a GitHub PR link: ${url.slice(0, 200)}`
      : `The handoff has no PR link ("${key}"), or "pr" with the check's repo`,
  };
}

function ciSeconds(v, def, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

async function prCi(check, input, deps) {
  const pr = prOf(check, input);
  if (pr.error) return { pass: false, reason: pr.error };
  const token = str((deps.env || {}).GH_TOKEN);
  const doFetch = deps.fetch || (typeof fetch === "function" ? fetch : null);
  if (!doFetch)
    return { pass: false, reason: "Dash can't reach GitHub from here" };
  const limit = ciSeconds(check.timeoutSec, DEFAULT_CI_SEC, MAX_CI_SEC);
  const noChecks = ciSeconds(check.noChecksSec, DEFAULT_NO_CHECKS_SEC, limit);
  const slug = `${pr.owner}/${pr.repo}`;
  const who = token
    ? "the GitHub provider's token"
    : "Dash (no GitHub provider is signed in for this bot)";
  // The helper reads the PR from the handoff Dash found it in.
  const ctx = contextFor(
    { handoff: { prUrl: pr.url } },
    {
      cwd: deps.cwd,
      env: token ? { GH_TOKEN: token } : {},
      fetch: doFetch,
      now: deps.now,
      sleep: deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    },
  );
  const rec = {};
  const realPr = ctx.github.pr;
  ctx.github.pr = async (...a) => {
    let body;
    try {
      body = await realPr(...a);
    } catch (e) {
      rec.prError = e;
      throw e;
    }
    rec.pr = body;
    // Dash's rule: a merged PR's CI still counts; a closed one's doesn't.
    if (body && body.state !== "open" && !body.merged) {
      rec.notOpen = true;
      throw new Error(`${pr.url} isn't open`);
    }
    return body;
  };
  spy(ctx.github, "waitForChecks", rec, "wait");
  const r = await runHelper(helpers().github.ciPassed, ctx, {
    prKey: "prUrl",
    timeoutSec: limit,
    noChecksAfterSec: noChecks,
    ifNoChecks: check.ifNoChecks === "fail" ? "fail" : "pass",
  });
  if (rec.prError) {
    const code = rec.prError.code;
    return {
      pass: false,
      reason: code
        ? `Can't read PR #${pr.number} on ${slug} (HTTP ${code}): check ${who}`
        : rec.prError.message,
    };
  }
  if (rec.notOpen) {
    return {
      pass: false,
      reason: `${pr.url} isn't open (it's ${(rec.pr && rec.pr.state) || "unknown"})`,
    };
  }
  const sha = rec.pr && rec.pr.head && rec.pr.head.sha;
  if (!sha)
    return { pass: false, reason: `Couldn't read ${pr.url}'s last commit` };
  if (rec.waitError) {
    const m = /HTTP (\d+) for check runs and HTTP (\d+) for Actions runs/.exec(
      String(rec.waitError.message || ""),
    );
    return {
      pass: false,
      reason: m
        ? `${who.replace(/^the/, "The")} can't read CI on ${slug} (check runs: HTTP ${m[1]}, Actions runs: HTTP ${m[2]}). Give it read access to Checks or Actions.`
        : `Can't read CI on ${slug}: ${rec.waitError.message}`,
    };
  }
  const w = rec.wait;
  if (!w) {
    return {
      pass: false,
      reason: r.failures.map((f) => f.message).join("; ") || "CI wasn't read",
    };
  }
  if (w.noChecks) {
    return {
      pass: r.failures.length === 0,
      reason: `${pr.url} has no CI checks after ${mins(noChecks)}`,
      details: { pr: pr.url, sha, checks: 0 },
    };
  }
  if (w.timedOut) {
    const waiting = w.pending.map((x) => x.name);
    return {
      pass: false,
      reason: `CI still running on ${pr.url} after ${mins(limit)}${waiting.length ? `: ${waiting.join(", ")}` : ""}`,
    };
  }
  if (w.failed.length) {
    return {
      pass: false,
      reason: `CI failed on ${pr.url}: ${w.failed.map((x) => `${x.name} (${x.conclusion})`).join(", ")}`,
      details: {
        pr: pr.url,
        sha,
        failed: w.failed.map((x) => ({
          name: x.name,
          conclusion: x.conclusion,
          url: x.url || null,
        })),
      },
    };
  }
  if (r.failures.length) {
    return {
      pass: false,
      reason: r.failures.map((f) => f.message).join("; "),
    };
  }
  return {
    pass: true,
    reason: `${pr.url}: ${w.runs.length} CI check${w.runs.length === 1 ? "" : "s"} passed`,
    details: { pr: pr.url, sha, checks: w.runs.length },
  };
}

/**
 * Run one of the built-in factory checks.
 * @param {object} check  { kind: one of FACTORY_KINDS, … }
 * @param {object} input  the standard input (with item and workspace)
 * @param {{ cwd?: string, env?: object, exec?: Function, fetch?: Function,
 *           now?: () => number, sleep?: (ms) => Promise }} deps
 */
async function runFactoryCheck(check, input, deps = {}) {
  const bad = factoryCheckError(check);
  if (bad) return { pass: false, reason: `This check can't run: ${bad}` };
  switch (check && check.kind) {
    case "git-on-branch":
      return gitOnBranch(check, input, deps);
    case "git-committed":
      return gitCommitted(check, input, deps);
    case "pr-ci":
      return prCi(check, input, deps);
    case "handoff-has":
      return handoffHas(check, input);
    default:
      return { pass: false, reason: "Not a built-in check" };
  }
}

module.exports = {
  FACTORY_KINDS,
  runFactoryCheck,
  factoryCheckError,
  prOf,
  DEFAULT_CI_SEC,
};
