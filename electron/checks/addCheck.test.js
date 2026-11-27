/**
 * addCheck.test.js — the Add check screen and Set up checks (DASH-110):
 * suggestions, a drafted check and its Try it, the team's own copy while
 * its PR is open, the PR itself, and setup/validate from a repo's CI.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  suggestChecks,
  draftPrompt,
  parseDraft,
  tryDraft,
  checkNameOf,
  draftRepoChecks,
  workflowRuns,
} = require("./addCheck");
const {
  teamCheckOf,
  cleanTeamCheck,
  openFilesPr,
  prState,
} = require("./teamChecks");
const { runRepoCheck } = require("./kinds/repo");
const { preflight } = require("../bots/preflight");
const botAddCheck = require("../controller/botAddCheck");

let root;
let work;
const answer = (obj) => ({
  input: { answer: `Done.\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`` },
});
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

const TESTS_CHECK = [
  "const i = JSON.parse(require('fs').readFileSync(process.env.DASH_INPUT, 'utf8'));",
  "const a = String(i.input && i.input.answer || '');",
  "const b = [...a.matchAll(/```(?:json)?\\s*([\\s\\S]*?)```/g)].pop();",
  "let h = {}; try { h = JSON.parse(b ? b[1] : a); } catch (e) {}",
  "const acc = h.acceptance || [], tests = h.tests || [];",
  "const missing = acc.filter((x) => !tests.some((t) => t.acceptance === x));",
  "if (!acc.length || missing.length) { console.log(JSON.stringify({ reason: 'No test for: ' + (missing.join('; ') || 'any acceptance item') })); process.exit(1); }",
  "console.log(JSON.stringify({ reason: acc.length + ' acceptance items, each with a test' }));",
].join("\n");

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-add-check-test-"));
  work = path.join(root, "work");
  fs.mkdirSync(work);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("suggested checks", () => {
  const team = {
    declared: [
      {
        name: "repo",
        type: "table",
        columns: [
          { name: "url", type: "url" },
          { name: "baseBranch", type: "text" },
        ],
      },
    ],
  };
  const packages = [
    {
      id: "plan-has-sections",
      name: "plan-has-sections",
      source: "dash",
      description: "The plan has sections.",
      inputs: [],
    },
    {
      id: "node-tests-pass",
      name: "node-tests-pass",
      source: "dash",
      description: "Tests pass.",
      inputs: [{ name: "command" }],
    },
    {
      id: "@acme/lint",
      name: "lint",
      source: "registry",
      description: "Lints.",
      inputs: [{ name: "baseBranch" }],
    },
  ];
  const builtIns = [
    {
      name: "git-committed",
      kind: "git-committed",
      description: "At least one commit past the base branch.",
    },
    {
      name: "pr-ci",
      kind: "pr-ci",
      description: "The PR in the handoff has CI that passed.",
    },
  ];

  it("ranks for the bot's work, labels where each comes from, and fills inputs", () => {
    const coder = {
      name: "Coder",
      instructions: "Implement the plan and commit.",
    };
    const s = suggestChecks({
      bot: coder,
      team,
      repoChecks: ["validate", "setup"],
      packages,
      builtIns,
    });
    assert.equal(s[0].id, "repo:validate");
    assert.equal(s[0].source, "repo");
    assert.deepEqual(s[0].step.check, { kind: "repo", name: "validate" });
    const committed = s.find((x) => x.id === "built-in:git-committed");
    assert.equal(committed.step.check.base, "{repo.baseBranch}");
    assert.ok(
      s.indexOf(committed) < s.findIndex((x) => x.id === "built-in:pr-ci"),
    );
    assert.deepEqual(
      s.find((x) => x.id === "package:@acme/lint").step.check.inputs,
      { baseBranch: "{repo.baseBranch}" },
    );
    assert.equal(
      s.find((x) => x.id === "package:plan-has-sections").source,
      "dash",
    );
    const pr = suggestChecks({
      bot: { name: "PR Bot", instructions: "open a PR" },
      builtIns,
      packages: [],
    });
    assert.equal(pr[0].id, "built-in:pr-ci");
  });

  it("leaves out what the bot already has", () => {
    const bot = {
      name: "Coder",
      checks: {
        steps: [
          { kind: "check", check: { kind: "repo", name: "validate" } },
          { kind: "check", check: { kind: "git-committed" } },
        ],
      },
    };
    const ids = suggestChecks({
      bot,
      repoChecks: ["validate"],
      builtIns,
      packages: [],
    }).map((x) => x.id);
    assert.deepEqual(ids, ["built-in:pr-ci"]);
  });
});

describe("describe it: a drafted check", () => {
  it("the prompt carries the guide and the bot's last run", () => {
    const p = draftPrompt("every acceptance item has a test", {
      bot: { name: "Planner" },
      sample: answer({ x: 1 }),
    });
    assert.match(p, /the bot "Planner": every acceptance item has a test/);
    assert.match(p, /# How to Write a Dash Check/);
    assert.match(p, /last run/);
    assert.match(p, /<bad_sample>/);
  });

  it("asks for a recipe, with the helpers' palette (DASH-133)", () => {
    const p = draftPrompt("the work is committed");
    assert.match(p, /dash-check recipe/);
    assert.match(p, /- git\.committedSince\(base\?: text/);
    assert.match(p, /- toHaveLengthAtLeast\(n: number\)/);
    assert.match(p, /<recipe name="name">/);
  });

  it("reads the lead's answer: a recipe, saved as name.check.json", () => {
    const recipe = {
      name: "every item has a test",
      steps: [
        { use: "handoff.eachHas", with: { list: "tests", keys: ["file"] } },
      ],
    };
    const d = parseDraft(
      `Here.\n<recipe name="plan-tests">\n\`\`\`json\n${JSON.stringify(recipe)}\n\`\`\`\n</recipe>\n<summary>Every item has a test.</summary>\n<bad_sample>{"input": {"answer": ""}}</bad_sample>`,
    );
    assert.equal(d.error, undefined, d.error);
    assert.equal(d.file, "plan-tests.check.json");
    assert.deepEqual(d.recipe, recipe);
    assert.deepEqual(JSON.parse(d.code), recipe);
    assert.equal(d.summary, "Every item has a test.");
    assert.deepEqual(d.badSample, { input: { answer: "" } });
    assert.equal(checkNameOf(d.file), "plan-tests");
    // No name: the recipe's, as a slug.
    const unnamed = parseDraft(`<recipe>${JSON.stringify(recipe)}</recipe>`);
    assert.equal(unnamed.file, "every-item-has-a-test.check.json");
  });

  it("refuses a draft that isn't a valid recipe, with its errors", () => {
    assert.match(parseDraft("nope").error, /no <recipe>/);
    assert.match(
      parseDraft("<recipe>{ not json }</recipe>").error,
      /isn't JSON/,
    );
    const bad = parseDraft(
      '<recipe name="x">{"name": "x", "steps": [{"use": "git.nope"}, {"expect": "handoff.files", "matcher": "toBeHuge"}]}</recipe>',
    );
    assert.match(
      bad.error,
      /The recipe isn't valid: steps\[0\]\.use: There's no helper git\.nope/,
    );
    assert.deepEqual(
      bad.errors.map((e) => e.path),
      ["steps[0].use", "steps[1].matcher"],
    );
    assert.match(
      parseDraft(
        '<recipe name="../x">{"name": "x", "steps": [{"expect": "item.id", "matcher": "toBeDefined"}]}</recipe>',
      ).error,
      /can't be a check's name/,
    );
  });

  it("Try it runs a recipe draft on both inputs", async () => {
    const recipe = {
      name: "lists files",
      steps: [
        {
          expect: "handoff.files",
          matcher: "toHaveLengthAtLeast",
          args: [1],
          message: "The handoff lists no changed files",
        },
      ],
    };
    const d = { file: "lists.check.json", code: JSON.stringify(recipe) };
    const ok = await tryDraft(d, {
      good: answer({ files: ["a.js"] }),
      bad: answer({ files: [] }),
      cwd: work,
    });
    assert.equal(ok.ok, true, ok.problem);
    assert.equal(ok.bad.reason, "The handoff lists no changed files");
    const lax = await tryDraft(d, {
      good: answer({ files: ["a.js"] }),
      bad: answer({ files: ["b.js"] }),
      cwd: work,
    });
    assert.match(lax.problem, /passes on the bad input too/);
  });

  it("Try it: passes on the good input, fails with a reason on the bad", async () => {
    const good = answer({
      acceptance: ["a"],
      tests: [{ acceptance: "a", test: "t" }],
    });
    const bad = answer({ acceptance: ["a"], tests: [] });
    const ok = await tryDraft(
      { file: "plan-tests.js", code: TESTS_CHECK },
      { good, bad, cwd: work, tmpDir: root },
    );
    assert.equal(ok.ok, true, ok.problem);
    assert.equal(ok.bad.reason, "No test for: a");
    const lax = await tryDraft(
      { file: "x.sh", code: "exit 0\n" },
      { good, bad, cwd: work, tmpDir: root },
    );
    assert.equal(lax.ok, false);
    assert.match(lax.problem, /passes on the bad input too/);
    const muteCode =
      "const i = require('fs').readFileSync(process.env.DASH_INPUT, 'utf8');\nprocess.exit(/test\\\\\"/.test(i) ? 0 : 1);\n";
    const mute = await tryDraft(
      { file: "mute.js", code: muteCode },
      { good, bad, cwd: work, tmpDir: root },
    );
    assert.match(mute.problem, /without saying why/);
    const broken = await tryDraft(
      { file: "x.sh", code: "exit 1\n" },
      { good, bad, cwd: work, tmpDir: root },
    );
    assert.match(broken.problem, /fails on the good input/);
  });
});

describe("the team's own copy, and its PR", () => {
  it("runs when the repo has no file yet, saying the PR is open", async () => {
    const origin = path.join(root, "o.git");
    const seed = path.join(root, "seed");
    const repo = path.join(root, "repo");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    git(root, "init", "-q", "-b", "main", seed);
    fs.writeFileSync(path.join(seed, "a"), "a");
    git(seed, "add", "-A");
    git(seed, "commit", "-qm", "a");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-q", "origin", "main");
    git(root, "clone", "-q", origin, repo);
    const tc = cleanTeamCheck({
      file: "plan-tests.js",
      code: TESTS_CHECK,
      state: "pr-open",
      pr: { url: "https://github.com/a/b/pull/3", number: 3, repo: "a/b" },
    });
    const team = { teamChecks: { "plan-tests": tc } };
    const res = await runRepoCheck(
      { kind: "repo", name: "plan-tests" },
      answer({ acceptance: ["a"], tests: [{ acceptance: "a", test: "t" }] }),
      { cwd: repo, tmpDir: root, teamCheck: (n) => teamCheckOf(team, n) },
    );
    assert.equal(res.pass, true, res.reason);
    assert.equal(res.details.state, "pr-open");
    const fail = await runRepoCheck(
      { kind: "repo", name: "plan-tests" },
      answer({ acceptance: ["a"] }),
      { cwd: repo, tmpDir: root, teamCheck: (n) => teamCheckOf(team, n) },
    );
    assert.equal(fail.reason, "No test for: a");
    const none = await runRepoCheck(
      { kind: "repo", name: "plan-tests" },
      answer({}),
      { cwd: repo, tmpDir: root },
    );
    assert.match(none.reason, /has no \.dash\/checks\/plan-tests/);
  });

  it("isn't a setup problem while the team has a copy", async () => {
    const team = {
      declared: [
        {
          name: "repo",
          type: "table",
          columns: [{ name: "url", type: "url" }],
        },
      ],
      values: { repo: [{ key: "a", url: "https://github.com/trops/a" }] },
      teamChecks: {
        "plan-tests": cleanTeamCheck({
          file: "plan-tests.js",
          code: "x",
          state: "pr-open",
        }),
      },
    };
    const bot = {
      name: "Planner",
      checks: {
        steps: [
          {
            kind: "check",
            name: "Tests",
            check: { kind: "repo", name: "plan-tests" },
          },
        ],
      },
    };
    const fetch = async (url) => ({
      status: url.endsWith("trops/a") ? 200 : 404,
      json: async () =>
        url.endsWith("trops/a")
          ? { default_branch: "main", permissions: { push: true } }
          : {},
    });
    const res = await preflight(
      { bots: [bot], team },
      { fetch, gitToken: async () => "t" },
    );
    assert.deepEqual(res.problems, []);
  });

  it("opens one PR: a branch, a commit per file, the PR", async () => {
    const calls = [];
    const fetch = async (url, opts) => {
      const p = url.replace("https://api.github.com/", "");
      calls.push(`${opts.method} ${p}`);
      const r = (code, body) => ({ status: code, json: async () => body });
      if (p === "repos/trops/a") return r(200, { default_branch: "main" });
      if (p === "repos/trops/a/git/ref/heads/main")
        return r(200, { object: { sha: "abc" } });
      if (p === "repos/trops/a/git/refs") return r(201, {});
      if (p.startsWith("repos/trops/a/contents/")) return r(201, {});
      if (p === "repos/trops/a/pulls")
        return r(201, {
          html_url: "https://github.com/trops/a/pull/7",
          number: 7,
        });
      return r(404, {});
    };
    const pr = await openFilesPr({
      slug: "trops/a",
      branch: "dash/x",
      files: { ".dash/checks/setup.sh": "a", ".dash/checks/validate.sh": "b" },
      title: "t",
      token: "tok",
      fetch,
    });
    assert.deepEqual(pr, {
      url: "https://github.com/trops/a/pull/7",
      number: 7,
      branch: "dash/x",
      base: "main",
    });
    assert.deepEqual(calls, [
      "GET repos/trops/a",
      "GET repos/trops/a/git/ref/heads/main",
      "POST repos/trops/a/git/refs",
      "PUT repos/trops/a/contents/.dash/checks/setup.sh",
      "PUT repos/trops/a/contents/.dash/checks/validate.sh",
      "POST repos/trops/a/pulls",
    ]);
    const denied = await openFilesPr({
      slug: "trops/a",
      branch: "x",
      files: {},
      title: "t",
      token: "tok",
      fetch: async (url, o) => ({
        status: o.method === "POST" ? 403 : 200,
        json: async () => ({ default_branch: "main", object: { sha: "s" } }),
      }),
    });
    assert.match(
      denied.error,
      /can't push to trops\/a \(HTTP 403\): give it write access to Contents/,
    );
    assert.match(
      (
        await openFilesPr({
          slug: "a/b",
          branch: "x",
          files: {},
          title: "t",
          token: null,
          fetch,
        })
      ).error,
      /No GitHub provider/,
    );
  });

  it("merged drops the team copy; closed asks keep or remove", async () => {
    const settings = {
      teamChecks: {
        merged: cleanTeamCheck({
          file: "merged.sh",
          code: "x",
          state: "pr-open",
          pr: { url: "u", number: 1, repo: "trops/a" },
        }),
        closed: cleanTeamCheck({
          file: "closed.sh",
          code: "x",
          state: "pr-open",
          pr: { url: "u", number: 2, repo: "trops/a" },
        }),
        open: cleanTeamCheck({
          file: "open.sh",
          code: "x",
          state: "pr-open",
          pr: { url: "u", number: 3, repo: "trops/a" },
        }),
      },
    };
    const saved = [];
    const bots = [
      {
        id: "b1",
        workspaceId: "w",
        checks: {
          steps: [
            {
              kind: "check",
              name: "closed",
              check: { kind: "repo", name: "closed" },
            },
            { kind: "you", name: "Approve" },
          ],
        },
      },
    ];
    const ctl = {
      _store: {
        getTeamSettings: () => settings,
        setTeamSettings: (_w, patch) => Object.assign(settings, patch),
        list: () => bots.map((b) => ({ ...b })),
      },
      _gitTokenFor: async () => "tok",
      _preflightFetch: async (url) => {
        const n = Number(url.split("/").pop());
        const body =
          n === 1
            ? { state: "closed", merged: true }
            : n === 2
              ? { state: "closed", merged: false }
              : { state: "open" };
        return { status: 200, json: async () => body };
      },
      save: (b) => saved.push(b),
    };
    assert.deepEqual(
      await prState({
        slug: "trops/a",
        number: 1,
        token: "t",
        fetch: ctl._preflightFetch,
      }),
      { state: "merged" },
    );
    const r = await botAddCheck.refresh(ctl, "w");
    assert.deepEqual(
      r.checks.map((c) => [c.name, c.state]),
      [
        ["closed", "pr-closed"],
        ["open", "pr-open"],
      ],
    );
    assert.equal(botAddCheck.resolve(ctl, "w", "open", "keep").state, "team");
    assert.equal(
      botAddCheck.resolve(ctl, "w", "closed", "remove").removed,
      true,
    );
    assert.equal(settings.teamChecks.closed, undefined);
    assert.deepEqual(
      saved[0].checks.steps.map((s) => s.name),
      ["Approve"],
    );
    assert.match(
      botAddCheck.resolve(ctl, "w", "nope", "keep").error,
      /no check "nope"/,
    );
  });
});

describe("Set up checks: setup and validate from the repo's own CI", () => {
  const workflow = [
    "name: CI",
    "on: [pull_request]",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: npm ci",
    "      - run: npm run lint",
    "      - name: Tests",
    "        run: |",
    "          npm test",
    "          npm run build",
    "      - run: npm publish",
  ].join("\n");

  it("reads a workflow's run lines", () => {
    assert.deepEqual(workflowRuns(workflow), [
      "npm ci",
      "npm run lint",
      "npm test",
      "npm run build",
      "npm publish",
    ]);
  });

  it("validate runs what CI runs (not installs or publishing); setup uses the lockfile", async () => {
    const d = draftRepoChecks({
      "package.json": JSON.stringify({ scripts: { test: "x" } }),
      "package-lock.json": "(present)",
      ".github/workflows/ci.yml": workflow,
    });
    assert.match(d.files["setup.sh"], /\nnpm ci \|\|/);
    assert.match(
      d.files["validate.sh"],
      /npm run lint \|\|[\s\S]*npm test \|\|[\s\S]*npm run build \|\|/,
    );
    assert.doesNotMatch(d.files["validate.sh"], /publish|npm ci/);
    assert.match(d.notes.join(" "), /what its CI workflows run/);
    // The drafts work: run them in a folder with that package.json.
    const dir = path.join(root, "proj");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "echo tested", lint: "echo linted" } }),
    );
    const v = draftRepoChecks({
      "package.json": JSON.stringify({
        scripts: { test: "echo tested", lint: "echo linted" },
      }),
    });
    fs.writeFileSync(path.join(dir, "v.sh"), v.files["validate.sh"]);
    const out = execFileSync("bash", ["v.sh"], { cwd: dir }).toString();
    assert.match(
      out.trim().split("\n").pop(),
      /"reason": "npm run lint, npm test passed"/,
    );
  });

  it("falls back to package.json scripts, and says what's missing", () => {
    const d = draftRepoChecks({
      "package.json": JSON.stringify({
        scripts: { test: "jest", build: "x", start: "y" },
      }),
      "yarn.lock": "(present)",
    });
    assert.match(d.files["setup.sh"], /yarn install --frozen-lockfile/);
    assert.match(d.files["validate.sh"], /yarn test[\s\S]*yarn build/);
    assert.match(draftRepoChecks({}).error, /no package\.json/);
    assert.match(
      draftRepoChecks({
        "package.json": JSON.stringify({
          scripts: { test: 'echo "Error: no test specified" && exit 1' },
        }),
      }).error,
      /no test, lint or build/,
    );
  });
});

describe("a repo's check count (DASH-130)", () => {
  it("counts each check once, leaving out helpers and sample inputs", () => {
    assert.deepEqual(
      botAddCheck.checkNamesIn({
        checks: [
          "setup.sh",
          "validate.sh",
          "validate.sample.json",
          "lint.bad.json",
          "helpers",
          "lint.check.js",
        ],
      }),
      ["setup", "validate", "lint"],
    );
    assert.deepEqual(botAddCheck.checkNamesIn({}), []);
    assert.deepEqual(botAddCheck.checkNamesIn(null), []);
  });
});
