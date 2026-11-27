/**
 * dashCheck.test.js — Dash runs @trops/dash-check checks (DASH-133): a
 * repo's .check.js and .check.json (read from the base branch, helpers
 * too), the recipe step kind, and a read-only ctx.tool, in process and
 * through DASH_TOOL_SOCKET.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { execFileSync } = require("child_process");
const { runRepoCheck, pickFile } = require("./kinds/repo");
const { runRecipeCheck, recipeCheckError } = require("./kinds/recipe");
const { runCheck } = require("./checkRunner");
const {
  readOnlyTool,
  startToolSocket,
  recipeError,
  builtInPalette,
  repoHelpersAt,
} = require("./dashCheck");
const { checksError, cleanBotChecks } = require("../bots/botChecks");
const { CHECK_KINDS } = require("../flows/flowModel");
const { withTeamValues } = require("../bots/teamValues");

let root;
let work;

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

const answer = (obj, extra = {}) => ({
  input: { answer: `Done.\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`` },
  item: { id: "DASH-133", title: "Run the checks" },
  ...extra,
});
const GOOD = answer({ summary: "did it", files: ["src/a.js"] });
const BAD = answer({ summary: "did it", files: [] });

const READY_JS = `const { check, expect } = require("@trops/dash-check");
const { handoff } = require("@trops/dash-check/helpers");
check("the work is listed", async (ctx) => {
  await handoff.has(ctx, { keys: ["summary"] });
  expect(ctx.handoff.files, "handoff.files").toHaveLengthAtLeast(1, "The handoff lists no changed files");
});
`;
const READY_RECIPE = {
  name: "the work is listed",
  steps: [
    { use: "handoff.has", with: { keys: ["summary"] } },
    {
      expect: "handoff.files",
      matcher: "toHaveLengthAtLeast",
      args: [1],
      message: "The handoff lists no changed files",
    },
  ],
};
const TITLE_HELPER = `const { defineHelper, expect, note } = require("@trops/dash-check");
module.exports = defineHelper({
  id: "team.titleSays",
  label: "The item's title says",
  params: { word: { type: "text", label: "Word", required: true } },
  run(ctx, { word }) {
    expect(String(ctx.item.title || ""), "item.title").toMatch(word, "The title doesn't say " + word);
    note("The title says " + word);
  },
});
`;
const TICKET_JS = `const { check, expect } = require("@trops/dash-check");
check("the ticket is in progress", async (ctx) => {
  const t = await ctx.tool("jira", "getJiraIssue", { issueIdOrKey: ctx.item.id });
  expect(t.fields.status, "status").toBe("In Progress", "The ticket isn't in progress");
});
check("a write is refused", async (ctx) => {
  let said = "";
  try {
    await ctx.tool("jira", "createJiraIssue", { summary: "x" });
  } catch (e) {
    said = e.message;
  }
  expect(said, "the error").toMatch("could change something", "A write tool ran");
});
`;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-check-test-"));
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  work = path.join(root, "work");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "init", "-q", "-b", "main", seed);
  write(seed, ".dash/checks/ready.check.js", READY_JS);
  write(
    seed,
    ".dash/checks/ready-recipe.check.json",
    JSON.stringify(READY_RECIPE, null, 2),
  );
  write(seed, ".dash/checks/helpers/title.js", TITLE_HELPER);
  write(
    seed,
    ".dash/checks/titled.check.json",
    JSON.stringify({
      name: "the title says what it does",
      steps: [{ use: "team.titleSays", with: { word: "dash-check" } }],
    }),
  );
  write(
    seed,
    ".dash/checks/broken.check.json",
    JSON.stringify({ name: "broken", steps: [{ use: "nope.helper" }] }),
  );
  write(seed, ".dash/checks/ticket.check.js", TICKET_JS);
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "checks");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-b", "feat/DASH-133");
  // The branch "fixes" its checks so they always pass, and its helper.
  write(
    work,
    ".dash/checks/ready.check.js",
    'const { check } = require("@trops/dash-check");\ncheck("anything", () => {});\n',
  );
  write(
    work,
    ".dash/checks/ready-recipe.check.json",
    JSON.stringify({
      name: "anything",
      steps: [{ expect: "item.id", matcher: "toBeDefined" }],
    }),
  );
  write(
    work,
    ".dash/checks/helpers/title.js",
    TITLE_HELPER.replace("toMatch(word", "toBeDefined("),
  );
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("the repo kind finds dash-check files by the step's name", () => {
  it("picks name.check.js and name.check.json before name.<ext>", () => {
    assert.equal(pickFile(["a.sh", "a.check.js"], "a"), "a.check.js");
    assert.equal(
      pickFile(["a.check.json", "a.sample.json"], "a"),
      "a.check.json",
    );
    assert.equal(pickFile(["a", "a.check.js"], "a"), "a");
    assert.equal(pickFile(["a.sample.json"], "a"), null);
  });
});

describe("a repo .check.js", () => {
  it("passes and fails from the base branch, each check in details", async () => {
    const ok = await runRepoCheck({ kind: "repo", name: "ready" }, GOOD, {
      cwd: work,
      tmpDir: root,
    });
    assert.equal(ok.pass, true, ok.reason);
    assert.match(ok.reason, /the work is listed/);
    assert.equal(ok.details.file, ".dash/checks/ready.check.js on origin/main");
    assert.equal(ok.details.checks[0].name, "the work is listed");
    const bad = await runRepoCheck({ kind: "repo", name: "ready" }, BAD, {
      cwd: work,
      tmpDir: root,
    });
    assert.equal(bad.pass, false);
    assert.equal(bad.reason, "The handoff lists no changed files");
    assert.equal(bad.details.checks[0].pass, false);
    assert.equal(
      bad.details.checks[0].failures[0].message,
      "The handoff lists no changed files",
    );
  });

  it("runs the workspace's copy only when the step says so", async () => {
    const ws = await runRepoCheck(
      { kind: "repo", name: "ready", from: "workspace" },
      BAD,
      { cwd: work, tmpDir: root },
    );
    assert.equal(ws.pass, true, ws.reason);
    assert.equal(ws.details.file, ".dash/checks/ready.check.js");
  });

  it("gets Dash's env and DASH_INPUT", async () => {
    write(
      work,
      ".dash/checks/env.check.js",
      `const { check, expect } = require("@trops/dash-check");
check("env", (ctx) => {
  expect(ctx.env.DASH_STEP, "DASH_STEP").toBe("Env step");
  expect(ctx.item.id, "item.id").toBe("DASH-133");
  expect(require("fs").existsSync(process.env.DASH_INPUT), "DASH_INPUT").toBe(true);
});
`,
    );
    const res = await runRepoCheck(
      { kind: "repo", name: "env", from: "workspace" },
      GOOD,
      { cwd: work, tmpDir: root, env: { DASH_STEP: "Env step" } },
    );
    assert.equal(res.pass, true, `${res.reason}\n${res.output}`);
  });
});

describe("a repo .check.json", () => {
  it("runs in process with cwd at the workspace, passing and failing per step", async () => {
    const ok = await runRepoCheck(
      { kind: "repo", name: "ready-recipe" },
      GOOD,
      { cwd: work, tmpDir: root },
    );
    assert.equal(ok.pass, true, ok.reason);
    assert.equal(ok.details.recipe, "the work is listed");
    assert.equal(ok.details.steps.length, 2);
    assert.ok(ok.details.steps.every((s) => s.pass));
    const bad = await runRepoCheck(
      { kind: "repo", name: "ready-recipe" },
      BAD,
      { cwd: work, tmpDir: root },
    );
    assert.equal(bad.pass, false);
    assert.equal(bad.reason, "The handoff lists no changed files");
    assert.equal(bad.details.steps[0].pass, true);
    assert.equal(bad.details.steps[1].pass, false);
    assert.equal(
      bad.details.file,
      ".dash/checks/ready-recipe.check.json on origin/main",
    );
  });

  it("uses the repo's own helpers from the base branch, in its own node", async () => {
    const ok = await runRepoCheck({ kind: "repo", name: "titled" }, GOOD, {
      cwd: work,
      tmpDir: root,
    });
    assert.equal(ok.pass, false, "the title doesn't say dash-check");
    assert.equal(ok.reason, "The title doesn't say dash-check");
    const titled = await runRepoCheck(
      { kind: "repo", name: "titled" },
      { ...GOOD, item: { id: "X-1", title: "Use dash-check here" } },
      { cwd: work, tmpDir: root },
    );
    assert.equal(titled.pass, true, `${titled.reason}\n${titled.output}`);
    assert.equal(titled.details.steps[0].label, "The item's title says");
  });

  it("says when a recipe isn't valid", async () => {
    const res = await runRepoCheck({ kind: "repo", name: "broken" }, GOOD, {
      cwd: work,
      tmpDir: root,
    });
    assert.equal(res.pass, false);
    assert.match(res.reason, /There's no helper nope\.helper/);
    assert.equal(
      res.details.file,
      ".dash/checks/broken.check.json on origin/main",
    );
  });
});

describe("ctx.tool", () => {
  const callTool = async (server, tool, args) => {
    assert.equal(server, "jira");
    return {
      text: JSON.stringify({
        key: args.issueIdOrKey,
        fields: { status: "In Progress", labels: ["factory"] },
      }),
    };
  };
  const isReadOnly = (server, tool) => /^get/.test(tool);

  it("answers a read tool and refuses a write one", async () => {
    const tool = readOnlyTool({ callTool, isReadOnly });
    const t = await tool("jira", "getJiraIssue", { issueIdOrKey: "DASH-1" });
    assert.equal(t.fields.status, "In Progress");
    await assert.rejects(
      tool("jira", "createJiraIssue", {}),
      /could change something/,
    );
    // With no isReadOnly, the tool's name decides (READ_NAME).
    const byName = readOnlyTool({ callTool });
    await assert.rejects(byName("jira", "deleteIssue", {}), /could change/);
    assert.equal((await byName("jira", "getIssue", {})).key, undefined);
  });

  it("works through DASH_TOOL_SOCKET: one JSON line in, one back", async () => {
    const sock = await startToolSocket(readOnlyTool({ callTool, isReadOnly }), {
      tmpDir: root,
    });
    const ask = (msg) =>
      new Promise((resolve, reject) => {
        const c = net.createConnection(sock.path);
        let buf = "";
        c.on("connect", () => c.write(`${JSON.stringify(msg)}\n`));
        c.on("data", (d) => {
          buf += d;
          if (buf.includes("\n")) {
            c.destroy();
            resolve(JSON.parse(buf));
          }
        });
        c.on("error", reject);
      });
    try {
      const ok = await ask({
        id: 1,
        provider: "jira",
        tool: "getJiraIssue",
        args: { issueIdOrKey: "DASH-2" },
      });
      assert.equal(ok.id, 1);
      assert.equal(ok.result.key, "DASH-2");
      const no = await ask({
        id: 2,
        provider: "jira",
        tool: "createJiraIssue",
      });
      assert.equal(no.id, 2);
      assert.match(no.error, /could change something/);
    } finally {
      await sock.close();
    }
  });

  it("reaches a repo .check.js run by Dash", async () => {
    const res = await runRepoCheck({ kind: "repo", name: "ticket" }, GOOD, {
      cwd: work,
      tmpDir: root,
      callTool,
      isReadOnly,
    });
    assert.equal(res.pass, true, `${res.reason}\n${res.output}`);
    assert.equal(res.details.checks.length, 2);
  });

  it("reaches a recipe step, in process", async () => {
    const step = {
      kind: "recipe",
      recipe: {
        name: "the ticket is labelled",
        steps: [{ use: "tracker.ticketHasLabel", with: { label: "factory" } }],
      },
    };
    const ok = await runRecipeCheck(step, GOOD, { callTool, isReadOnly });
    assert.equal(ok.pass, true, ok.reason);
    const refused = await runRecipeCheck(
      {
        ...step,
        recipe: {
          name: "x",
          steps: [{ use: "tracker.ticketExists", with: { tool: "editIssue" } }],
        },
      },
      GOOD,
      { callTool, isReadOnly },
    );
    assert.equal(refused.pass, false);
    assert.match(refused.reason, /could change something/);
  });
});

describe("the recipe step kind", () => {
  const step = (recipe) => ({
    kind: "check",
    name: "Ready",
    check: { kind: "recipe", recipe },
  });

  it("is a known kind, validated with validateRecipe when saved", () => {
    assert.ok(CHECK_KINDS.includes("recipe"));
    assert.equal(checksError({ steps: [step(READY_RECIPE)] }), null);
    assert.match(
      checksError({ steps: [step({ name: "x", steps: [] })] }),
      /the recipe isn't valid: steps: Add at least one step/,
    );
    assert.match(
      checksError({
        steps: [step({ name: "x", steps: [{ use: "git.nope" }] })],
      }),
      /There's no helper git\.nope/,
    );
    assert.match(
      checksError({
        steps: [
          step({
            name: "x",
            steps: [{ use: "git.committedSince", with: { min: "lots" } }],
          }),
        ],
      }),
      /must be a number/,
    );
    assert.match(recipeCheckError({ kind: "recipe" }), /needs its recipe/);
    // A repo's own helper can't be on a step: it lives in the repo.
    assert.match(
      recipeError({ name: "x", steps: [{ use: "team.titleSays" }] }),
      /no helper team\.titleSays/,
    );
    const kept = cleanBotChecks({ steps: [step(READY_RECIPE)] });
    assert.deepEqual(kept.steps[0].check.recipe, READY_RECIPE);
  });

  it("runs through checkRunner, each step's result in details", async () => {
    const ok = await runCheck(
      { kind: "recipe", recipe: READY_RECIPE },
      GOOD,
      {},
    );
    assert.equal(ok.pass, true, ok.reason);
    assert.equal(ok.kind, "recipe");
    assert.equal(ok.details.recipe, "the work is listed");
    assert.equal(ok.details.steps.length, 2);
    const bad = await runCheck(
      { kind: "recipe", recipe: READY_RECIPE },
      BAD,
      {},
    );
    assert.equal(bad.pass, false);
    assert.equal(bad.reason, "The handoff lists no changed files");
    assert.equal(bad.details.steps[1].pass, false);
    const invalid = await runCheck(
      { kind: "recipe", recipe: { name: "x" } },
      GOOD,
      {},
    );
    assert.match(
      invalid.reason,
      /This check can't run: the recipe isn't valid/,
    );
  });

  it("runs in the job's workspace, with git", async () => {
    const res = await runCheck(
      {
        kind: "recipe",
        recipe: {
          name: "on the branch",
          steps: [{ use: "git.onBranch" }],
        },
      },
      { ...GOOD, workspace: { dir: work, branch: "feat/DASH-133" } },
      { cwd: work },
    );
    assert.equal(res.pass, true, res.reason);
  });

  it("gets {team settings}, {item.*} and {repo.*} filled from the job", () => {
    const bot = {
      id: "b1",
      workspaceId: 1,
      checks: {
        steps: [
          step({
            name: "committed",
            steps: [
              {
                use: "git.committedSince",
                with: { base: "{repo.baseBranch}", min: "{minCommits}" },
              },
              {
                expect: "handoff.ticket",
                matcher: "toBe",
                args: ["{item.id}"],
              },
            ],
          }),
        ],
      },
    };
    const team = {
      declared: [
        { name: "minCommits", type: "number", default: 1 },
        {
          name: "repo",
          type: "table",
          columns: [{ name: "baseBranch", type: "text" }],
        },
      ],
      values: { minCommits: 2, repo: [{ key: "core", baseBranch: "master" }] },
    };
    const { bot: filled } = withTeamValues(bot, team, {
      picks: { repo: "core" },
      context: { item: { id: "DASH-133" } },
    });
    const r = filled.checks.steps[0].check.recipe;
    assert.equal(r.steps[0].with.base, "master");
    assert.equal(String(r.steps[0].with.min), "2");
    assert.deepEqual(r.steps[1].args, ["DASH-133"]);
    assert.equal(recipeError(r), null);
  });

  it("skips GitHub steps in a self-test, which opens no PR", async () => {
    const res = await runCheck(
      {
        kind: "recipe",
        recipe: {
          name: "ci",
          steps: [
            { use: "handoff.has", with: { keys: ["summary"] } },
            { use: "github.ciPassed" },
          ],
        },
      },
      GOOD,
      { selfTest: true },
    );
    assert.equal(res.pass, true, res.reason);
    assert.equal(res.details.steps[1].skipped, true);
  });
});

describe("the palette", () => {
  it("has the library's helpers and matchers, with their metadata", () => {
    const p = builtInPalette();
    const ids = p.helpers.map((h) => h.id);
    for (const id of [
      "git.committedSince",
      "handoff.has",
      "github.ciPassed",
      "tracker.ticketExists",
    ]) {
      assert.ok(ids.includes(id), id);
    }
    const h = p.helpers.find((x) => x.id === "git.committedSince");
    assert.ok(h.label && h.sentence && h.params.base);
    assert.ok(p.matchers.some((m) => m.id === "toHaveLengthAtLeast"));
  });

  it("loads a repo's own helpers in their own node", async () => {
    const dir = fs.mkdtempSync(path.join(root, "helpers-"));
    write(dir, ".dash/checks/helpers/title.js", TITLE_HELPER);
    write(dir, ".dash/checks/helpers/bad.js", "throw new Error('oops');\n");
    const r = await repoHelpersAt(dir, { tmpDir: root });
    assert.deepEqual(
      r.helpers.map((h) => h.id),
      ["team.titleSays"],
    );
    assert.equal(r.helpers[0].source, ".dash/checks/helpers/title.js");
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].error, /oops/);
  });
});

describe("list_check_helpers (MCP)", () => {
  const { listPalette } = require("./dashCheck");
  const { guideTools } = require("../mcp/toolDefinitions");
  const { TOOL_GROUPS } = require("../mcp/toolSwitches");
  const src = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

  it("is a guide tool with a switch and a handler", () => {
    const def = guideTools.find((t) => t.name === "list_check_helpers");
    assert.ok(def, "defined");
    assert.ok(def.inputSchema.properties.workspace);
    const g = TOOL_GROUPS.find((x) => x.tools.includes("list_check_helpers"));
    assert.equal(g.id, "themes");
    assert.match(
      src("mcp/guideTools.js"),
      /list_check_helpers: handleListCheckHelpers/,
    );
    assert.match(
      src("controller/llmController.js"),
      /list_check_helpers: toolHandlers\.handleListCheckHelpers/,
    );
    assert.match(
      src("mcp/toolHandlers.js"),
      /async function handleListCheckHelpers\(\{ workspace \} = \{\}\) \{[\s\S]{0,200}listPalette\(\{ workspace: workspace \|\| null \}\)/,
    );
  });

  it("returns the palette, helpers and matchers with metadata", async () => {
    const p = await listPalette({});
    assert.ok(p.helpers.some((h) => h.id === "node.testsPass" && h.params));
    assert.ok(p.matchers.some((m) => m.id === "toBe" && m.sentence));
    assert.equal(p.repo, undefined);
  });

  it("adds a repo's own helpers from its base branch", async () => {
    write(
      work,
      ".dash/checks/helpers/extra.js",
      TITLE_HELPER.replace("team.titleSays", "team.extra"),
    );
    const p = await listPalette({ workspace: work, tmpDir: root });
    assert.equal(p.repo.ref, "origin/main");
    assert.deepEqual(
      p.repo.helpers.map((h) => h.id),
      ["team.titleSays"],
      "only the base branch's",
    );
    assert.ok(p.helpers.some((h) => h.id === "git.onBranch"));
    const notThere = await listPalette({ workspace: path.join(root, "nope") });
    assert.match(notThere.error, /isn't a folder/);
  });
});

describe("a team copy of a recipe (Add check's draft)", () => {
  it("runs as the repo's .check.json would, until its PR is merged", async () => {
    const { cleanTeamCheck, teamCheckOf } = require("./teamChecks");
    const tc = cleanTeamCheck({
      file: "drafted.check.json",
      code: JSON.stringify(READY_RECIPE),
      state: "pr-open",
      pr: { url: "https://github.com/a/b/pull/9", number: 9, repo: "a/b" },
    });
    assert.ok(tc, "a .check.json team copy can be kept");
    const team = { teamChecks: { drafted: tc } };
    const opts = {
      cwd: work,
      tmpDir: root,
      teamCheck: (n) => teamCheckOf(team, n),
    };
    const ok = await runRepoCheck(
      { kind: "repo", name: "drafted" },
      GOOD,
      opts,
    );
    assert.equal(ok.pass, true, ok.reason);
    assert.equal(ok.details.state, "pr-open");
    assert.equal(ok.details.steps.length, 2);
    const bad = await runRepoCheck(
      { kind: "repo", name: "drafted" },
      BAD,
      opts,
    );
    assert.equal(bad.pass, false);
    assert.equal(bad.reason, "The handoff lists no changed files");
  });
});
