/**
 * botOwnSettings.test.js — settings a bot owns (DASH-136): declared and
 * kept on the bot, filled into its run on top of its team's, carried by a
 * package per member, filled in at install, reported per bot by the setup
 * check, and changed over MCP's update_bot. Team-level settings keep
 * working as before.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const BotRunner = require("./BotRunner");
const {
  mergeBotSettings,
  normalizeBotSettings,
  withTeamValues,
  missingMessage,
  mergeTeamValues,
  pickFrom,
} = require("./teamValues");
const { validateBotDefinition, withDefaults } = require("./botSchema");
const {
  buildTeamManifest,
  validateTeamManifest,
  planTeamInstall,
  teamSummaryFor,
} = require("./teamManifest");
const { settingProblems, preflight } = require("./preflight");
const { botUpdatePatch } = require("./botUpdate");
const {
  withBotSettings,
  botSetupStatus,
  splitInstallValues,
  BOT_VALUES_KEY,
} = require("../../src/utils/botSettings");

const WORK_FOLDER = {
  name: "workFolder",
  label: "Work folder",
  type: "folder",
  required: true,
  description: "Where it clones repos on this computer.",
};

const workspaceBot = (extra = {}) => ({
  id: "bot_ws",
  name: "Workspace Bot",
  workspaceId: "7",
  instructions: "Clone the repo you're handed into {workFolder}.",
  projects: ["{workFolder}"],
  settings: [WORK_FOLDER],
  settingValues: {},
  ...extra,
});

describe("declaring a bot's own settings", () => {
  it("keeps required, and checks them like a team's", () => {
    const r = mergeBotSettings(null, {
      declare: [WORK_FOLDER, { name: "bad name" }],
    });
    assert.equal(r.errors.length, 1);
    const ok = mergeBotSettings(null, {
      declare: [WORK_FOLDER],
      values: { workFolder: "~/Factory" },
    });
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.settings[0].required, true);
    assert.deepEqual(ok.settingValues, { workFolder: "~/Factory" });
    const bad = mergeBotSettings(ok, { values: { ghost: "x" } });
    assert.match(bad.errors[0], /isn't one of this bot's settings/);
    const relative = mergeBotSettings(
      { settings: ok.settings, settingValues: ok.settingValues },
      { values: { workFolder: "Factory" } },
    );
    assert.match(relative.errors[0], /whole path/);
  });

  it("a bot definition is checked, and a value of a removed setting is dropped", () => {
    const def = withDefaults(
      workspaceBot({ settingValues: { workFolder: "x" } }),
    );
    assert.equal(validateBotDefinition(def).valid, false);
    const stale = normalizeBotSettings({
      settings: [WORK_FOLDER],
      settingValues: { workFolder: "/w", gone: "y" },
    });
    assert.deepEqual(stale.errors, []);
    assert.deepEqual(stale.settingValues, { workFolder: "/w" });
    assert.equal(
      validateBotDefinition(withDefaults({ ...workspaceBot(), settings: "x" }))
        .valid,
      false,
    );
    assert.equal(
      validateBotDefinition(withDefaults(workspaceBot())).valid,
      true,
    );
  });
});

describe("a bot's own settings in its run", () => {
  it("fill in {name} on top of the team's (the bot's wins)", () => {
    const team = mergeTeamValues(null, {
      declare: [
        { name: "workFolder", label: "Team folder", type: "folder" },
        { name: "baseBranch", label: "Base branch", type: "text" },
      ],
      values: { workFolder: "/team", baseBranch: "main" },
    });
    const bot = workspaceBot({
      instructions: "Clone into {workFolder} from {baseBranch}.",
      settingValues: { workFolder: "/mine" },
    });
    const { bot: filled, missing } = withTeamValues(
      bot,
      withBotSettings(team, bot),
    );
    assert.deepEqual(missing, []);
    assert.equal(filled.instructions, "Clone into /mine from main.");
    assert.deepEqual(filled.projects, ["/mine"]);
    // The team's own settings are left alone.
    assert.equal(team.values.workFolder, "/team");
  });

  it("an empty one fails the run, pointing at the bot's Settings tab", () => {
    const bot = workspaceBot();
    const { missing } = withTeamValues(bot, withBotSettings(null, bot));
    assert.equal(missing.length, 1);
    assert.equal(missing[0].owner, "bot");
    assert.match(
      missingMessage(missing),
      /This bot's setting Work folder \(\{workFolder\}\) has no value: fill it in on this bot's Settings tab/,
    );
  });

  it("a team setting keeps its old message", () => {
    const team = mergeTeamValues(null, {
      declare: [{ name: "repoUrl", label: "Repository URL", type: "url" }],
    });
    const { missing } = withTeamValues(
      { instructions: "Work on {repoUrl}." },
      team,
    );
    assert.match(
      missingMessage(missing),
      /This team's setting Repository URL \(\{repoUrl\}\) has no value: fill it in on the dashboard \(Bots › Team settings\)/,
    );
  });

  it("a bot's own table is picked from its own answer", () => {
    const bot = {
      settings: [
        {
          name: "repo",
          label: "Repos",
          type: "table",
          columns: [{ name: "url", type: "url" }],
        },
      ],
      settingValues: { repo: [{ key: "web", url: "https://x/web.git" }] },
    };
    const picks = pickFrom(
      '```json\n{"repo": "web"}\n```',
      withBotSettings(null, bot),
    );
    assert.deepEqual(picks, { repo: "web" });
  });

  it("BotRunner runs a bot with its own values, on a team or off one", async () => {
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
    const stored = workspaceBot({
      workspaceId: null,
      mcpServers: [],
      allowedTools: [],
      settingValues: { workFolder: "/w/own" },
    });
    const runner = new BotRunner({
      engines: { getEngine: () => engine },
      store: {
        get: () => stored,
        getTeamSettings: () => ({}),
        saveSession: () => {},
        appendRun: (_id, run) => run,
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
    await runner.run("bot_ws", { prompt: "go" });
    assert.match(
      engine.lastCtx.systemPrompt,
      /Clone the repo you're handed into \/w\/own\./,
    );
    assert.deepEqual(engine.lastCtx.projects, ["/w/own"]);
  });
});

describe("setup status (botSetupStatus) and the setup check", () => {
  const team = mergeTeamValues(null, {
    declare: [{ name: "repoUrl", label: "Repository URL", type: "url" }],
  });
  const bots = [
    {
      id: "bot_lead",
      name: "Planner",
      role: "lead",
      instructions: "{repoUrl}",
    },
    workspaceBot(),
    { id: "bot_coder", name: "Coder", instructions: "Work on {repoUrl}." },
    { id: "bot_ok", name: "Reporter", instructions: "Report." },
  ];

  it("lists only the bots with something missing, per bot", () => {
    const status = botSetupStatus(bots, team);
    assert.deepEqual(status, [
      {
        botId: "bot_ws",
        name: "Workspace Bot",
        missing: [
          {
            name: "workFolder",
            label: "Work folder",
            owner: "bot",
            type: "folder",
          },
        ],
      },
      {
        botId: "bot_coder",
        name: "Coder",
        missing: [
          {
            name: "repoUrl",
            label: "Repository URL",
            owner: "team",
            type: "url",
          },
        ],
      },
    ]);
  });

  it("a required setting counts even when its text doesn't use it", () => {
    const status = botSetupStatus(
      [workspaceBot({ instructions: "Set up a branch.", projects: [] })],
      null,
    );
    assert.equal(status.length, 1);
    const filled = botSetupStatus(
      [workspaceBot({ settingValues: { workFolder: "~/F" } })],
      null,
    );
    assert.deepEqual(filled, []);
  });

  it("check setup says which bot and where to fill it in", async () => {
    const problems = settingProblems(workspaceBot(), null, "/home/me");
    assert.equal(problems.length, 1);
    assert.equal(problems[0].owner, "bot");
    assert.equal(problems[0].botId, "bot_ws");
    assert.match(
      problems[0].message,
      /^Workspace Bot: Work folder has no value: fill it in on its Settings tab/,
    );
    const unused = settingProblems(
      workspaceBot({ instructions: "Hi.", projects: [] }),
      null,
      null,
    );
    assert.equal(unused.length, 1);
    const res = await preflight({ bots: [workspaceBot()], team: null }, {});
    assert.equal(res.ok, false);
  });

  it("a bot's own repos table is checked like the team's", async () => {
    const triage = {
      id: "bot_tr",
      name: "Triage",
      instructions: "Pick one of {repo.rows}.",
      settings: [
        {
          name: "repo",
          label: "Repos",
          type: "table",
          required: true,
          columns: [{ name: "url", label: "Clone URL", type: "url" }],
        },
      ],
      settingValues: {
        repo: [{ key: "web", url: "https://github.com/me/web.git" }],
      },
    };
    const asked = [];
    const res = await preflight(
      { bots: [triage], team: null },
      {
        fetch: async (url) => {
          asked.push(url);
          return { status: 404, json: async () => ({}) };
        },
      },
    );
    assert.ok(asked.some((u) => /repos\/me\/web$/.test(u)));
    assert.ok(res.problems.some((p) => p.kind === "repo-read"));
  });
});

describe("a package declares settings per bot", () => {
  const bots = [
    workspaceBot({ settingValues: { workFolder: "/Users/me/F" } }),
    { id: "bot_tb", name: "Ticket Bot", instructions: "Take a ticket." },
  ];
  const exported = buildTeamManifest({ name: "Team", bots, providers: [] });

  it("carries the declarations (never the values) and the folders made from them", () => {
    const m = exported.manifest.members.find((x) => x.role === "workspace-bot");
    assert.deepEqual(m.embedded.settings, [WORK_FOLDER]);
    assert.deepEqual(m.embedded.projects, ["{workFolder}"]);
    assert.doesNotMatch(JSON.stringify(exported.manifest), /\/Users\/me\/F/);
    assert.equal(exported.manifest.settings, undefined);
  });

  it("validates them, plans them per bot and shows them in the summary", () => {
    const v = validateTeamManifest(exported.manifest);
    assert.equal(v.valid, true, v.errors.join("; "));
    const plan = planTeamInstall(v.manifest, {
      workspaceId: "9",
      providers: [],
    });
    assert.deepEqual(plan.botSettings, [
      { role: "workspace-bot", name: "Workspace Bot", settings: [WORK_FOLDER] },
    ]);
    const member = plan.members.find((x) => x.role === "workspace-bot");
    assert.deepEqual(member.definition.settings, [WORK_FOLDER]);
    const summary = teamSummaryFor(v.manifest);
    assert.deepEqual(
      summary.members.find((x) => x.role === "workspace-bot").settings,
      [WORK_FOLDER],
    );
    const bad = JSON.parse(JSON.stringify(exported.manifest));
    bad.members[0].embedded.settings = [{ name: "1x" }];
    assert.equal(validateTeamManifest(bad).valid, false);
  });

  it("an update takes the new declarations and keeps the values filled in", () => {
    const existing = workspaceBot({
      settingValues: { workFolder: "/w", gone: "x" },
    });
    const { patch } = botUpdatePatch(existing, {
      definition: {
        name: "Workspace Bot",
        instructions: "i",
        settings: [WORK_FOLDER],
      },
      needs: [],
    });
    assert.deepEqual(patch.settings, [WORK_FOLDER]);
    assert.deepEqual(patch.settingValues, { workFolder: "/w" });
  });

  it("install values carry each bot's under @bots", () => {
    const split = splitInstallValues({
      repoUrl: "x",
      [BOT_VALUES_KEY]: { "workspace-bot": { workFolder: "/w" } },
    });
    assert.deepEqual(split.team, { repoUrl: "x" });
    assert.deepEqual(split.bots, { "workspace-bot": { workFolder: "/w" } });
    assert.deepEqual(splitInstallValues(null), { team: null, bots: {} });
  });
});
