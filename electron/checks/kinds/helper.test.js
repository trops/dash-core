/**
 * helper.test.js — one @trops/dash-check helper as a check, set with no
 * code (DASH-160): its settings are checked when the bot is saved, it runs
 * in the job's workspace, and with handoffFrom "handed" it reads the plan
 * the bot was handed (the Planner's), not its own answer's.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  FACTORY_HELPERS,
  helperCheckError,
  runHelperCheck,
  asRecipe,
} = require("./helper");
const { runCheck } = require("../checkRunner");
const { isBuiltInHelper } = require("../dashCheck");
const { checksError } = require("../../bots/botChecks");
const { CHECK_KINDS } = require("../../flows/flowModel");
const { createJobStore } = require("../../jobs/jobStore");
const { createJobTracker } = require("../../jobs/jobTracker");

let root;
let work;
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

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-helper-test-"));
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  work = path.join(root, "work");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "init", "-q", "-b", "main", seed);
  fs.mkdirSync(path.join(seed, "src"));
  fs.writeFileSync(path.join(seed, "src", "a.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(seed, "src", "b.js"), "module.exports = 2;\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "first");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-b", "fix/DASH-1");
  // The work: src/a.js and its test, plus src/b.js nobody planned.
  fs.writeFileSync(path.join(work, "src", "a.js"), "module.exports = 3;\n");
  fs.writeFileSync(path.join(work, "src", "a.test.js"), "// a test\n");
  fs.writeFileSync(path.join(work, "src", "b.js"), "console.log(2);\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "DASH-1: the fix");
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const run = (check, input) =>
  runHelperCheck(check, { workspace: { dir: work }, ...input }, { cwd: work });

describe("a helper check's settings", () => {
  it("is a check kind a bot can save", () => {
    assert.ok(CHECK_KINDS.includes("helper"));
    const ok = {
      steps: [
        {
          kind: "check",
          name: "Only the plan",
          check: {
            kind: "helper",
            use: "git.changesMatchPlan",
            with: { planKeys: "files, tests" },
            handoffFrom: "handed",
          },
        },
      ],
    };
    assert.equal(checksError(ok), null);
  });

  it("offers dash-check 0.2.0's factory helpers, all of them there", () => {
    assert.equal(FACTORY_HELPERS.length, 10);
    for (const id of FACTORY_HELPERS) assert.ok(isBuiltInHelper(id), id);
  });

  it("says what's wrong, as the bot is saved", () => {
    assert.match(helperCheckError({ kind: "helper" }), /names its helper/);
    assert.match(
      helperCheckError({ kind: "helper", use: "git.nope" }),
      /isn't one of @trops\/dash-check's helpers/,
    );
    assert.match(
      helperCheckError({ kind: "helper", use: "git.clean", with: [] }),
      /with must be an object/,
    );
    assert.match(
      helperCheckError({
        kind: "helper",
        use: "git.clean",
        handoffFrom: "planner",
      }),
      /handoffFrom must be answer or handed/,
    );
    // A required param, as dash-check's validateRecipe says it.
    assert.match(
      helperCheckError({ kind: "helper", use: "git.noNewMatches" }),
      /glob|pattern/,
    );
    const step = (check) => ({
      steps: [{ kind: "check", name: "x", check }],
    });
    assert.match(
      checksError(step({ kind: "helper", use: "git.nope" })),
      /isn't one of/,
    );
  });

  it("runs as a one-step recipe named for its helper", () => {
    const r = asRecipe({
      kind: "helper",
      use: "files.maxGrowth",
      with: { maxLines: 900 },
      message: "Split it",
    });
    assert.equal(r.steps.length, 1);
    assert.deepEqual(r.steps[0], {
      use: "files.maxGrowth",
      with: { maxLines: 900 },
      message: "Split it",
    });
    assert.equal(r.name, "No file grows too big");
  });
});

describe("running a helper check", () => {
  it("passes when every change is in the bot's own plan", async () => {
    const res = await run(
      { kind: "helper", use: "git.changesMatchPlan", with: { base: "main" } },
      answer({ files: ["src/a.js", "src/b.js"], tests: ["src/a.test.js"] }),
    );
    assert.equal(res.pass, true, res.reason);
    assert.equal(res.details.helper, "git.changesMatchPlan");
  });

  it("fails, naming the file, when a change isn't in the plan", async () => {
    const res = await run(
      { kind: "helper", use: "git.changesMatchPlan", with: { base: "main" } },
      answer({ files: ["src/a.js"], tests: [{ file: "src/a.test.js" }] }),
    );
    assert.equal(res.pass, false);
    assert.match(JSON.stringify(res), /src\/b\.js/);
  });

  it("with handoffFrom handed, judges by the plan it was handed", async () => {
    // The Coder says it planned b.js too; the Planner didn't.
    const check = {
      kind: "helper",
      use: "git.changesMatchPlan",
      with: { base: "main", planKeys: "files, tests" },
      handoffFrom: "handed",
    };
    const coder = answer({ files: ["src/a.js", "src/b.js", "src/a.test.js"] });
    const planner = {
      from: "Planner",
      handoff: { files: ["src/a.js"], tests: [{ file: "src/a.test.js" }] },
    };
    const res = await run(check, { ...coder, handedOn: planner });
    assert.equal(res.pass, false);
    assert.match(JSON.stringify(res), /src\/b\.js/);
    assert.equal(res.details.handoffFrom, "Planner");
    const ok = await run(check, {
      ...coder,
      handedOn: {
        from: "Planner",
        handoff: { files: ["src/"], tests: [] },
      },
    });
    assert.equal(ok.pass, true, ok.reason);
  });

  it("with handoffFrom handed and nothing handed, says so", async () => {
    const res = await run(
      {
        kind: "helper",
        use: "git.changesMatchPlan",
        handoffFrom: "handed",
      },
      answer({ files: ["src/a.js"] }),
    );
    assert.equal(res.pass, false);
    assert.match(res.reason, /wasn't handed a handoff/);
  });

  it("runs through runCheck, with its params", async () => {
    const res = await runCheck(
      {
        kind: "helper",
        use: "git.noNewMatches",
        with: { base: "main", glob: "src/**", pattern: "console\\.log\\(" },
        message: "Remove the console.log you added",
      },
      { ...answer({}), workspace: { dir: work } },
      { cwd: work },
    );
    assert.equal(res.pass, false);
    assert.equal(res.kind, "helper");
    assert.match(JSON.stringify(res), /src\/b\.js:1/);
    assert.match(JSON.stringify(res), /Remove the console\.log you added/);
  });

  it("can't run with bad settings", async () => {
    const res = await runCheck({ kind: "helper", use: "nope" }, {}, {});
    assert.equal(res.pass, false);
    assert.match(res.reason, /This check can't run/);
  });
});

describe("the handoff a bot was handed (jobTracker.handedTo)", () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-handed-"));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is the last step before it, of another bot, with a handoff", () => {
    const t = createJobTracker({
      store: createJobStore({ root: dir }),
      now: () => Date.parse("2026-11-27T12:00:00Z"),
      setTimer: () => ({}),
      clearTimer: () => {},
    });
    const job = t.startJob({ workspaceId: "ws", leadId: "l", title: "Fix" });
    const ended = (botId, obj) => ({
      status: "completed",
      output: `Done.\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``,
    });
    t.startStep(job.id, { botId: "plan", botName: "Planner" });
    t.endStep(job.id, {
      botId: "plan",
      record: ended("plan", { files: ["src/a.js"], tests: [] }),
    });
    t.startStep(job.id, { botId: "code", botName: "Coder" });
    t.endStep(job.id, {
      botId: "code",
      record: ended("code", { files: ["src/a.js", "src/b.js"] }),
      checking: { goalId: "goal_code" },
    });
    const h = t.handedTo("goal_code");
    assert.equal(h.from, "Planner");
    assert.deepEqual(h.handoff.files, ["src/a.js"]);
    assert.equal(t.handedTo("goal_none"), null);
  });
});
