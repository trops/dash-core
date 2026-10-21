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
    saveBot: async (req) => {
      calls.push(["saveBot", req.dashboardId, req.piece.name]);
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
  it("on a dashboard: use it → check → save → results card", () => {
    assert.deepEqual(ids(onDashboard), [
      "dashboard",
      "checkbot:0",
      "bot:0",
      "results:0",
    ]);
  });
  it("no dashboard: check → save, no dashboard step, no results card", () => {
    assert.deepEqual(ids(unassigned), ["checkbot:0", "bot:0"]);
  });
  it("says it's saved paused", () => {
    const save = planSteps(onDashboard, { bot: true }).find(
      (s) => s.id === "bot:0",
    );
    assert.equal(save.label, "Save Morning Email Summary — paused");
  });
  it("a bot with no dashboard never gets a results card", () => {
    assert.deepEqual(
      ids({ ...unassigned, pieces: [{ ...piece, showResults: true }] }),
      ["checkbot:0", "bot:0"],
    );
  });
});

describe("bot builds — running", () => {
  it("on a dashboard: checked, saved there, results placed; no AI", async () => {
    const d = deps();
    const state = await createPlanBuild(onDashboard, d, { bot: true }).run();
    assert.equal(state.status, "done");
    assert.deepEqual(
      d.calls.map((c) => c[0]),
      ["useDashboard", "checkBot", "saveBot", "results"],
    );
    assert.deepEqual(d.calls[2], ["saveBot", "7", "Morning Email Summary"]);
    assert.deepEqual(state.bots[0], {
      id: "bot_1",
      name: "Morning Email Summary",
    });
    const check = state.steps.find((s) => s.id === "checkbot:0");
    assert.equal(check.detail, "gmail connected · schedule is valid");
  });

  it("no dashboard: saved Unassigned (dashboardId null)", async () => {
    const d = deps();
    const state = await createPlanBuild(unassigned, d, { bot: true }).run();
    assert.equal(state.status, "done");
    assert.deepEqual(
      d.calls.map((c) => c.slice(0, 2)),
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
    assert.equal(state.steps.find((s) => s.id === "bot:0").status, "skipped");
    assert.ok(!d.calls.some((c) => c[0] === "saveBot"));
    fail = false;
    const after = await b.retry("checkbot:0");
    assert.equal(after.status, "done");
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
      /cell: !!cell,\s*bot: !!bot,\s*edit: editTarget[\s\S]{0,160}?\}\);/,
    );
    assert.match(
      ctrl,
      /autoFix: true,\s*cell: !!cell,\s*bot: !!bot,\s*edit: editTarget,/,
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
