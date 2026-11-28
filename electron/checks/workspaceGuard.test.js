/**
 * workspaceGuard.test.js — no check passes on a workspace that isn't there
 * (DASH-165). Every kind that works in the job's folder (command, repo,
 * package, recipe, helper and the built-in git kinds) fails with a clear
 * reason when the job's workspace was removed, and those that read git
 * fail when the folder isn't a git repo. Kinds that never touch a folder
 * (rules, script, tool, handoff, handoff-has, pr-ci) are unaffected.
 */
"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { tempDir } = require("../testUtils/tempDir");
const { runCheck, workFolderProblem } = require("./checkRunner");
const { folderProblem } = require("./workspaceGuard");
const { FACTORY_HELPERS } = require("./kinds/helper");

let root;
let gone;
let plain;
let repo;

const answer = (extra = {}) => ({
  input: {
    answer: 'Done.\n\n```json\n{ "summary": "ok", "files": ["a.js"] }\n```',
  },
  ...extra,
});
const inWs = (dir) => answer({ workspace: { dir, branch: "fix/x" } });

before(() => {
  root = tempDir("dash-wsguard-");
  gone = path.join(root, "DASH-147");
  plain = path.join(root, "plain");
  repo = path.join(root, "repo");
  fs.mkdirSync(plain);
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
});

const GONE = /The job's workspace \(.*DASH-147\) isn't there/;

describe("a job's workspace that was removed (DASH-165)", () => {
  // The bot's own folder exists (where a check used to fall back to):
  // the check still fails, it never runs somewhere else.
  const deps = () => ({ cwd: plain, tmpDir: root });

  it("command fails, saying the workspace is gone", async () => {
    const r = await runCheck(
      { kind: "command", command: "true" },
      inWs(gone),
      deps(),
    );
    assert.equal(r.pass, false);
    assert.match(r.reason, GONE);
  });

  it("repo fails", async () => {
    const r = await runCheck({ kind: "repo", name: "validate" }, inWs(gone), {
      ...deps(),
    });
    assert.equal(r.pass, false);
    assert.match(r.reason, GONE);
  });

  it("package fails", async () => {
    const r = await runCheck(
      { kind: "package", package: "node-tests-pass" },
      inWs(gone),
      deps(),
    );
    assert.equal(r.pass, false);
    assert.match(r.reason, GONE);
  });

  it("recipe fails", async () => {
    const r = await runCheck(
      {
        kind: "recipe",
        recipe: {
          name: "clean",
          steps: [{ use: "git.changesMatchPlan", with: { planKeys: "files" } }],
        },
      },
      inWs(gone),
      deps(),
    );
    assert.equal(r.pass, false);
    assert.match(r.reason, GONE);
  });

  for (const use of FACTORY_HELPERS) {
    it(`helper ${use} fails`, async () => {
      const r = await runCheck({ kind: "helper", use }, inWs(gone), deps());
      assert.equal(r.pass, false);
      assert.match(r.reason, GONE);
    });
  }

  it("git-on-branch fails", async () => {
    const r = await runCheck({ kind: "git-on-branch" }, inWs(gone), deps());
    assert.equal(r.pass, false);
    assert.match(r.reason, GONE);
  });

  it("git-committed fails", async () => {
    const r = await runCheck({ kind: "git-committed" }, inWs(gone), deps());
    assert.equal(r.pass, false);
    assert.match(r.reason, GONE);
  });

  it("a check that doesn't touch a folder is unaffected", async () => {
    const r = await runCheck(
      { kind: "handoff-has", keys: ["files"] },
      inWs(gone),
      deps(),
    );
    assert.equal(r.pass, true, r.reason);
    assert.equal(
      workFolderProblem({ kind: "rules", rules: [] }, inWs(gone), plain),
      null,
    );
  });
});

describe("a folder that isn't a git repo (DASH-165)", () => {
  it("every factory helper fails instead of finding no changes", async () => {
    for (const use of FACTORY_HELPERS) {
      const r = await runCheck({ kind: "helper", use }, inWs(plain), {});
      assert.equal(r.pass, false, use);
      assert.match(r.reason, /isn't a git repo/, use);
    }
  });

  it("git-on-branch and git-committed fail", async () => {
    for (const kind of ["git-on-branch", "git-committed"]) {
      const r = await runCheck({ kind }, inWs(plain), {});
      assert.equal(r.pass, false, kind);
      assert.match(r.reason, /isn't a git repo/, kind);
    }
  });

  it("a git repo passes the guard", () => {
    assert.equal(folderProblem(inWs(repo), null, { git: true }), null);
  });
});

describe("no folder at all (DASH-165)", () => {
  it("a helper with no workspace and no folder fails", async () => {
    const r = await runCheck(
      { kind: "helper", use: "git.changesMatchPlan" },
      answer(),
      {},
    );
    assert.equal(r.pass, false);
    assert.match(r.reason, /no workspace and the bot has no folder/);
  });
});
