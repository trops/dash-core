/**
 * workFolder.test.js — real work on your files (phase 5): a flow task
 * gets its own git worktree of the bot's folder, on a branch for the goal,
 * inside the goal's work folder — never your checkout. A folder that isn't
 * a repo is worked in where it is. Uses a real git repo in a temp folder.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  prepareWorkFolder,
  pruneWorktrees,
  branchFor,
} = require("./workFolder");

let dir;
let repo;
const g = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-workfolder-"));
  repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  g(repo, "init", "-q", "-b", "main");
  g(repo, "config", "user.email", "test@example.com");
  g(repo, "config", "user.name", "Test");
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  g(repo, "add", "README.md");
  g(repo, "commit", "-q", "-m", "first");
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("prepareWorkFolder", () => {
  it("makes the task its own worktree on the goal's branch, and reuses it", () => {
    const workRoot = path.join(dir, "goals", "goal_abc123", "work");
    const r = prepareWorkFolder({
      folder: repo,
      goalId: "goal_abc123",
      workRoot,
    });
    assert.equal(r.kind, "worktree");
    assert.equal(r.branch, "dash/abc123");
    assert.equal(r.dir, path.join(workRoot, "repo"));
    assert.ok(fs.existsSync(path.join(r.dir, "README.md")));
    assert.equal(g(r.dir, "rev-parse", "--abbrev-ref", "HEAD"), "dash/abc123");
    // The user's checkout stays on its own branch.
    assert.equal(g(repo, "rev-parse", "--abbrev-ref", "HEAD"), "main");
    // A change in the copy doesn't touch the checkout.
    fs.writeFileSync(path.join(r.dir, "README.md"), "changed\n");
    assert.equal(
      fs.readFileSync(path.join(repo, "README.md"), "utf8"),
      "hello\n",
    );
    const again = prepareWorkFolder({
      folder: repo,
      goalId: "goal_abc123",
      workRoot,
    });
    assert.equal(again.dir, r.dir);
  });

  it("forgets a deleted goal's worktree when pruned", () => {
    const workRoot = path.join(dir, "goals", "goal_zzz999", "work");
    const r = prepareWorkFolder({
      folder: repo,
      goalId: "goal_zzz999",
      workRoot,
    });
    assert.match(g(repo, "worktree", "list"), /dash\/zzz999/);
    fs.rmSync(path.join(dir, "goals", "goal_zzz999"), {
      recursive: true,
      force: true,
    });
    pruneWorktrees([repo]);
    assert.doesNotMatch(g(repo, "worktree", "list"), /zzz999/);
    assert.ok(r.dir);
  });

  it("a folder that isn't a repo is worked in where it is; a missing one is an error", () => {
    const notes = path.join(dir, "notes");
    fs.mkdirSync(notes);
    assert.deepEqual(
      prepareWorkFolder({ folder: notes, goalId: "goal_x", workRoot: dir }),
      {
        dir: notes,
        kind: "folder",
      },
    );
    assert.match(
      prepareWorkFolder({
        folder: path.join(dir, "nope"),
        goalId: "g",
        workRoot: dir,
      }).error,
      /isn't there/,
    );
    assert.match(
      prepareWorkFolder({ folder: null, goalId: "g", workRoot: dir }).error,
      /No folder/,
    );
    assert.equal(branchFor("goal_123456"), "dash/123456");
  });
});
