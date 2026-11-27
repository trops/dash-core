/**
 * checkPackage.test.js — check packages (DASH-106): the check.json
 * manifest, inputs, file and tool packages, the ones Dash ships, the store
 * of installed ones, a package vendored into a repo's .dash/checks, and a
 * team that uses one.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  cleanCheckManifest,
  readCheckFiles,
  parsePackageRef,
  inputValues,
  inputEnv,
} = require("./checkPackage");
const { STARTERS, starterPackage } = require("./starterPackages");
const { createPackageStore } = require("./packageStore");
const { runPackageCheck, packageCheckError } = require("./kinds/package");
const { runRepoCheck } = require("./kinds/repo");
const { runCheck } = require("./checkRunner");
const { checksError, cleanBotChecks } = require("../bots/botChecks");
const { checkPackagesOf, registryManifestFor } = require("../bots/botPackage");

let root;
let work;
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
const answer = (obj) => ({
  input: { answer: `Done.\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`` },
  item: { id: "DASH-93" },
});

const ECHO_PKG = {
  "check.json": JSON.stringify({
    name: "echo-inputs",
    version: "1.2.0",
    author: "me",
    kind: "file",
    run: "check.js",
    inputs: [
      { name: "word", label: "Word", type: "text", default: "hello" },
      { name: "strict", label: "Strict", type: "boolean" },
    ],
  }),
  "check.js": [
    "const i = JSON.parse(require('fs').readFileSync(process.env.DASH_INPUT, 'utf8'));",
    "const ok = process.env.DASH_CHECK_WORD === i.check.inputs.word && i.check.inputs.word !== 'fail';",
    "console.log(JSON.stringify({ reason: 'word=' + process.env.DASH_CHECK_WORD + ' strict=' + process.env.DASH_CHECK_STRICT + ' cwd=' + require('path').basename(process.cwd()) }));",
    "process.exit(ok ? 0 : 1);",
  ].join("\n"),
};

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-check-pkg-test-"));
  work = path.join(root, "work");
  fs.mkdirSync(work);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("check.json", () => {
  it("a file check and a tool check, cleaned", () => {
    const f = cleanCheckManifest(JSON.parse(ECHO_PKG["check.json"]));
    assert.equal(f.error, undefined);
    assert.equal(f.manifest.kind, "file");
    assert.equal(f.manifest.run, "check.js");
    assert.deepEqual(
      f.manifest.inputs.map((i) => i.name),
      ["word", "strict"],
    );
    const t = cleanCheckManifest(starterPackage("jira-ticket-exists").manifest);
    assert.equal(t.manifest.kind, "tool");
    assert.equal(t.manifest.needs.provider, "jira");
  });

  it("says what's wrong", () => {
    const bad = (m) => cleanCheckManifest(m).error;
    assert.match(bad(null), /JSON object/);
    assert.match(bad({ name: "Bad Name", run: "x.js" }), /lowercase/);
    assert.match(bad({ name: "a", kind: "magic" }), /"file" or "tool"/);
    assert.match(bad({ name: "a", run: "../x.js" }), /names its file/);
    assert.match(
      bad({ name: "a", kind: "tool", tool: { type: "jira" } }),
      /"tool": \{ "type"/,
    );
    assert.match(
      bad({
        name: "a",
        kind: "tool",
        tool: { type: "jira", tool: "getJiraIssue" },
      }),
      /answerRules/,
    );
    assert.match(
      bad({ name: "a", run: "x.js", version: "one" }),
      /like 1\.0\.0/,
    );
    assert.match(
      bad({ name: "a", run: "x.js", inputs: [{ name: "a" }, { name: "a" }] }),
      /twice/,
    );
  });

  it("a package's files: check.json, its file, flat names only", () => {
    assert.equal(readCheckFiles(ECHO_PKG).manifest.name, "echo-inputs");
    assert.match(readCheckFiles({}).error, /has a check\.json/);
    assert.match(
      readCheckFiles({ "check.json": ECHO_PKG["check.json"] }).error,
      /isn't there/,
    );
    assert.match(
      readCheckFiles({ ...ECHO_PKG, "sub/x.js": "" }).error,
      /flat names only/,
    );
  });

  it("refs, inputs and their environment", () => {
    assert.deepEqual(parsePackageRef("@trops/x@1.0.0"), {
      scope: "trops",
      name: "x",
      id: "@trops/x",
    });
    assert.equal(parsePackageRef("plan-has-sections").scope, null);
    assert.equal(parsePackageRef("../x"), null);
    const m = cleanCheckManifest({
      name: "a",
      run: "x.js",
      inputs: [
        { name: "key", default: "plan" },
        { name: "id", required: true },
        { name: "on", type: "boolean" },
      ],
    }).manifest;
    const v = inputValues(m, { id: "{item.id}", on: "yes" });
    assert.deepEqual(v.values, { key: "plan", id: "", on: true });
    assert.deepEqual(v.missing, ["id"]);
    assert.deepEqual(inputEnv({ key: "plan", on: true }), {
      DASH_CHECK_KEY: "plan",
      DASH_CHECK_ON: "yes",
    });
  });
});

describe("running a package", () => {
  const store = () => createPackageStore({ root: path.join(root, "pkgs") });

  it("a file package runs in the workspace with its inputs", async () => {
    const s = store();
    assert.equal(
      s.install({ scope: "me", name: "echo-inputs", files: ECHO_PKG }).ok,
      true,
    );
    const deps = { getPackage: (r) => s.get(r), cwd: work, tmpDir: root };
    const ok = await runPackageCheck(
      {
        kind: "package",
        package: "@me/echo-inputs",
        inputs: { word: "hi", strict: true },
      },
      answer({}),
      deps,
    );
    assert.equal(ok.pass, true, ok.reason);
    assert.equal(ok.reason, "word=hi strict=yes cwd=work");
    const fail = await runPackageCheck(
      { kind: "package", package: "@me/echo-inputs", inputs: { word: "fail" } },
      answer({}),
      deps,
    );
    assert.equal(fail.pass, false);
  });

  it("a tool package uses a provider of its type, and its rules", async () => {
    const calls = [];
    const deps = {
      getPackage: (r) => starterPackage(r),
      serverForType: (t) => (t === "jira" ? "Atlassian MCP" : null),
      isReadOnly: () => true,
      callTool: async (server, tool, args) => {
        calls.push({ server, tool, args });
        return { json: { key: args.issueIdOrKey } };
      },
    };
    const res = await runPackageCheck(
      {
        kind: "package",
        package: "jira-ticket-exists",
        inputs: { cloudId: "c1", key: "DASH-93" },
      },
      answer({}),
      deps,
    );
    assert.equal(res.pass, true, res.reason);
    assert.deepEqual(calls[0], {
      server: "Atlassian MCP",
      tool: "getJiraIssue",
      args: { cloudId: "c1", issueIdOrKey: "DASH-93" },
    });
    const noProvider = await runPackageCheck(
      {
        kind: "package",
        package: "github-issue-exists",
        inputs: { owner: "a", repo: "b", number: "1" },
      },
      answer({}),
      deps,
    );
    assert.equal(
      noProvider.reason,
      "github-issue-exists needs a github provider: give the bot one",
    );
    const noInput = await runPackageCheck(
      { kind: "package", package: "jira-ticket-exists" },
      answer({}),
      deps,
    );
    assert.match(noInput.reason, /needs Jira cloud id/);
  });

  it("says when a package isn't installed, through checkRunner", async () => {
    const res = await runCheck(
      { kind: "package", package: "@me/nope" },
      answer({}),
      { getPackage: () => null, cwd: work },
    );
    assert.equal(res.pass, false);
    assert.equal(res.kind, "package");
    assert.match(
      res.reason,
      /@me\/nope isn't installed: install it from the registry/,
    );
  });

  it("the packages Dash ships work", async () => {
    for (const s of STARTERS)
      assert.equal(
        readCheckFiles({ "check.json": JSON.stringify(s.manifest), ...s.files })
          .error,
        undefined,
        s.manifest.name,
      );
    const deps = {
      getPackage: (r) => starterPackage(r),
      cwd: work,
      tmpDir: root,
    };
    const good = await runPackageCheck(
      { kind: "package", package: "plan-has-sections" },
      answer({ plan: { cause: "a", fix: "b", test: "c" } }),
      deps,
    );
    assert.equal(good.pass, true, good.reason);
    const bad = await runPackageCheck(
      {
        kind: "package",
        package: "plan-has-sections",
        inputs: { sections: "cause,risk" },
      },
      answer({ plan: { cause: "a" } }),
      deps,
    );
    assert.equal(bad.reason, "The plan has no risk");
    fs.writeFileSync(
      path.join(work, "package.json"),
      JSON.stringify({ scripts: { test: "exit 0" } }),
    );
    const tests = await runPackageCheck(
      {
        kind: "package",
        package: "node-tests-pass",
        inputs: { command: "true" },
      },
      answer({}),
      deps,
    );
    assert.equal(tests.pass, true, tests.reason);
    const failing = await runPackageCheck(
      {
        kind: "package",
        package: "node-tests-pass",
        inputs: { command: "false" },
      },
      answer({}),
      deps,
    );
    assert.match(failing.reason, /^false failed \(exit 1\)/);
  });

  it("the store lists Dash's, installed ones and the built-ins, and removes", () => {
    const s = store();
    const { packages, builtIns } = s.list();
    assert.deepEqual(
      packages.slice(0, STARTERS.length).map((p) => p.source),
      STARTERS.map(() => "dash"),
    );
    assert.ok(
      packages.some((p) => p.id === "@me/echo-inputs" && p.version === "1.2.0"),
    );
    assert.deepEqual(
      builtIns.map((b) => b.name),
      ["git-on-branch", "git-committed", "pr-ci", "handoff-has"],
    );
    assert.equal(s.remove("@me/echo-inputs").ok, true);
    assert.equal(s.get("@me/echo-inputs"), null);
    assert.match(
      s.install({ scope: "me", name: "bad", files: {} }).error,
      /check\.json/,
    );
  });
});

describe("a package vendored into a repo's .dash/checks", () => {
  it("runs from the base branch's folder, with the step's inputs", async () => {
    const origin = path.join(root, "origin.git");
    const seed = path.join(root, "seed");
    const repo = path.join(root, "repo");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    git(root, "init", "-q", "-b", "main", seed);
    fs.mkdirSync(path.join(seed, ".dash/checks/echo-inputs"), {
      recursive: true,
    });
    for (const [f, b] of Object.entries(ECHO_PKG))
      fs.writeFileSync(path.join(seed, ".dash/checks/echo-inputs", f), b);
    git(seed, "add", "-A");
    git(seed, "commit", "-qm", "vendored");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-q", "origin", "main");
    git(root, "clone", "-q", origin, repo);
    const base = await runRepoCheck(
      { kind: "repo", name: "echo-inputs", inputs: { word: "vendored" } },
      answer({}),
      { cwd: repo, tmpDir: root },
    );
    assert.equal(base.pass, true, base.reason);
    assert.equal(base.reason, "word=vendored strict=no cwd=repo");
    const ws = await runRepoCheck(
      { kind: "repo", name: "echo-inputs", from: "workspace" },
      answer({}),
      { cwd: repo, tmpDir: root },
    );
    assert.equal(ws.pass, true, ws.reason);
    assert.match(ws.reason, /^word=hello/);
  });
});

describe("a package step, and a team that uses one", () => {
  const step = (check, extra = {}) => ({
    kind: "check",
    name: "Plan",
    check,
    ...extra,
  });

  it("is checked when saved", () => {
    assert.equal(
      packageCheckError({ kind: "package", package: "plan-has-sections" }),
      null,
    );
    assert.equal(
      checksError({
        steps: [
          step({
            kind: "package",
            package: "@trops/x",
            inputs: { a: "{repo.key}" },
          }),
        ],
      }),
      null,
    );
    assert.match(
      checksError({ steps: [step({ kind: "package", package: "../x" })] }),
      /names its package/,
    );
    assert.equal(
      cleanBotChecks({
        steps: [step({ kind: "package", package: "@trops/x" }, { held: true })],
      }).steps[0].held,
      true,
    );
  });

  it("a published team lists its registry packages, not Dash's", () => {
    const bots = [
      {
        name: "Planner",
        checks: {
          steps: [
            step({ kind: "package", package: "plan-has-sections" }),
            step({ kind: "package", package: "@trops/plan-lint@1.0.0" }),
          ],
        },
      },
      {
        name: "Coder",
        checks: {
          steps: [
            step({ kind: "package", package: "@trops/plan-lint" }),
            step({ kind: "package", package: "@acme/ci" }),
          ],
        },
      },
    ];
    assert.deepEqual(checkPackagesOf(bots), ["@trops/plan-lint", "@acme/ci"]);
    const m = registryManifestFor(
      {
        type: "bot-team",
        members: bots.map((b, i) => ({ role: `r${i}`, embedded: b })),
        wiring: [],
      },
      {
        scope: "me",
        name: "t",
        displayName: "T",
        version: "1.0.0",
        appOrigin: "x",
      },
    );
    assert.deepEqual(m.checkPackages, ["@trops/plan-lint", "@acme/ci"]);
  });
});
