/**
 * dashCheckCli.test.js — `dash-check` (DASH-107): runs a repo's
 * .dash/checks by hand and in CI with Dash's contract, and the checks
 * guide is the same in MCP and in the shipped skill. Since DASH-133 it
 * hands off to @trops/dash-check's CLI, keeping --base and --guide.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { main } = require("./dashCheckCli");
const { listChecks } = require("@trops/dash-check/cli");
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

async function run(args) {
  const out = [];
  const code = await main([...args, "--cwd", repo], {
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
  it("lists the checks (not READMEs)", async () => {
    const checks = listChecks(repo);
    assert.deepEqual(
      checks.map((c) => c.name),
      ["plan-complete", "validate"],
    );
    const r = await run(["--list"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /validate\t\.dash\/checks\/validate\.sh/);
  });

  it("runs one with a sample input, passing and failing with its reason", async () => {
    const good = await run([
      "plan-complete",
      "--input",
      path.join(root, "good.json"),
    ]);
    assert.equal(good.code, 0, good.out);
    assert.match(good.out, /✓ plan-complete: Has a test plan/);
    const bad = await run(["plan-complete"]);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /✗ plan-complete: No test plan/);
  });

  it("runs the workspace's copy, or the base branch's with --base", async () => {
    const ws = await run(["validate"]);
    assert.equal(ws.code, 1);
    assert.match(ws.out, /edited/);
    assert.match(ws.out, /✗ validate: Failed \(exit 4\)/);
    const base = await run([
      "validate",
      "--base",
      "--input",
      path.join(root, "good.json"),
    ]);
    assert.equal(base.code, 0, base.out);
    assert.match(base.out, /✓ validate: Validated step=validate item=DASH-7/);
  });

  it("--ci runs every check and fails if one does", async () => {
    const r = await run(["--ci", "--input", path.join(root, "good.json")]);
    assert.equal(r.code, 1);
    assert.match(r.out, /✓ plan-complete/);
    assert.match(r.out, /✗ validate/);
    const one = await run([
      "--ci",
      "plan-complete",
      "--input",
      path.join(root, "good.json"),
    ]);
    assert.equal(one.code, 0, one.out);
  });

  it("says when a check isn't there, or its name can't be one", async () => {
    const missing = await run(["lint"]);
    assert.equal(missing.code, 2);
    assert.match(missing.out, /there's no \.dash\/checks\/lint/);
    assert.equal((await run(["../x"])).code, 2);
    assert.equal((await run(["--nope"])).code, 2);
  });

  it("runs .check.js and .check.json through @trops/dash-check (DASH-133)", async () => {
    write(
      ".dash/checks/listed.check.js",
      'const { check, expect } = require("@trops/dash-check");\ncheck("listed", (ctx) => {\n  expect(ctx.item.id, "item.id").toBe("DASH-7", "Not DASH-7");\n});\n',
    );
    write(
      ".dash/checks/answered.check.json",
      JSON.stringify({
        name: "answered",
        steps: [
          {
            expect: "answer",
            matcher: "toMatch",
            args: ["Test plan"],
            message: "No test plan in the answer",
          },
        ],
      }),
    );
    const good = path.join(root, "good.json");
    const js = await run(["listed", "--input", good]);
    assert.equal(js.code, 0, js.out);
    const jsBad = await run(["listed"]);
    assert.equal(jsBad.code, 1);
    assert.match(jsBad.out, /Not DASH-7/);
    const recipe = await run(["answered", "--input", good]);
    assert.equal(recipe.code, 0, recipe.out);
    const recipeBad = await run(["answered"]);
    assert.equal(recipeBad.code, 1);
    assert.match(recipeBad.out, /No test plan in the answer/);
    const list = await run(["--list"]);
    assert.match(list.out, /listed\t\.dash\/checks\/listed\.check\.js\tjs/);
    assert.match(
      list.out,
      /answered\t\.dash\/checks\/answered\.check\.json\trecipe/,
    );
    // Not on the base branch yet.
    const base = await run(["--list", "--base"]);
    assert.doesNotMatch(base.out, /listed/);
    assert.match(base.out, /validate\t\.dash\/checks\/validate\.sh/);
    fs.rmSync(path.join(repo, ".dash/checks/listed.check.js"));
    fs.rmSync(path.join(repo, ".dash/checks/answered.check.json"));
  });

  it("lists the library's helpers", async () => {
    const out = [];
    const code = await main(["--list-helpers", "--json", "--cwd", repo], {
      log: (s) => out.push(s),
      err: () => {},
    });
    assert.equal(code, 0);
    const p = JSON.parse(out.join("\n"));
    assert.ok(p.helpers.some((h) => h.id === "git.committedSince"));
  });

  it("prints the guide", async () => {
    const r = await run(["--guide"]);
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
