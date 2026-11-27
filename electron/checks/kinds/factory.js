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
 */
"use strict";

const fs = require("fs");
const { execFile } = require("child_process");
const { readHandoff } = require("../../bots/botHandoff");

const FACTORY_KINDS = [
  "git-on-branch",
  "git-committed",
  "pr-ci",
  "handoff-has",
];
const DEFAULT_CI_SEC = 20 * 60;
const MAX_CI_SEC = 60 * 60;
const DEFAULT_NO_CHECKS_SEC = 180;
const POLL_MS = 15 * 1000;
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
  const cur = await git(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    g.dir,
    deps.exec,
  );
  if (!cur.ok)
    return { pass: false, reason: `Can't read ${g.dir}'s branch: ${cur.err}` };
  if (cur.out !== want) {
    return {
      pass: false,
      reason: `${g.dir} is on ${cur.out === "HEAD" ? "no branch (a detached HEAD)" : cur.out}, not ${want}`,
      details: { dir: g.dir, branch: cur.out, want },
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
  const count = await git(
    ["rev-list", "--count", `origin/${base}..HEAD`],
    g.dir,
    deps.exec,
  );
  if (!count.ok) {
    return {
      pass: false,
      reason: `Can't compare with origin/${base}: ${count.err}`,
    };
  }
  const n = Number(count.out) || 0;
  if (n < 1) {
    return {
      pass: false,
      reason: `No commits past origin/${base}: commit the work (git add -A; git commit)`,
      details: { dir: g.dir, base, commits: 0 },
    };
  }
  const status = await git(["status", "--porcelain"], g.dir, deps.exec);
  if (!status.ok)
    return {
      pass: false,
      reason: `Can't read ${g.dir}'s status: ${status.err}`,
    };
  if (status.out) {
    const files = status.out
      .split("\n")
      .map((l) => l.slice(3))
      .filter(Boolean);
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
  return {
    pass: true,
    reason: `${n} commit${n === 1 ? "" : "s"} past origin/${base}, nothing uncommitted`,
    details: { dir: g.dir, base, commits: n },
  };
}

/** A value at a dotted key ("plan.cause"). */
function at(obj, key) {
  return key
    .split(".")
    .reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

const isEmpty = (v) =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && !v.trim()) ||
  (Array.isArray(v) && !v.length) ||
  (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

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

function handoffHas(check, input) {
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
  const missing = keys.filter((k) => isEmpty(at(obj, k)));
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
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const limit = ciSeconds(check.timeoutSec, DEFAULT_CI_SEC, MAX_CI_SEC);
  const noChecks = ciSeconds(check.noChecksSec, DEFAULT_NO_CHECKS_SEC, limit);
  const slug = `${pr.owner}/${pr.repo}`;
  const api = async (p) => {
    try {
      const res = await doFetch(`https://api.github.com/repos/${slug}/${p}`, {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      let body = null;
      try {
        body = await res.json();
      } catch (_e) {
        body = null;
      }
      return { code: res.status, body };
    } catch (e) {
      return { code: 0, body: null, error: (e && e.message) || String(e) };
    }
  };
  const who = token
    ? "the GitHub provider's token"
    : "Dash (no GitHub provider is signed in for this bot)";
  const p = await api(`pulls/${pr.number}`);
  if (p.code !== 200) {
    return {
      pass: false,
      reason: p.code
        ? `Can't read PR #${pr.number} on ${slug} (HTTP ${p.code}): check ${who}`
        : `Can't reach GitHub: ${p.error}`,
    };
  }
  const state = p.body && p.body.state;
  if (state !== "open" && !(p.body && p.body.merged)) {
    return {
      pass: false,
      reason: `${pr.url} isn't open (it's ${state || "unknown"})`,
    };
  }
  const sha = p.body && p.body.head && p.body.head.sha;
  if (!sha)
    return { pass: false, reason: `Couldn't read ${pr.url}'s last commit` };
  const started = now();
  for (;;) {
    let runs;
    let c = await api(`commits/${sha}/check-runs?per_page=100`);
    if (c.code === 200) {
      runs = (c.body && c.body.check_runs) || [];
    } else {
      const first = c.code;
      c = await api(`actions/runs?head_sha=${sha}&per_page=100`);
      if (c.code !== 200) {
        return {
          pass: false,
          reason: `${who.replace(/^the/, "The")} can't read CI on ${slug} (check runs: HTTP ${first}, Actions runs: HTTP ${c.code}). Give it read access to Checks or Actions.`,
        };
      }
      runs = (c.body && c.body.workflow_runs) || [];
    }
    const elapsed = (now() - started) / 1000;
    if (!runs.length) {
      if (elapsed >= noChecks) {
        const pass = check.ifNoChecks !== "fail";
        return {
          pass,
          reason: `${pr.url} has no CI checks after ${mins(noChecks)}`,
          details: { pr: pr.url, sha, checks: 0 },
        };
      }
    } else if (runs.every((r) => r.status === "completed")) {
      const bad = runs.filter(
        (r) => !["success", "skipped", "neutral"].includes(r.conclusion),
      );
      if (bad.length) {
        return {
          pass: false,
          reason: `CI failed on ${pr.url}: ${bad.map((r) => `${r.name} (${r.conclusion})`).join(", ")}`,
          details: {
            pr: pr.url,
            sha,
            failed: bad.map((r) => ({
              name: r.name,
              conclusion: r.conclusion,
              url: r.html_url || null,
            })),
          },
        };
      }
      return {
        pass: true,
        reason: `${pr.url}: ${runs.length} CI check${runs.length === 1 ? "" : "s"} passed`,
        details: { pr: pr.url, sha, checks: runs.length },
      };
    }
    if (elapsed >= limit) {
      const waiting = runs
        .filter((r) => r.status !== "completed")
        .map((r) => r.name);
      return {
        pass: false,
        reason: `CI still running on ${pr.url} after ${mins(limit)}${waiting.length ? `: ${waiting.join(", ")}` : ""}`,
      };
    }
    await sleep(POLL_MS);
  }
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
