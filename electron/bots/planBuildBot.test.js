/**
 * planBuildBot.test.js — one bot through the Dash team (consolidation
 * Phase 2c-1): checked, saved paused, its results card on the dashboard it
 * goes on (if any). No new dashboard, ever; a bot with no dashboard is saved
 * Unassigned.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  planSteps,
  createPlanBuild,
  planBotDefinition,
} = require("./planBuild");

// Source checks: botController needs Electron.
const ctrl = fs.readFileSync(
  path.join(__dirname, "..", "controller", "botController.js"),
  "utf8",
);

const piece = {
  kind: "bot",
  name: "Morning Email Summary",
  source: "new",
  instructions: "Summarize my unread email.",
  tools: [{ provider: "gmail", tools: ["search"] }],
  schedule: { cron: "30 7 * * 1-5" },
  showResults: true,
};
const onDashboard = {
  summary: "A morning email summary",
  dashboard: { id: "7", name: "Morning Brief" },
  pieces: [piece],
};
const unassigned = {
  summary: "A morning email summary",
  pieces: [{ ...piece, showResults: false }],
};

function deps(over = {}) {
  const calls = [];
  return {
    calls,
    useDashboard: async (id) => {
      calls.push(["useDashboard", id]);
      return { id, name: "Morning Brief" };
    },
    createDashboard: async () => {
      throw new Error("a bot build made a dashboard");
    },
    checkBot: async (req) => {
      calls.push(["checkBot", req.dashboardId, req.piece.name]);
      return { detail: "gmail connected · schedule is valid" };
    },
    botDefinition: async (req) => {
      calls.push(["botDefinition", req.dashboardId, req.piece.name]);
      return { name: req.piece.name, instructions: req.piece.instructions };
    },
    saveBot: async (req) => {
      calls.push(["saveBot", req.dashboardId, req.piece.name, req.sample]);
      return { id: "bot_1", name: req.piece.name };
    },
    placeBotResults: async (req) => {
      calls.push(["results", req.dashboardId, req.botId]);
      return { component: "dash.bots.BotResults", widgetId: "w1" };
    },
    askRole: async () => {
      throw new Error("a bot build asked an AI role");
    },
    emit: () => {},
    now: () => "2026-10-20T00:00:00.000Z",
    ...over,
  };
}

const ids = (plan) => planSteps(plan, { bot: true }).map((s) => s.id);

describe("bot builds — steps", () => {
  it("on a dashboard: use it → check → test → save → results card", () => {
    assert.deepEqual(ids(onDashboard), [
      "dashboard",
      "checkbot:0",
      "testbot:0",
      "bot:0",
      "results:0",
    ]);
  });
  it("no dashboard: check → test → save, no dashboard step, no results card", () => {
    assert.deepEqual(ids(unassigned), ["checkbot:0", "testbot:0", "bot:0"]);
  });
  it("says it's saved paused, and the user tests it first", () => {
    const steps = planSteps(onDashboard, { bot: true });
    assert.equal(
      steps.find((s) => s.id === "bot:0").label,
      "Save Morning Email Summary — paused",
    );
    const test = steps.find((s) => s.id === "testbot:0");
    assert.equal(test.label, "Test Morning Email Summary");
    assert.equal(test.role, "you");
    assert.deepEqual(steps.find((s) => s.id === "bot:0").needs, ["testbot:0"]);
  });
  it("a bot with no dashboard never gets a results card", () => {
    assert.deepEqual(
      ids({ ...unassigned, pieces: [{ ...piece, showResults: true }] }),
      ["checkbot:0", "testbot:0", "bot:0"],
    );
  });
});

const SAMPLE = {
  at: "2026-10-20T00:00:00.000Z",
  answer: "3 unread emails need a reply.",
  results: [],
  shape: { kind: "text", lines: 1, chars: 29 },
};

/** Run a bot build to its test, then test it and save. */
async function testedAndSaved(b) {
  const waiting = await b.run();
  assert.equal(waiting.status, "waiting-for-you");
  const test = waiting.steps.find((s) => s.id === "testbot:0");
  assert.equal(test.status, "needs-you");
  return b.approve("testbot:0", { sample: SAMPLE });
}

describe("bot builds — running", () => {
  it("on a dashboard: checked, tested, saved there, results placed; no AI", async () => {
    const d = deps();
    const state = await testedAndSaved(
      createPlanBuild(onDashboard, d, { bot: true }),
    );
    assert.equal(state.status, "done");
    assert.deepEqual(
      d.calls.map((c) => c[0]),
      ["useDashboard", "checkBot", "botDefinition", "saveBot", "results"],
    );
    assert.deepEqual(d.calls[3].slice(0, 3), [
      "saveBot",
      "7",
      "Morning Email Summary",
    ]);
    assert.deepEqual(state.bots[0], {
      id: "bot_1",
      name: "Morning Email Summary",
    });
    const check = state.steps.find((s) => s.id === "checkbot:0");
    assert.equal(check.detail, "gmail connected · schedule is valid");
  });

  it("no dashboard: saved Unassigned (dashboardId null)", async () => {
    const d = deps();
    const state = await testedAndSaved(
      createPlanBuild(unassigned, d, { bot: true }),
    );
    assert.equal(state.status, "done");
    assert.deepEqual(
      d.calls.filter((c) => c[0] !== "botDefinition").map((c) => c.slice(0, 2)),
      [
        ["checkBot", null],
        ["saveBot", null],
      ],
    );
    assert.equal(state.dashboard, null);
  });

  it("a failed check saves nothing and can be tried again", async () => {
    let fail = true;
    const d = deps({
      checkBot: async () => {
        if (fail) throw new Error('"bad" isn\'t a valid schedule');
        return { detail: "ok" };
      },
    });
    const b = createPlanBuild(unassigned, d, { bot: true });
    const state = await b.run();
    const check = state.steps.find((s) => s.id === "checkbot:0");
    assert.equal(check.status, "failed");
    assert.equal(check.canRetry, true);
    assert.equal(
      state.steps.find((s) => s.id === "testbot:0").status,
      "skipped",
    );
    assert.equal(state.steps.find((s) => s.id === "bot:0").status, "skipped");
    assert.ok(!d.calls.some((c) => c[0] === "saveBot"));
    fail = false;
    const after = await b.retry("checkbot:0");
    assert.equal(after.status, "waiting-for-you");
    const saved = await b.approve("testbot:0", { sample: SAMPLE });
    assert.equal(saved.status, "done");
    assert.ok(d.calls.some((c) => c[0] === "saveBot"));
  });

  it("a provider that isn't connected waits instead of failing", async () => {
    const d = deps({
      checkBot: async () => {
        const err = new Error("needs gmail");
        err.waitingFor = ["gmail"];
        throw err;
      },
    });
    const state = await createPlanBuild(unassigned, d, { bot: true }).run();
    const check = state.steps.find((s) => s.id === "checkbot:0");
    assert.equal(check.status, "needs-provider");
    assert.deepEqual(check.waitingFor, ["gmail"]);
    assert.ok(!d.calls.some((c) => c[0] === "botDefinition"));
  });
});

// TST-003 (DASH-17): nothing is saved until the user tests the bot.
describe("bot builds — tested before it's saved", () => {
  it("waits at its test with the bot exactly as it will be saved", async () => {
    const d = deps();
    const state = await createPlanBuild(unassigned, d, {
      bot: true,
    }).run();
    const test = state.steps.find((s) => s.id === "testbot:0");
    assert.equal(test.status, "needs-you");
    assert.deepEqual(test.definition, {
      name: "Morning Email Summary",
      instructions: "Summarize my unread email.",
    });
    assert.ok(!d.calls.some((c) => c[0] === "saveBot"));
  });

  it("Save needs a finished test, and keeps it as the sample", async () => {
    const d = deps();
    const b = createPlanBuild(unassigned, d, { bot: true });
    await b.run();
    const refused = await b.approve("testbot:0", {});
    assert.match(refused.error, /Test it first/);
    assert.ok(!d.calls.some((c) => c[0] === "saveBot"));
    const state = await b.approve("testbot:0", { sample: SAMPLE });
    assert.equal(state.status, "done");
    const save = d.calls.find((c) => c[0] === "saveBot");
    assert.deepEqual(save[3], SAMPLE);
    assert.equal(
      state.steps.find((s) => s.id === "testbot:0").detail,
      "Tested",
    );
  });

  it("never keeps the answer in the build's state (Recent keeps that)", async () => {
    const d = deps();
    const b = createPlanBuild(unassigned, d, { bot: true });
    await b.run();
    const state = await b.approve("testbot:0", { sample: SAMPLE });
    assert.ok(!JSON.stringify(state).includes(SAMPLE.answer));
  });

  it("a change goes through the Planner, not the preview's Builder", async () => {
    const b = createPlanBuild(unassigned, deps(), { bot: true });
    await b.run();
    const res = await b.revise("testbot:0", "Only urgent emails");
    assert.match(res.error, /Ask the Planner/);
  });

  it("an edited plan keeps the test of an unchanged bot, not of a changed one", async () => {
    const first = createPlanBuild(onDashboard, deps(), { bot: true });
    await first.run();
    const built = await first.approve("testbot:0", { sample: SAMPLE });
    assert.equal(built.status, "done");
    const same = await createPlanBuild(onDashboard, deps(), {
      bot: true,
      resume: { plan: onDashboard, state: built },
    }).run();
    assert.equal(same.status, "done");
    assert.equal(same.steps.find((s) => s.id === "testbot:0").reused, true);
    const changed = {
      ...onDashboard,
      pieces: [{ ...piece, instructions: "Only urgent ones." }],
    };
    const again = await createPlanBuild(changed, deps(), {
      bot: true,
      resume: { plan: onDashboard, state: built },
    }).run();
    assert.equal(again.status, "waiting-for-you");
    assert.equal(
      again.steps.find((s) => s.id === "testbot:0").status,
      "needs-you",
    );
  });
});

describe("bot builds — the bot as saved", () => {
  const sources = [{ name: "Work Gmail", type: "gmail", tools: ["search"] }];
  it("no dashboard: Unassigned (workspaceId null), with the user's connection", () => {
    const def = planBotDefinition(piece, { dashboardId: null, sources });
    assert.equal(def.workspaceId, null);
    assert.deepEqual(def.mcpServers, ["Work Gmail"]);
    assert.deepEqual(def.toolSelections, { "Work Gmail": ["search"] });
  });
  it("on a dashboard: that dashboard", () => {
    const def = planBotDefinition(piece, { dashboardId: "7", sources });
    assert.equal(def.workspaceId, "7");
  });
});

describe("botController — bot builds (Phase 2c-1)", () => {
  it("checks a bot plan as one bot and builds in bot mode", () => {
    assert.match(
      ctrl,
      /cell: !!cell,\s*standalone: !!\(cell && standalone\),\s*bot: !!bot,\s*(settings: !!settingsOf,\s*)?edit: editTarget[\s\S]{0,160}?\}\);/,
    );
    assert.match(
      ctrl,
      /autoFix: true,\s*cell: !!cell,\s*standalone: !!\(cell && standalone\),\s*bot: !!bot,\s*edit: editTarget,/,
    );
  });
  it("the check is the save's own check, before anything is saved", () => {
    assert.match(ctrl, /checkBot: \(req\) => this\._planCheckBot\(req\)/);
    assert.match(
      ctrl,
      /_planCheckBot\(\{ dashboardId, piece \}\) \{[\s\S]{0,700}checkBot\(definition, this\._botCheckContext\(null\)\)/,
    );
  });
  it("a bot with no dashboard joins no team", () => {
    assert.match(
      ctrl,
      /_planBotTeam\(dashboardId\) \{\s*if \(dashboardId == null\) return \[\];/,
    );
  });
});

describe("bot builds — a Claude connector runs on the Claude subscription", () => {
  const sources = [
    { name: "Work Gmail", type: "gmail", tools: ["search"] },
    {
      name: "Gmail",
      type: "claude-connector",
      connector: true,
      server: "claude.ai Gmail",
      tools: ["search_threads"],
    },
  ];
  it("a bot that uses a connector is set to run on the Claude subscription", () => {
    const def = planBotDefinition(
      { ...piece, tools: [{ provider: "Gmail", tools: ["search_threads"] }] },
      { dashboardId: "7", sources },
    );
    assert.deepEqual(def.mcpServers, ["Gmail"]);
    assert.equal(def.provider, "claude-code");
  });
  it("one that doesn't keeps Settings › AI's default", () => {
    const def = planBotDefinition(piece, {
      dashboardId: "7",
      sources: [sources[0]],
    });
    assert.deepEqual(def.mcpServers, ["Work Gmail"]);
    assert.ok(!def.provider);
  });
});

describe("bot builds — an edited plan from before bots were tested first", () => {
  it("a bot it already saved isn't asked to be tested again", async () => {
    // An older build: no test step, the bot saved.
    const old = {
      status: "done",
      dashboard: { id: "7", name: "Morning Brief" },
      bots: { 0: { id: "bot_1", name: "Morning Email Summary" } },
      results: { 0: { component: "dash.bots.BotResults", widgetId: "w1" } },
      steps: [
        { id: "dashboard", kind: "dashboard", status: "done" },
        { id: "checkbot:0", kind: "checkbot", status: "done" },
        {
          id: "bot:0",
          kind: "bot",
          status: "done",
          detail: "Morning Email Summary",
        },
        { id: "results:0", kind: "results", status: "done" },
      ],
    };
    const state = await createPlanBuild(onDashboard, deps(), {
      bot: true,
      resume: { plan: onDashboard, state: old },
    }).run();
    assert.equal(state.status, "done");
    const test = state.steps.find((s) => s.id === "testbot:0");
    assert.equal(test.status, "done");
    assert.equal(test.reused, true);
  });
});
