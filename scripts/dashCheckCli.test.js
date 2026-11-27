/**
 * dashCheckCli.test.js — `dash-check` (DASH-107): runs a repo's
 * .dash/checks by hand and in CI with Dash's contract, and the checks
 * guide is the same in MCP and in the shipped skill.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { main, listChecks } = require("./dashCheckCli");
const { CHECKS_GUIDE } = require("../electron/mcp/checksGuide");

let root;
let repo;
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (cwd, ...a) =>
  execFileSync("git", a, {
    cwd,
    env: ENV,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
const write = (rel, body) => {
  const f = path.join(repo, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
};

function run(args) {
  const out = [];
  const code = main([...args, "--cwd", repo], {
    log: (s) => out.push(s),
    err: (s) => out.push(s),
  });
  return { code, out: out.join("\n") };
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-check-cli-test-"));
  const origin = path.join(root, "origin.git");
  repo = path.join(root, "repo");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "init", "-q", "-b", "main", repo);
  write(
    ".dash/checks/validate.sh",
    'echo "{\\"reason\\": \\"Validated step=$DASH_STEP item=$DASH_ITEM_ID\\"}"\n',
  );
  write(
    ".dash/checks/plan-complete.js",
    "const i = JSON.parse(require('fs').readFileSync(process.env.DASH_INPUT, 'utf8'));\nconst ok = /Test plan/.test(i.input.answer);\nconsole.log(JSON.stringify({ reason: ok ? 'Has a test plan' : 'No test plan' }));\nprocess.exit(ok ? 0 : 1);\n",
  );
  write(".dash/checks/README.md", "Not a check.\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "checks");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");
  // Edited but not committed: the workspace's copy differs from main's.
  write(".dash/checks/validate.sh", "echo 'edited'\nexit 4\n");
  fs.writeFileSync(
    path.join(root, "good.json"),
    JSON.stringify({
      input: { answer: "Done. Test plan: x" },
      item: { id: "DASH-7" },
    }),
  );
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("dash-check", () => {
  it("lists the checks (not READMEs)", () => {
    const { checks } = listChecks(repo);
    assert.deepEqual(
      checks.map((c) => c.name),
      ["plan-complete", "validate"],
    );
    const r = run(["--list"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /validate\t\.dash\/checks\/validate\.sh/);
  });

  it("runs one with a sample input, passing and failing with its reason", () => {
    const good = run([
      "plan-complete",
      "--input",
      path.join(root, "good.json"),
    ]);
    assert.equal(good.code, 0, good.out);
    assert.match(good.out, /✓ plan-complete: Has a test plan/);
    const bad = run(["plan-complete"]);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /✗ plan-complete: No test plan/);
  });

  it("runs the workspace's copy, or the base branch's with --base", () => {
    const ws = run(["validate"]);
    assert.equal(ws.code, 1);
    assert.match(ws.out, /edited/);
    assert.match(ws.out, /✗ validate: Failed \(exit 4\)/);
    const base = run([
      "validate",
      "--base",
      "--input",
      path.join(root, "good.json"),
    ]);
    assert.equal(base.code, 0, base.out);
    assert.match(base.out, /✓ validate: Validated step=validate item=DASH-7/);
  });

  it("--ci runs every check and fails if one does", () => {
    const r = run(["--ci", "--input", path.join(root, "good.json")]);
    assert.equal(r.code, 1);
    assert.match(r.out, /✓ plan-complete/);
    assert.match(r.out, /✗ validate/);
    const one = run([
      "--ci",
      "plan-complete",
      "--input",
      path.join(root, "good.json"),
    ]);
    assert.equal(one.code, 0, one.out);
  });

  it("says when a check isn't there, or its name can't be one", () => {
    const missing = run(["lint"]);
    assert.equal(missing.code, 2);
    assert.match(missing.out, /there's no \.dash\/checks\/lint/);
    assert.equal(run(["../x"]).code, 2);
    assert.equal(run(["--nope"]).code, 2);
  });

  it("prints the guide", () => {
    const r = run(["--guide"]);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), CHECKS_GUIDE.trim());
  });
});

describe("the checks guide (DASH-107)", () => {
  it("is the setup guide's 'checks' topic", () => {
    const defs = Object.values(require("../electron/mcp/toolDefinitions"))
      .flat()
      .filter((t) => t && t.name === "get_setup_guide");
    assert.equal(defs.length, 1, "get_setup_guide is defined");
    const topic = defs[0].inputSchema.properties.topic;
    assert.ok(topic.enum.includes("checks"));
    const handlers = fs.readFileSync(
      path.join(__dirname, "..", "electron", "mcp", "toolHandlers.js"),
      "utf8",
    );
    assert.match(handlers, /GUIDE_CONTENT\.checks = CHECKS_GUIDE;/);
  });

  it("ships as the dash-check-authoring skill, word for word", () => {
    const skill = fs.readFileSync(
      path.join(__dirname, "..", "skills", "dash-check-authoring", "SKILL.md"),
      "utf8",
    );
    assert.match(
      skill,
      /^---\nname: dash-check-authoring\ndescription: .+\n---\n\n/,
    );
    assert.equal(skill.replace(/^---[\s\S]*?---\n\n/, ""), CHECKS_GUIDE);
  });

  it("covers the contract, the manifest, templates, trying it and the rule", () => {
    for (const s of [
      "DASH_INPUT",
      "check.json",
      "#!/usr/bin/env bash",
      "process.env.DASH_INPUT",
      "import json",
      "dash-check",
      "Deterministic",
      "reviewer",
    ]) {
      assert.ok(CHECKS_GUIDE.includes(s), s);
    }
  });
});
