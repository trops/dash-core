/**
 * listNodeTests.test.js — scripts/listNodeTests.js and the ci-test-list
 * check (DASH-158), on a temporary git repo.
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { tempDir } = require("../electron/testUtils/tempDir");
const { allNodeTests, nodeTestsToRun } = require("./listNodeTests");

const CHECK = path.join(__dirname, "..", ".dash", "checks", "ci-test-list.js");

let repo;
function write(file, text) {
  const p = path.join(repo, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
function check() {
  const r = spawnSync(process.execPath, [CHECK], {
    env: { ...process.env, DASH_WORKSPACE: repo },
    encoding: "utf8",
  });
  const last = r.stdout.trim().split("\n").pop();
  return { code: r.status, result: JSON.parse(last) };
}

beforeEach(() => {
  repo = tempDir("list-node-tests-");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  write(".gitignore", "ignored/\n");
  write("electron/a.test.js", 'require("node:test");\n');
  write("scripts/b.test.cjs", "const t = require('node:test');\n");
  write("electron/new.test.js", 'import { it } from "node:test";\n');
  write("src/c.test.js", "test('jest', () => {});\n"); // jest's
  write("ignored/d.test.js", 'require("node:test");\n');
  write("node_modules/x/e.test.js", 'require("node:test");\n');
  execFileSync("git", ["add", ".gitignore", "electron/a.test.js"], {
    cwd: repo,
  });
});

describe("listNodeTests", () => {
  it("finds every node:test file, tracked or new, and nothing else", () => {
    assert.deepEqual(allNodeTests(repo), [
      "electron/a.test.js",
      "electron/new.test.js",
      "scripts/b.test.cjs",
    ]);
  });

  it("leaves out the quarantined", () => {
    write(
      ".dash/checks/ci-test-list.known.txt",
      "# header\nelectron/a.test.js   # DASH-999: hangs\n",
    );
    assert.deepEqual(nodeTestsToRun(repo), [
      "electron/new.test.js",
      "scripts/b.test.cjs",
    ]);
  });
});

describe("ci-test-list check", () => {
  it("passes when ci.sh runs them all through listNodeTests.js", () => {
    write("scripts/ci.sh", "node --test $(node scripts/listNodeTests.js)\n");
    const { code, result } = check();
    assert.equal(code, 0, result.reason);
    assert.match(result.reason, /All 3 node:test files run/);
  });

  it("fails on a hand-kept list that misses a file", () => {
    write("scripts/ci.sh", "node --test electron/a.test.js\n");
    const { code, result } = check();
    assert.equal(code, 1);
    assert.deepEqual(result.details.missing, [
      "electron/new.test.js",
      "scripts/b.test.cjs",
    ]);
  });

  it("fails on a quarantined file with no Jira bug", () => {
    write("scripts/ci.sh", "node --test $(node scripts/listNodeTests.js)\n");
    write(
      ".dash/checks/ci-test-list.known.txt",
      "electron/a.test.js # flaky\n",
    );
    const { code, result } = check();
    assert.equal(code, 1);
    assert.match(result.reason, /name no Jira bug/);
  });

  it("counts a ticketed quarantine as such", () => {
    write("scripts/ci.sh", "node --test $(node scripts/listNodeTests.js)\n");
    write(
      ".dash/checks/ci-test-list.known.txt",
      "electron/a.test.js   # DASH-999: hangs\n",
    );
    const { code, result } = check();
    assert.equal(code, 0);
    assert.match(result.reason, /1 quarantined, each with a ticket/);
  });
});
