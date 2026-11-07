/**
 * aiDefaults.test.js — Settings › AI: backend, default model and style per
 * job, run limits, the per-bot monthly default and the one-time move of
 * bots that saved Claude Code (CLI) only because it was the default.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  JOBS,
  LIMIT_DEFAULTS,
  jobOf,
  readAi,
  mergeAiSettings,
  backendProvider,
  defaultModelFor,
  styleFor,
  runLimitsFor,
  defaultMonthlyLimitFor,
  runsAgainWithinHour,
  planFollowDefault,
} = require("./aiDefaults");

const team = (role) => ({ id: `b_${role}`, system: "dash-team", role });
const lead = { id: "lead_1", role: "lead", workspaceId: "1" };
const bot = { id: "bot_1", name: "Agenda" };

describe("jobOf", () => {
  it("names each kind of bot's job", () => {
    assert.equal(jobOf(bot), "bots");
    assert.equal(jobOf(lead), "leads");
    assert.equal(jobOf(team("planner")), "planner");
    assert.equal(jobOf(team("builder")), "builder");
    assert.equal(jobOf(team("checker")), "checker");
    assert.equal(jobOf(team("scout")), "scout");
    assert.equal(jobOf(team("dashlead")), "dashLead");
  });
});

describe("readAi", () => {
  it("with nothing saved: the subscription, no defaults, the built-in limits", () => {
    const ai = readAi({});
    assert.equal(ai.backend, "subscription");
    assert.deepEqual(Object.keys(ai.defaults), JOBS);
    for (const job of JOBS) {
      assert.deepEqual(ai.defaults[job], { model: null, style: null });
    }
    assert.deepEqual(ai.limits, LIMIT_DEFAULTS);
    assert.equal(ai.migrated, false);
  });

  it("drops unknown backends and styles", () => {
    const ai = readAi({
      ai: { backend: "magic", defaults: { bots: { style: "loud" } } },
    });
    assert.equal(ai.backend, "subscription");
    assert.equal(ai.defaults.bots.style, null);
  });

  it("a cleared limit is no limit, not the default", () => {
    const ai = readAi({ ai: { limits: { steps: null, minutes: 5 } } });
    assert.equal(ai.limits.steps, null);
    assert.equal(ai.limits.minutes, 5);
    assert.equal(ai.limits.createSteps, LIMIT_DEFAULTS.createSteps);
  });
});

describe("mergeAiSettings", () => {
  it("merges a patch, keeping what it doesn't mention", () => {
    let ai = mergeAiSettings(null, {
      backend: "api",
      defaults: { bots: { model: "claude-haiku-5-5", style: "brief" } },
    });
    ai = mergeAiSettings(ai, {
      defaults: { planner: { model: "claude-sonnet-5-5" } },
      limits: { perBot: 10 },
    });
    assert.equal(ai.backend, "api");
    assert.deepEqual(ai.defaults.bots, {
      model: "claude-haiku-5-5",
      style: "brief",
    });
    assert.deepEqual(ai.defaults.planner, { model: "claude-sonnet-5-5" });
    assert.equal(ai.limits.perBot, 10);
  });

  it("clears with null and drops what it doesn't know", () => {
    let ai = mergeAiSettings(null, {
      defaults: { bots: { model: "claude-haiku-5-5", style: "brief" } },
    });
    ai = mergeAiSettings(ai, {
      backend: "nope",
      defaults: { bots: { style: null }, wizards: { model: "x" } },
      limits: { steps: 0, bogus: 3, costPerRun: -1 },
    });
    assert.equal(ai.backend, undefined);
    assert.deepEqual(ai.defaults.bots, { model: "claude-haiku-5-5" });
    assert.equal(ai.defaults.wizards, undefined);
    assert.equal(ai.limits.steps, null);
    assert.equal(ai.limits.costPerRun, null);
    assert.equal("bogus" in ai.limits, false);
  });
});

describe("backend, model and style", () => {
  const ai = readAi({
    ai: {
      backend: "api",
      defaults: {
        bots: { model: "claude-haiku-5-5", style: "brief" },
        planner: { model: "claude-sonnet-5-5", style: "thorough" },
      },
    },
  });

  it("a bot without a provider runs on the chosen backend", () => {
    assert.equal(backendProvider(ai), "anthropic");
    assert.equal(backendProvider(readAi({})), "claude-code");
  });

  it("each job gets its default model, or none (the old fallback)", () => {
    assert.equal(defaultModelFor(bot, ai), "claude-haiku-5-5");
    assert.equal(defaultModelFor(team("planner"), ai), "claude-sonnet-5-5");
    assert.equal(defaultModelFor(lead, ai), null);
  });

  it("style: the bot's own, else its job's default, else none", () => {
    assert.deepEqual(styleFor(bot, ai), {
      style: "brief",
      effort: "low",
      line: "Keep your final answer to a line or two.",
    });
    assert.equal(styleFor({ ...bot, style: "normal" }, ai).effort, "medium");
    assert.equal(styleFor(team("planner"), ai).effort, "high");
    assert.equal(styleFor(lead, ai), null);
  });
});

describe("runLimitsFor", () => {
  const ai = readAi({});

  it("bots get the step limit; Create's roles the higher one", () => {
    assert.equal(runLimitsFor(bot, ai).maxTurns, 25);
    assert.equal(runLimitsFor(team("builder"), ai).maxTurns, 80);
    // The Dash Lead only answers: the bots limit.
    assert.equal(runLimitsFor(team("dashlead"), ai).maxTurns, 25);
    assert.equal(runLimitsFor(bot, ai).minutes, 20);
  });

  it("the cost cap only applies when the run is paid (an API key)", () => {
    assert.equal(runLimitsFor(bot, ai).costPerRun, null);
    assert.equal(runLimitsFor(bot, ai, { paid: true }).costPerRun, 1);
  });

  it("a bot's own limits win, and its own null means none", () => {
    const own = {
      ...bot,
      runLimits: { steps: 60, minutes: null, costPerRun: 3 },
    };
    const l = runLimitsFor(own, ai, { paid: true });
    assert.equal(l.maxTurns, 60);
    assert.equal(l.minutes, null);
    assert.equal(l.costPerRun, 3);
    // The older bot.maxTurns field still counts.
    assert.equal(runLimitsFor({ ...bot, maxTurns: 7 }, ai).maxTurns, 7);
  });
});

describe("defaultMonthlyLimitFor", () => {
  const ai = readAi({ ai: { limits: { perBot: 10 } } });

  it("bots without their own limit get the default; leads and the team don't", () => {
    assert.equal(defaultMonthlyLimitFor(bot, ai), 10);
    assert.equal(defaultMonthlyLimitFor(lead, ai), null);
    assert.equal(defaultMonthlyLimitFor(team("planner"), ai), null);
    assert.equal(defaultMonthlyLimitFor(bot, readAi({})), null);
    assert.equal(defaultMonthlyLimitFor(null, ai), null);
  });
});

describe("runsAgainWithinHour", () => {
  it("Create, leads and bots scheduled at least hourly", () => {
    assert.equal(runsAgainWithinHour(team("builder")), true);
    assert.equal(runsAgainWithinHour(lead), true);
    assert.equal(
      runsAgainWithinHour({ ...bot, schedules: [{ cron: "*/15 * * * *" }] }),
      true,
    );
    assert.equal(
      runsAgainWithinHour({ ...bot, schedules: [{ cron: "0 * * * *" }] }),
      true,
    );
    assert.equal(
      runsAgainWithinHour({ ...bot, schedules: [{ cron: "30 7 * * 0" }] }),
      false,
    );
    assert.equal(runsAgainWithinHour(bot), false);
  });
});

describe("planFollowDefault", () => {
  it("moves bots that saved Claude Code with no model or engine of their own", () => {
    const ids = planFollowDefault([
      { id: "a", provider: "claude-code", model: null, engine: null },
      { id: "b", provider: "claude-code", model: "claude-opus-5-5" },
      { id: "c", provider: "claude-code", engine: "claude-agent" },
      { id: "d", provider: "anthropic" },
      { id: "e", provider: null },
    ]);
    assert.deepEqual(ids, ["a"]);
  });
});
