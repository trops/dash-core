/**
 * repo.test.js — a check kept in the repo (DASH-102): Dash finds
 * .dash/checks/<name> (any extension) on the repo's base branch, runs it in
 * the workspace like a command check, and says plainly when it isn't there
 * (fail, skip, or the fallback).
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { runRepoCheck, repoCheckError, pickFile, runnerFor } = require("./repo");
const { runCheck } = require("../checkRunner");
const { checksError, cleanBotChecks } = require("../../bots/botChecks");
const { CHECK_KINDS } = require("../../flows/flowModel");

let root;
let origin;
let work;
let plain;

const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).toString();

const write = (dir, rel, body) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
};

const INPUT = {
  input: { answer: "Done.\n\nTest plan: run it." },
  item: { id: "DASH-93" },
};

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-repo-check-test-"));
  origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  work = path.join(root, "work");
  plain = path.join(root, "plain");
  fs.mkdirSync(plain);
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "init", "-q", "-b", "main", seed);
  // On main: a passing validate.sh, a .js check that reads its input, one
  // with a #! line, and a check that fails with a reason.
  write(
    seed,
    ".dash/checks/validate.sh",
    'echo "step=$DASH_STEP item=$DASH_ITEM_ID"\necho \'{"reason": "Validated on main"}\'\n',
  );
  write(
    seed,
    ".dash/checks/plan-complete.js",
    [
      'const fs = require("fs");',
      "const input = JSON.parse(fs.readFileSync(process.env.DASH_INPUT, 'utf8'));",
      "const ok = /Test plan:/.test(input.input.answer);",
      'console.log(JSON.stringify({ reason: ok ? "Has a test plan" : "No test plan", details: { item: input.item.id } }));',
      "process.exit(ok ? 0 : 1);",
      "",
    ].join("\n"),
  );
  write(seed, ".dash/checks/banged", "#!/bin/sh\necho banged\nexit 0\n");
  write(seed, ".dash/checks/fails.sh", "echo nope\nexit 3\n");
  git(seed, "add", "-A");
  git(
    seed,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.com",
    "commit",
    "-qm",
    "checks",
  );
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, work);
  // The work branch changes validate.sh to fail and adds a new check:
  // neither counts until it's on main.
  git(work, "checkout", "-q", "-b", "fix/DASH-93");
  write(
    work,
    ".dash/checks/validate.sh",
    "echo 'changed on the branch'\nexit 0\n",
  );
  write(work, ".dash/checks/only-here.sh", "echo here\nexit 0\n");
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const opts = (extra = {}) => ({
  cwd: work,
  tmpDir: root,
  env: { DASH_ITEM_ID: "DASH-93", DASH_STEP: "Validate" },
  ...extra,
});

describe("finding a repo's check", () => {
  it("picks the exact name, else name.<ext>", () => {
    assert.equal(pickFile(["validate", "validate.sh"], "validate"), "validate");
    assert.equal(pickFile(["validate.sh", "x.js"], "validate"), "validate.sh");
    assert.equal(pickFile(["validate.sh.bak"], "validate"), null);
    assert.equal(pickFile([], "validate"), null);
  });

  it("runs by #! line, else by extension", () => {
    assert.equal(runnerFor("a.js", ""), "node");
    assert.equal(runnerFor("a.mjs", ""), "node");
    assert.equal(runnerFor("a.sh", ""), "bash");
    assert.equal(runnerFor("a.py", ""), "python3");
    assert.equal(runnerFor("a", ""), "sh");
    assert.equal(runnerFor("a.sh", "#!/usr/bin/env zsh"), null);
  });
});

describe("running a repo's check", () => {
  it("runs the base branch's copy, not the work branch's", async () => {
    const res = await runRepoCheck(
      { kind: "repo", name: "validate" },
      INPUT,
      opts(),
    );
    assert.equal(res.pass, true, res.reason);
    assert.equal(res.reason, "Validated on main");
    assert.match(res.output, /step=Validate item=DASH-93/);
    assert.doesNotMatch(res.output, /changed on the branch/);
  });

  it("reads the workspace's copy with from: workspace", async () => {
    const res = await runRepoCheck(
      { kind: "repo", name: "validate", from: "workspace" },
      INPUT,
      opts(),
    );
    assert.equal(res.pass, true, res.reason);
    assert.match(res.output, /changed on the branch/);
  });

  it("a .js check gets the input in $DASH_INPUT", async () => {
    const res = await runRepoCheck(
      { kind: "repo", name: "plan-complete" },
      INPUT,
      opts(),
    );
    assert.equal(res.pass, true, res.reason);
    assert.equal(res.reason, "Has a test plan");
    assert.deepEqual(res.details, { item: "DASH-93" });
    const bad = await runRepoCheck(
      { kind: "repo", name: "plan-complete" },
      { ...INPUT, input: { answer: "Done." } },
      opts(),
    );
    assert.equal(bad.pass, false);
    assert.equal(bad.reason, "No test plan");
  });

  it("a file with a #! line runs as itself", async () => {
    const res = await runRepoCheck(
      { kind: "repo", name: "banged" },
      INPUT,
      opts(),
    );
    assert.equal(res.pass, true, res.reason);
    assert.match(res.output, /banged/);
  });

  it("a failing check says which file and the exit code", async () => {
    const res = await runRepoCheck(
      { kind: "repo", name: "fails" },
      INPUT,
      opts(),
    );
    assert.equal(res.pass, false);
    assert.equal(res.exitCode, 3);
    assert.match(
      res.reason,
      /^\.dash\/checks\/fails\.sh on origin\/main: Failed \(exit 3\)$/,
    );
  });

  it("names the base branch it was given", async () => {
    const res = await runRepoCheck(
      { kind: "repo", name: "validate", base: "main" },
      INPUT,
      opts(),
    );
    assert.equal(res.pass, true, res.reason);
    const none = await runRepoCheck(
      { kind: "repo", name: "validate", base: "nope" },
      INPUT,
      opts(),
    );
    assert.equal(none.pass, false);
    assert.match(none.reason, /"nope" isn't there/);
  });
});

describe("when the repo has no such check", () => {
  it("fails by default, saying what to add", async () => {
    const res = await runRepoCheck(
      { kind: "repo", name: "only-here" },
      INPUT,
      opts(),
    );
    assert.equal(res.pass, false);
    assert.equal(
      res.reason,
      "This repo (on origin/main) has no .dash/checks/only-here: add it, or give the step a fallback",
    );
  });

  it("passes, saying so, with ifMissing: skip", async () => {
    const res = await runRepoCheck(
      { kind: "repo", name: "lint", ifMissing: "skip" },
      INPUT,
      opts(),
    );
    assert.equal(res.pass, true);
    assert.match(res.reason, /^Skipped: .*no \.dash\/checks\/lint$/);
  });

  it("runs its fallback (through checkRunner)", async () => {
    const res = await runCheck(
      {
        kind: "repo",
        name: "lint",
        fallback: { kind: "command", command: "echo fell back" },
      },
      INPUT,
      { cwd: work, tmpDir: root },
    );
    assert.equal(res.pass, true, res.reason);
    assert.equal(res.kind, "repo");
    assert.match(
      res.reason,
      /has no \.dash\/checks\/lint, so its fallback ran: Passed/,
    );
    assert.match(res.output, /fell back/);
  });

  it("a folder that isn't a git repo says to use from: workspace", async () => {
    const res = await runRepoCheck(
      { kind: "repo", name: "validate" },
      INPUT,
      opts({ cwd: plain }),
    );
    assert.equal(res.pass, false);
    assert.match(res.reason, /isn't a git repo.*"from": "workspace"/);
    const ws = await runRepoCheck(
      { kind: "repo", name: "validate", from: "workspace", ifMissing: "skip" },
      INPUT,
      opts({ cwd: plain }),
    );
    assert.equal(ws.pass, true);
    assert.match(ws.reason, /^Skipped: The workspace has no/);
  });
});

describe("a repo check's settings", () => {
  it("are checked before it runs and when saved", async () => {
    assert.equal(repoCheckError({ kind: "repo", name: "validate" }), null);
    assert.match(repoCheckError({ kind: "repo" }), /needs the name/);
    assert.match(
      repoCheckError({ kind: "repo", name: "../x" }),
      /can't be a check's name/,
    );
    assert.match(
      repoCheckError({ kind: "repo", name: "a/b" }),
      /can't be a check's name/,
    );
    assert.match(
      repoCheckError({ kind: "repo", name: "v", ifMissing: "maybe" }),
      /ifMissing/,
    );
    assert.match(
      repoCheckError({ kind: "repo", name: "v", from: "elsewhere" }),
      /from must/,
    );
    assert.match(
      repoCheckError({
        kind: "repo",
        name: "v",
        fallback: { kind: "repo", name: "w" },
      }),
      /can't be another repo check/,
    );
    const res = await runRepoCheck(
      { kind: "repo", name: "../../etc/passwd" },
      INPUT,
      opts(),
    );
    assert.equal(res.pass, false);
    assert.match(res.reason, /^This check can't run/);
  });

  it("are a known kind for a bot's checks", () => {
    const step = {
      kind: "check",
      name: "Validate",
      check: { kind: "repo", name: "validate" },
    };
    assert.equal(checksError({ steps: [step] }), null);
    assert.match(
      checksError({
        steps: [{ ...step, check: { kind: "repo", name: "../x" } }],
      }),
      /can't be a check's name/,
    );
    assert.ok(CHECK_KINDS.includes("repo"));
    const cleaned = cleanBotChecks({ steps: [{ ...step, held: true }] });
    assert.equal(cleaned.steps[0].held, true);
  });
});

describe("a plain repo check's step inputs (DASH-107)", () => {
  it("reach it as DASH_CHECK_<NAME>", async () => {
    write(
      work,
      ".dash/checks/says-heading.sh",
      'echo "{\\"reason\\": \\"heading=${DASH_CHECK_HEADING:-Plan}\\"}"\n',
    );
    const set = await runRepoCheck(
      {
        kind: "repo",
        name: "says-heading",
        from: "workspace",
        inputs: { heading: "Goal", bad: { x: 1 } },
      },
      INPUT,
      opts(),
    );
    assert.equal(set.pass, true, set.reason);
    assert.equal(set.reason, "heading=Goal");
    const unset = await runRepoCheck(
      { kind: "repo", name: "says-heading", from: "workspace" },
      INPUT,
      opts(),
    );
    assert.equal(unset.reason, "heading=Plan");
  });
});
