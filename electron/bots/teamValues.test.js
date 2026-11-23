/**
 * teamValues.test.js — a team's settings (DASH-57, Code Factory G6):
 * declared once, filled in at install, used as {name} in its bots'
 * instructions, checks and folders, the folders counting for the fence.
 * The same package installed twice with two repo URLs gives two working
 * teams, no bot edited.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  cleanSettings,
  cleanValues,
  mergeTeamValues,
  settingTexts,
  fill,
  namesUsed,
  withTeamValues,
  missingMessage,
} = require("./teamValues");
const {
  buildTeamManifest,
  validateTeamManifest,
  planTeamInstall,
  resolveReviewers,
  teamSummaryFor,
} = require("./teamManifest");
const { checksFlow } = require("./botChecks");
const { makeFence, fileToolOutside } = require("./engines/folderFence");
const BotRunner = require("./BotRunner");
const { makeBotToolHandlers } = require("../mcp/botTools");
const { createMcpTasks } = require("./mcpTasks");

const SETTINGS = [
  { name: "repoUrl", label: "Repository URL", type: "url" },
  { name: "baseBranch", label: "Base branch", type: "text", default: "main" },
  { name: "workFolder", label: "Work folder", type: "folder" },
  {
    name: "validate",
    label: "Validate command",
    type: "command",
    default: "npm test",
  },
  {
    name: "merge",
    label: "Merge when approved",
    type: "boolean",
    default: false,
  },
];

describe("declaring settings", () => {
  it("keeps name, label, type, default and description; drops the rest", () => {
    const { settings, errors } = cleanSettings([
      { name: "repoUrl", label: "Repo", type: "url", secret: "x" },
      { name: "n", type: "number", default: "3", description: "How many" },
      { name: "flag", type: "boolean", default: "yes" },
    ]);
    assert.deepEqual(errors, []);
    assert.deepEqual(settings, [
      { name: "repoUrl", label: "Repo", type: "url" },
      {
        name: "n",
        label: "n",
        type: "number",
        description: "How many",
        default: 3,
      },
      { name: "flag", label: "flag", type: "boolean", default: true },
    ]);
  });

  it("says what's wrong with each bad one", () => {
    const { settings, errors } = cleanSettings([
      { name: "1bad" },
      { name: "a", type: "colour" },
      { name: "b" },
      { name: "b" },
      { name: "dir", type: "folder", default: "relative/path" },
      { name: "n", type: "number", default: "lots" },
    ]);
    assert.deepEqual(
      settings.map((s) => s.name),
      ["b"],
    );
    assert.equal(errors.length, 5);
    assert.match(errors.join("\n"), /letters, digits and underscores/);
    assert.match(errors.join("\n"), /type must be one of/);
    assert.match(errors.join("\n"), /declared twice/);
    assert.match(errors.join("\n"), /whole path/);
    assert.match(errors.join("\n"), /isn't a number/);
  });
});

describe("values", () => {
  it("are checked against their type; '' clears one; others are kept", () => {
    const { values, errors } = cleanValues(
      SETTINGS,
      {
        repoUrl: " https://github.com/me/a.git ",
        merge: "yes",
        baseBranch: "",
      },
      { baseBranch: "develop", workFolder: "/tmp/w" },
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(values, {
      workFolder: "/tmp/w",
      repoUrl: "https://github.com/me/a.git",
      merge: true,
    });
  });

  it("refuses an unknown name, a relative folder and a non-number", () => {
    const { errors } = cleanValues(
      [...SETTINGS, { name: "n", label: "Count", type: "number" }],
      { nope: 1, workFolder: "work", n: "many" },
    );
    assert.equal(errors.length, 3);
    assert.match(errors[0], /isn't one of this team's settings/);
    assert.match(errors[1], /Work folder: must be a whole path/);
    assert.match(errors[2], /Count: must be a number/);
  });

  it("mergeTeamValues adds, replaces and removes settings, all or nothing", () => {
    const current = {
      declared: SETTINGS,
      values: { repoUrl: "a", merge: true },
    };
    const next = mergeTeamValues(current, {
      declare: [
        { name: "baseBranch", label: "Branch", type: "text", default: "dev" },
      ],
      remove: ["merge"],
      values: { repoUrl: "b" },
    });
    assert.deepEqual(next.errors, []);
    assert.equal(
      next.declared.find((d) => d.name === "baseBranch").default,
      "dev",
    );
    assert.ok(!next.declared.some((d) => d.name === "merge"));
    assert.deepEqual(next.values, { repoUrl: "b" });
    const bad = mergeTeamValues(current, { remove: ["ghost"] });
    assert.match(bad.errors[0], /"ghost" isn't one of this team's settings/);
  });
});

describe("{name} in a bot", () => {
  const team = {
    declared: SETTINGS,
    values: {
      repoUrl: "git@github.com:me/sandbox.git",
      workFolder: "~/Factory",
    },
  };
  const home = "/Users/me";
  const bot = {
    id: "bot_coder",
    workspaceId: "7",
    name: "Coder",
    instructions:
      'Clone {repoUrl} into {workFolder}/repo on {baseBranch}. Merge: {merge}. JSON stays: {"a": 1} and {unknown}.',
    projects: ["{workFolder}"],
    checks: {
      steps: [
        {
          id: "step_c1",
          kind: "check",
          name: "Validate",
          check: {
            kind: "command",
            command: 'cd "{workFolder}/repo" && {validate}',
          },
        },
      ],
      onFail: "retry",
      maxTries: 3,
      handsOn: "answer",
    },
    schedules: [{ cron: "0 9 * * *", prompt: "Work {baseBranch}" }],
    subscriptions: [{ eventType: "x", note: "On {repoUrl}" }],
  };

  it("fills in instructions, folders, checks, prompts and notes", () => {
    const { bot: run, missing } = withTeamValues(bot, team, { home });
    assert.deepEqual(missing, []);
    assert.equal(
      run.instructions,
      'Clone git@github.com:me/sandbox.git into /Users/me/Factory/repo on main. Merge: no. JSON stays: {"a": 1} and {unknown}.',
    );
    assert.deepEqual(run.projects, ["/Users/me/Factory"]);
    assert.equal(
      run.checks.steps[0].check.command,
      'cd "/Users/me/Factory/repo" && npm test',
    );
    assert.equal(run.schedules[0].prompt, "Work main");
    assert.equal(run.subscriptions[0].note, "On git@github.com:me/sandbox.git");
    // The bot itself keeps {name}.
    assert.deepEqual(bot.projects, ["{workFolder}"]);
    assert.match(bot.instructions, /\{repoUrl\}/);
  });

  it("the checks job runs the filled-in command", () => {
    const flow = checksFlow(withTeamValues(bot, team, { home }).bot);
    const step = flow.steps.find((s) => s.id === "step_c1");
    assert.equal(step.check.command, 'cd "/Users/me/Factory/repo" && npm test');
  });

  it("a folder from a setting is a real folder for the fence", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash57-"));
    try {
      const run = withTeamValues(bot, {
        ...team,
        values: { ...team.values, workFolder: dir },
      }).bot;
      const fence = makeFence({ projects: run.projects });
      assert.ok(fence, "the bot has a fence");
      assert.equal(
        fileToolOutside(fence, "Write", {
          file_path: path.join(dir, "repo", "a.js"),
        }),
        null,
      );
      assert.ok(fileToolOutside(fence, "Write", { file_path: "/etc/hosts" }));
      // Unfilled, it's no folder at all.
      assert.equal(makeFence({ projects: bot.projects }), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a setting it uses with no value is missing, and says how to fix it", () => {
    const { missing } = withTeamValues(
      bot,
      { declared: SETTINGS, values: {} },
      { home },
    );
    assert.deepEqual(
      missing.map((m) => m.name),
      ["repoUrl", "workFolder"],
    );
    assert.match(
      missingMessage(missing),
      /Repository URL \(\{repoUrl\}\), Work folder \(\{workFolder\}\) have no value: fill them in on the dashboard/,
    );
  });

  it("a bot whose team declares nothing is left as it is", () => {
    assert.equal(withTeamValues(bot, {}).bot, bot);
    assert.equal(fill("a {b} c", {}), "a {b} c");
    assert.deepEqual(namesUsed(bot).sort(), [
      "baseBranch",
      "merge",
      "repoUrl",
      "unknown",
      "validate",
      "workFolder",
    ]);
    assert.deepEqual(settingTexts({ declared: SETTINGS }).text, {
      baseBranch: "main",
      validate: "npm test",
      merge: "no",
    });
  });
});

describe("a Code Factory package installed twice", () => {
  const bots = [
    {
      id: "bot_coder",
      name: "Coder",
      instructions: "Work on {repoUrl} in {workFolder}/repo.",
      projects: ["{workFolder}", "/Users/me/private"],
      checks: {
        steps: [
          {
            id: "step_c1",
            kind: "check",
            name: "Tests pass",
            check: {
              kind: "command",
              command: "cd {workFolder}/repo && {validate}",
            },
          },
          {
            id: "step_c2",
            kind: "reviewer",
            name: "Review",
            botId: "bot_reviewer",
          },
          {
            id: "step_c3",
            kind: "check",
            name: "Mine",
            check: { kind: "script", script: "local:/Users/me/x.js" },
          },
        ],
        onFail: "retry",
        maxTries: 3,
        handsOn: "answer",
      },
    },
    {
      id: "bot_reviewer",
      name: "Reviewer",
      instructions: "Review the PR on {repoUrl}.",
    },
  ];

  const exported = buildTeamManifest({
    name: "Code Factory",
    bots,
    providers: [],
    settings: SETTINGS,
  });

  it("the package carries the settings (no values), setting folders and checks", () => {
    const m = exported.manifest;
    assert.deepEqual(
      m.settings.map((s) => s.name),
      SETTINGS.map((s) => s.name),
    );
    const coder = m.members.find((x) => x.role === "coder").embedded;
    assert.deepEqual(coder.projects, ["{workFolder}"]);
    assert.deepEqual(
      coder.checks.steps.map((s) => [s.kind, s.role || null]),
      [
        ["check", null],
        ["reviewer", "reviewer"],
      ],
    );
    assert.match(
      exported.notIncluded.join("\n"),
      /the folder "\/Users\/me\/private"/,
    );
    assert.match(
      exported.notIncluded.join("\n"),
      /its script is a file on this computer/,
    );
    assert.deepEqual(
      teamSummaryFor(m).settings.map((s) => s.name),
      SETTINGS.map((s) => s.name),
    );
  });

  it("a package can't carry a folder on someone's computer, or review itself", () => {
    const m = JSON.parse(JSON.stringify(exported.manifest));
    m.members[0].embedded.projects = ["/Users/someone/secret"];
    m.members[1].embedded.checks = {
      steps: [{ kind: "reviewer", role: "reviewer", name: "Me" }],
    };
    const r = validateTeamManifest(m);
    assert.equal(r.valid, false);
    assert.match(
      r.errors.join("\n"),
      /a folder must start with one of the team's settings/,
    );
    assert.match(r.errors.join("\n"), /can't review its own work/);
  });

  it("two installs with two repo URLs: two working teams, no bot edited", () => {
    const { valid, manifest } = validateTeamManifest(
      JSON.parse(JSON.stringify(exported.manifest)),
    );
    assert.equal(valid, true);
    const install = (workspaceId, values, n) => {
      const plan = planTeamInstall(manifest, { workspaceId, providers: [] });
      const merged = mergeTeamValues({}, { declare: plan.settings, values });
      assert.deepEqual(merged.errors, []);
      // As _installTeamPlan does: create, then point reviewers at the bots.
      const created = {};
      plan.members.forEach((mem) => {
        created[mem.role] = { ...mem.definition, id: `bot_${mem.role}_${n}` };
      });
      for (const role of Object.keys(created)) {
        created[role].checks = resolveReviewers(created[role].checks, created);
      }
      return {
        created,
        team: { declared: merged.declared, values: merged.values },
      };
    };
    const a = install(
      "1",
      {
        repoUrl: "https://github.com/me/sandbox.git",
        workFolder: "/w/sandbox",
      },
      1,
    );
    const b = install(
      "2",
      {
        repoUrl: "https://github.com/trops/dash-core.git",
        workFolder: "/w/core",
      },
      2,
    );
    // The installed bots are the same: {name} kept.
    assert.equal(a.created.coder.instructions, b.created.coder.instructions);
    assert.deepEqual(a.created.coder.projects, ["{workFolder}"]);
    // The reviewer is each team's own.
    assert.equal(a.created.coder.checks.steps[1].botId, "bot_reviewer_1");
    assert.equal(b.created.coder.checks.steps[1].botId, "bot_reviewer_2");
    // As they run: each its own repo, folder and check.
    const runA = withTeamValues(a.created.coder, a.team).bot;
    const runB = withTeamValues(b.created.coder, b.team).bot;
    assert.equal(
      runA.instructions,
      "Work on https://github.com/me/sandbox.git in /w/sandbox/repo.",
    );
    assert.equal(
      runB.instructions,
      "Work on https://github.com/trops/dash-core.git in /w/core/repo.",
    );
    assert.deepEqual(runA.projects, ["/w/sandbox"]);
    assert.deepEqual(runB.projects, ["/w/core"]);
    assert.equal(
      runA.checks.steps[0].check.command,
      "cd /w/sandbox/repo && npm test",
    );
    assert.equal(
      runB.checks.steps[0].check.command,
      "cd /w/core/repo && npm test",
    );
  });
});

describe("a run (BotRunner)", () => {
  function runnerFor(team) {
    const engine = {
      id: "tool-loop",
      lastCtx: null,
      run(ctx) {
        engine.lastCtx = ctx;
        return (async function* () {
          yield { type: "done", stopReason: "end_turn" };
        })();
      },
    };
    const runs = [];
    const runner = new BotRunner({
      engines: { getEngine: () => engine },
      store: {
        get: () => ({
          id: "bot_1",
          name: "Coder",
          workspaceId: "7",
          instructions: "Work on {repoUrl}.",
          projects: ["{workFolder}"],
          mcpServers: [],
          allowedTools: [],
        }),
        getTeamSettings: () => team,
        saveSession: () => {},
        appendRun: (id, run) => {
          runs.push(run);
          return run;
        },
      },
      approvals: {
        create: () => ({ id: "a", promise: Promise.resolve({ allow: false }) }),
      },
      resolveRunProfile: async () => ({
        providerId: "anthropic",
        engineId: "tool-loop",
        adapterId: "anthropic",
        model: "m",
        credentials: { apiKey: "sk" },
      }),
      resolveTools: async () => ({ tools: [], resolveServer: () => null }),
      callTool: async () => ({ text: "ok" }),
      makeRequestPermission: () => async () => ({ allow: true }),
    });
    return { runner, engine, runs };
  }

  it("runs with the team's values filled in", async () => {
    const { runner, engine } = runnerFor({
      declared: SETTINGS,
      values: { repoUrl: "https://github.com/me/a.git", workFolder: "/w/a" },
    });
    await runner.run("bot_1", { prompt: "go" });
    assert.match(
      engine.lastCtx.systemPrompt,
      /Work on https:\/\/github\.com\/me\/a\.git\./,
    );
    assert.deepEqual(engine.lastCtx.projects, ["/w/a"]);
  });

  it("fails, saying which setting is empty, before it starts", async () => {
    const { runner, engine, runs } = runnerFor({
      declared: SETTINGS,
      values: {},
    });
    const record = await runner.run("bot_1", { prompt: "go" });
    assert.equal(engine.lastCtx, null);
    assert.equal(record.status, "failed");
    assert.match(
      runs[0].error || record.error,
      /Repository URL \(\{repoUrl\}\), Work folder \(\{workFolder\}\) have no value/,
    );
  });
});

describe("set_team_settings over MCP", () => {
  function setup({ asks = true } = {}) {
    const state = {
      team: { declared: [], values: {} },
      saved: 0,
      notices: [],
      audit: [],
    };
    const bots = [
      {
        id: "b1",
        workspaceId: "1",
        name: "Coder",
        instructions: "Use {workFolder}.",
        projects: ["{workFolder}"],
      },
    ];
    const usedBy = (t) =>
      t.declared.some((d) => d.name === "workFolder")
        ? { workFolder: ["Coder"] }
        : {};
    const tasks = createMcpTasks({
      store: {
        loadTasks: () => [],
        saveTasks: () => {},
        getPassphrase: () => "purple otter",
        getLock: () => null,
        saveLock: () => {},
      },
    });
    const handlers = makeBotToolHandlers({
      getWorkspaces: () => [
        { id: 1, name: "Factory" },
        { id: 2, name: "Other" },
      ],
      isOn: () => true,
      newId: () => "req_1",
      bots: {
        list: () => bots,
        pauseState: () => ({ global: false, bots: [] }),
        getGrant: () => null,
        takesMcpBots: (id) => String(id) === "1",
        asksBotPassphrase: () => asks,
        tasks: () => tasks,
        logAudit: (e) => state.audit.push(e),
        sendNotice: (n) => state.notices.push(n),
        teamValues: () => ({ ...state.team, usedBy: usedBy(state.team) }),
        setTeamValues: (id, change, opts = {}) => {
          const m = mergeTeamValues(state.team, change);
          if (m.errors.length) return { errors: m.errors };
          if (!opts.dryRun) {
            state.team = { declared: m.declared, values: m.values };
            state.saved++;
          }
          return { declared: m.declared, values: m.values, usedBy: usedBy(m) };
        },
      },
    });
    return { handlers, state };
  }
  const body = (r) => JSON.parse(r.content[0].text);

  it("declares and sets, after the passphrase, with a summary", async () => {
    const { handlers, state } = setup();
    const w = body(
      await handlers.set_team_settings({
        team: "Factory",
        declare: [{ name: "workFolder", label: "Work folder", type: "folder" }],
        values: { workFolder: "/w/a" },
      }),
    );
    assert.equal(w.status, "waiting");
    assert.match(
      w.summary,
      /New setting Work folder \(\{workFolder\}\): folder; value "\/w\/a"/,
    );
    assert.equal(state.saved, 0);
    const done = body(
      await handlers.confirm_bot({
        requestId: "req_1",
        passphrase: "purple otter",
      }),
    );
    assert.equal(done.status, "changed");
    assert.deepEqual(state.team.values, { workFolder: "/w/a" });
  });

  it("a folder change a bot works in says it's more access", async () => {
    const { handlers, state } = setup({ asks: false });
    state.team = {
      declared: [{ name: "workFolder", label: "Work folder", type: "folder" }],
      values: { workFolder: "/w/a" },
    };
    const r = body(
      await handlers.set_team_settings({
        team: "1",
        values: { workFolder: "/w/b" },
      }),
    );
    assert.equal(r.status, "changed");
    assert.equal(state.team.values.workFolder, "/w/b");
    assert.equal(state.audit[0].botId, "b1");
    const { handlers: h2, state: s2 } = setup();
    s2.team = {
      declared: [{ name: "workFolder", label: "Work folder", type: "folder" }],
      values: { workFolder: "/w/a" },
    };
    const w = body(
      await h2.set_team_settings({ team: "1", values: { workFolder: "/w/b" } }),
    );
    assert.match(w.summary, /"\/w\/a" → "\/w\/b" \(used by Coder\)/);
    assert.match(w.summary, /more access \(Coder may work in "\/w\/b"\)/);
  });

  it("bad settings come back with every reason; a team it can't change is refused", async () => {
    const { handlers, state } = setup();
    const bad = body(
      await handlers.set_team_settings({
        team: "1",
        declare: [{ name: "9" }],
        values: { nope: 1 },
      }),
    );
    assert.equal(bad.status, "invalid");
    assert.equal(bad.reasons.length, 2);
    const other = body(
      await handlers.set_team_settings({ team: "Other", values: {} }),
    );
    assert.equal(other.status, "needs-team");
    assert.equal(state.saved, 0);
  });

  it("list_bots shows each team's settings", async () => {
    const { handlers, state } = setup();
    state.team = {
      declared: [{ name: "workFolder", label: "Work folder", type: "folder" }],
      values: { workFolder: "/w/a" },
    };
    const r = body(await handlers.list_bots({}));
    assert.deepEqual(r.teams[0].settings.values, { workFolder: "/w/a" });
    assert.deepEqual(r.teams[0].settings.usedBy, { workFolder: ["Coder"] });
  });
});
