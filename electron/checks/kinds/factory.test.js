/**
 * factory.test.js — Dash's built-in factory checks (DASH-103): on its
 * branch, work committed, the PR's CI passed, the handoff has keys. Each
 * one's failure says exactly what's wrong.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { runFactoryCheck, factoryCheckError, prOf } = require("./factory");
const { runCheck } = require("../checkRunner");
const { checksError } = require("../../bots/botChecks");
const { CHECK_KINDS } = require("../../flows/flowModel");

let root;
let work;
let plain;
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    env: ENV,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();

const answer = (obj) => ({
  input: { answer: `Done.\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`` },
});
const inWork = (extra = {}) => ({
  ...answer({ summary: "ok" }),
  workspace: { dir: work, branch: "fix/DASH-93" },
  ...extra,
});

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-factory-test-"));
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  work = path.join(root, "work");
  plain = path.join(root, "plain");
  fs.mkdirSync(plain);
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "init", "-q", "-b", "main", seed);
  fs.writeFileSync(path.join(seed, "a.txt"), "a\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "first");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-b", "fix/DASH-93");
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("git-on-branch", () => {
  it("passes on the job's branch, and says where it is when not", async () => {
    const ok = await runFactoryCheck({ kind: "git-on-branch" }, inWork(), {});
    assert.equal(ok.pass, true, ok.reason);
    assert.equal(ok.reason, `${work} is on fix/DASH-93`);
    const bad = await runFactoryCheck(
      { kind: "git-on-branch" },
      inWork({ workspace: { dir: work, branch: "feat/other" } }),
      {},
    );
    assert.equal(bad.pass, false);
    assert.equal(bad.reason, `${work} is on fix/DASH-93, not feat/other`);
  });

  it("takes a branch from its settings, and the folder it runs in", async () => {
    const res = await runFactoryCheck(
      { kind: "git-on-branch", branch: "fix/DASH-93" },
      answer({}),
      { cwd: work },
    );
    assert.equal(res.pass, true, res.reason);
  });

  it("says when there's no branch, workspace or repo", async () => {
    const none = await runFactoryCheck({ kind: "git-on-branch" }, answer({}), {
      cwd: work,
    });
    assert.match(none.reason, /No branch to check/);
    const noWs = await runFactoryCheck(
      { kind: "git-on-branch" },
      answer({}),
      {},
    );
    assert.equal(noWs.reason, "The job has no workspace");
    const notGit = await runFactoryCheck(
      { kind: "git-on-branch" },
      inWork({ workspace: { dir: plain, branch: "x" } }),
      {},
    );
    assert.equal(notGit.reason, `${plain} isn't a git repo`);
  });
});

describe("git-committed", () => {
  it("fails with no commits, then with uncommitted changes, then passes", async () => {
    const none = await runFactoryCheck({ kind: "git-committed" }, inWork(), {});
    assert.equal(none.pass, false);
    assert.equal(
      none.reason,
      "No commits past origin/main: commit the work (git add -A; git commit)",
    );

    fs.writeFileSync(path.join(work, "b.txt"), "b\n");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "DASH-93: b");
    fs.writeFileSync(path.join(work, "c.txt"), "c\n");
    const dirty = await runFactoryCheck(
      { kind: "git-committed", base: "main" },
      inWork(),
      {},
    );
    assert.equal(dirty.pass, false);
    assert.equal(dirty.reason, "There are uncommitted changes: c.txt");

    fs.rmSync(path.join(work, "c.txt"));
    const ok = await runFactoryCheck(
      { kind: "git-committed", base: "origin/main" },
      inWork(),
      {},
    );
    assert.equal(ok.pass, true, ok.reason);
    assert.equal(ok.reason, "1 commit past origin/main, nothing uncommitted");
  });

  it("says when its base isn't there", async () => {
    const res = await runFactoryCheck(
      { kind: "git-committed", base: "nope" },
      inWork(),
      {},
    );
    assert.equal(res.pass, false);
    assert.match(res.reason, /^Can't compare with origin\/nope/);
  });
});

describe("handoff-has", () => {
  it("passes when each key is there and not empty, naming the missing ones", async () => {
    const input = answer({
      prUrl: "https://github.com/a/b/pull/1",
      plan: { cause: "x", fix: "" },
      files: [],
    });
    const ok = await runFactoryCheck(
      { kind: "handoff-has", keys: ["prUrl", "plan.cause"] },
      input,
      {},
    );
    assert.equal(ok.pass, true, ok.reason);
    const bad = await runFactoryCheck(
      { kind: "handoff-has", keys: ["prUrl", "plan.fix", "files", "tests"] },
      input,
      {},
    );
    assert.equal(bad.pass, false);
    assert.equal(
      bad.reason,
      "The handoff has no plan.fix, files, tests (it has prUrl)",
    );
    assert.deepEqual(bad.details.missing, ["plan.fix", "files", "tests"]);
  });

  it("sees Dash's own keys too, and says when there's no handoff", async () => {
    const ok = await runFactoryCheck(
      { kind: "handoff-has", keys: ["summary", "workspace.dir"] },
      answer({ summary: "done", workspace: { dir: "/tmp/x" } }),
      {},
    );
    assert.equal(ok.pass, true, ok.reason);
    const none = await runFactoryCheck(
      { kind: "handoff-has", keys: ["x"] },
      { input: { answer: "no json" } },
      {},
    );
    assert.equal(none.reason, "The answer has no handoff (a ```json block)");
  });
});

/** A fake GitHub: each path answers from `routes`, in order for a list. */
function fakeGitHub(routes) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({
      url,
      auth: opts && opts.headers && opts.headers.Authorization,
    });
    const p = url.replace("https://api.github.com/repos/trops/app/", "");
    const key = Object.keys(routes).find((k) => p.startsWith(k));
    let r = key ? routes[key] : { code: 404, body: {} };
    if (Array.isArray(r)) r = r.length > 1 ? r.shift() : r[0];
    return { status: r.code, json: async () => r.body };
  };
  return { fetch, calls };
}

const PR = answer({ prUrl: "https://github.com/trops/app/pull/12" });
const OPEN = { code: 200, body: { state: "open", head: { sha: "abc" } } };
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms) => (t += ms) };
};

describe("pr-ci", () => {
  it("finds the PR from prUrl, or pr plus the repo", () => {
    assert.equal(prOf({}, PR).number, 12);
    const viaPr = prOf(
      { repo: "https://github.com/trops/app" },
      answer({ pr: 7 }),
    );
    assert.equal(viaPr.url, "https://github.com/trops/app/pull/7");
    assert.match(prOf({}, answer({ pr: 7 })).error, /no PR link/);
    assert.match(
      prOf({}, answer({ prUrl: "nope" })).error,
      /isn't a GitHub PR link/,
    );
  });

  it("passes when every check run passed, signed in with the token", async () => {
    const gh = fakeGitHub({
      "pulls/12": OPEN,
      "commits/abc/check-runs": {
        code: 200,
        body: {
          check_runs: [
            { name: "validate", status: "completed", conclusion: "success" },
            { name: "lint", status: "completed", conclusion: "skipped" },
          ],
        },
      },
    });
    const res = await runFactoryCheck({ kind: "pr-ci" }, PR, {
      fetch: gh.fetch,
      env: { GH_TOKEN: "t0ken" },
      ...clock(),
    });
    assert.equal(res.pass, true, res.reason);
    assert.equal(
      res.reason,
      "https://github.com/trops/app/pull/12: 2 CI checks passed",
    );
    assert.ok(gh.calls.every((c) => c.auth === "Bearer t0ken"));
  });

  it("waits while CI runs, then names what failed", async () => {
    const gh = fakeGitHub({
      "pulls/12": OPEN,
      "commits/abc/check-runs": [
        {
          code: 200,
          body: { check_runs: [{ name: "validate", status: "in_progress" }] },
        },
        {
          code: 200,
          body: {
            check_runs: [
              { name: "validate", status: "completed", conclusion: "failure" },
            ],
          },
        },
      ],
    });
    const c = clock();
    const res = await runFactoryCheck({ kind: "pr-ci" }, PR, {
      fetch: gh.fetch,
      ...c,
    });
    assert.equal(res.pass, false);
    assert.equal(
      res.reason,
      "CI failed on https://github.com/trops/app/pull/12: validate (failure)",
    );
    assert.equal(c.now(), 15000);
  });

  it("falls back to Actions runs, and says when the token can read neither", async () => {
    const viaRuns = fakeGitHub({
      "pulls/12": OPEN,
      "commits/abc/check-runs": { code: 403, body: {} },
      "actions/runs": {
        code: 200,
        body: {
          workflow_runs: [
            { name: "CI", status: "completed", conclusion: "success" },
          ],
        },
      },
    });
    const ok = await runFactoryCheck({ kind: "pr-ci" }, PR, {
      fetch: viaRuns.fetch,
      env: { GH_TOKEN: "t" },
      ...clock(),
    });
    assert.equal(ok.pass, true, ok.reason);
    const neither = fakeGitHub({
      "pulls/12": OPEN,
      "commits/abc/check-runs": { code: 403, body: {} },
      "actions/runs": { code: 403, body: {} },
    });
    const bad = await runFactoryCheck({ kind: "pr-ci" }, PR, {
      fetch: neither.fetch,
      env: { GH_TOKEN: "t" },
      ...clock(),
    });
    assert.equal(
      bad.reason,
      "The GitHub provider's token can't read CI on trops/app (check runs: HTTP 403, Actions runs: HTTP 403). Give it read access to Checks or Actions.",
    );
  });

  it("says when the PR can't be read or isn't open", async () => {
    const gone = fakeGitHub({ "pulls/12": { code: 404, body: {} } });
    const r1 = await runFactoryCheck({ kind: "pr-ci" }, PR, {
      fetch: gone.fetch,
      env: { GH_TOKEN: "t" },
      ...clock(),
    });
    assert.equal(
      r1.reason,
      "Can't read PR #12 on trops/app (HTTP 404): check the GitHub provider's token",
    );
    const closed = fakeGitHub({
      "pulls/12": {
        code: 200,
        body: { state: "closed", head: { sha: "abc" } },
      },
    });
    const r2 = await runFactoryCheck({ kind: "pr-ci" }, PR, {
      fetch: closed.fetch,
      ...clock(),
    });
    assert.equal(
      r2.reason,
      "https://github.com/trops/app/pull/12 isn't open (it's closed)",
    );
  });

  it("no CI after a while passes (or fails, if set); CI that never ends stops", async () => {
    const empty = () =>
      fakeGitHub({
        "pulls/12": OPEN,
        "commits/abc/check-runs": { code: 200, body: { check_runs: [] } },
      });
    const p = await runFactoryCheck({ kind: "pr-ci" }, PR, {
      fetch: empty().fetch,
      ...clock(),
    });
    assert.equal(p.pass, true);
    assert.equal(
      p.reason,
      "https://github.com/trops/app/pull/12 has no CI checks after 3 minutes",
    );
    const f = await runFactoryCheck({ kind: "pr-ci", ifNoChecks: "fail" }, PR, {
      fetch: empty().fetch,
      ...clock(),
    });
    assert.equal(f.pass, false);
    const slow = fakeGitHub({
      "pulls/12": OPEN,
      "commits/abc/check-runs": {
        code: 200,
        body: { check_runs: [{ name: "e2e", status: "queued" }] },
      },
    });
    const s = await runFactoryCheck({ kind: "pr-ci", timeoutSec: 60 }, PR, {
      fetch: slow.fetch,
      ...clock(),
    });
    assert.equal(s.pass, false);
    assert.equal(
      s.reason,
      "CI still running on https://github.com/trops/app/pull/12 after 1 minute: e2e",
    );
  });
});

describe("the built-in kinds", () => {
  it("are known kinds, validated when saved, and run through checkRunner", async () => {
    for (const k of [
      "git-on-branch",
      "git-committed",
      "pr-ci",
      "handoff-has",
    ]) {
      assert.ok(CHECK_KINDS.includes(k), k);
    }
    assert.match(
      factoryCheckError({ kind: "handoff-has", keys: [] }),
      /needs the keys/,
    );
    assert.match(
      factoryCheckError({ kind: "handoff-has", keys: ["a b"] }),
      /isn't a key/,
    );
    assert.match(
      factoryCheckError({ kind: "pr-ci", ifNoChecks: "maybe" }),
      /ifNoChecks/,
    );
    assert.equal(factoryCheckError({ kind: "pr-ci" }), null);
    const step = (check) => ({ kind: "check", name: "x", check });
    assert.equal(
      checksError({
        steps: [step({ kind: "git-committed", base: "{repo.baseBranch}" })],
      }),
      null,
    );
    assert.match(
      checksError({ steps: [step({ kind: "handoff-has" })] }),
      /needs the keys/,
    );
    const res = await runCheck(
      { kind: "handoff-has", keys: ["summary"] },
      answer({ summary: "ok" }),
      {},
    );
    assert.equal(res.pass, true, res.reason);
    assert.equal(res.kind, "handoff-has");
  });
});
