/**
 * Where the goals ledger plugs in (goals-ledger PRD): the goal id riding the
 * event chain, and static checks on the controllers that can't run outside
 * Electron.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  rootCause,
  causeFromEvent,
  sourceFromEvent,
  buildBotEventMessage,
} = require("../bots/botEvents");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const bots = read("controller/botController.js");
const runner = read("bots/BotRunner.js");

describe("the goal id rides the event chain", () => {
  const bot = { id: "builder", name: "Builder", workspaceId: 7 };

  it("a run's events carry the goal it works on", () => {
    const cause = {
      ...rootCause(),
      goal: { goalId: "goal_a1", taskId: "task_b2" },
    };
    const msg = buildBotEventMessage(bot, "completed", { ok: true }, cause);
    assert.equal(msg.goalId, "goal_a1");
    assert.equal(msg.taskId, "task_b2");
    assert.equal(msg.content.goalId, "goal_a1");
  });

  it("the next bot's run inherits it", () => {
    const msg = buildBotEventMessage(
      bot,
      "completed",
      {},
      {
        ...rootCause(),
        goal: { goalId: "goal_a1", taskId: null },
      },
    );
    const next = causeFromEvent(msg);
    assert.deepEqual(next.goal, { goalId: "goal_a1", taskId: null });
    assert.equal(sourceFromEvent({ subscriptions: [] }, msg).goalId, "goal_a1");
  });

  it("events with no goal stay as they were", () => {
    const msg = buildBotEventMessage(bot, "completed", {}, rootCause());
    assert.equal("goalId" in msg, false);
    assert.equal("goal" in causeFromEvent(msg), false);
  });
});

describe("botController", () => {
  it("gives a bot on a dashboard the goal tools, allowed without a prompt", () => {
    assert.match(
      bots,
      /if \(bot\.workspaceId != null && bot\.workspaceId !== ""\) \{\s*for \(const tool of GOAL_TOOLS\)/,
    );
    assert.match(
      bots,
      /ROLE_SERVER,\s*\/\/ The dashboard's own goals ledger[^\n]*\n\s*GOALS_SERVER,/,
    );
    // A lead is refused the tools that claim or finish tasks.
    assert.match(
      bots,
      /if \(serverName === GOALS_SERVER\) \{\s*if \(\s*isLead\(this\._store\.get\(opts\.botId\)\) &&\s*!LEAD_GOAL_TOOLS\.some\(\(t\) => t\.name === toolName\)\s*\) \{[\s\S]{0,250}\}\s*return handleGoalTool\(/,
    );
  });

  it("a run carries one goal holder from its cause to the runner", () => {
    // A bot asked by its lead starts on its own copy of the lead's goal.
    assert.match(
      bots,
      /const cause =\s*opts\.cause \|\|\s*\(opts\.goal && opts\.goal\.goalId\s*\? \{\s*\.\.\.rootCause\(\),\s*goal: \{\s*goalId: opts\.goal\.goalId,\s*taskId: opts\.goal\.taskId \|\| null,\s*\},\s*\}\s*: rootCause\(\)\);/,
    );
    // Flows: the runner hands its bots work, and create_goal finds the flow.
    assert.match(bots, /flowController\.useBots\(flowBotHooks\(this\)\);/);
    assert.match(bots, /flows: flowController\.toolContext\(\),/);
    assert.match(bots, /flowController\.forgetWorkspace\(workspaceId\);/);
    assert.match(
      bots,
      /cause\.goal = goal;\s*if \(!alreadyRunning\) this\._events\.startRun\(botId, cause\);/,
    );
    assert.match(bots, /planId: String\(opts\.planId\) \} : \{\}\),\s*goal,/);
  });

  it("lets go of a run's tasks when it ends (only a run that started)", () => {
    assert.match(
      bots,
      /if \(viaEntry\) \{\s*goalController\.release\(botId\);\s*if \(this\._runGoals\.get\(botId\) === goal\) this\._runGoals\.delete\(botId\);/,
    );
    // …and when the bot is deleted.
    assert.match(
      bots,
      /delete\(botId\) \{[\s\S]{0,900}goalController\.release\(botId\);/,
    );
  });

  it("a run still going forgets a goal deleted under it", () => {
    assert.match(
      bots,
      /this\._runGoals\.set\(botId, goal\);[\s\S]{0,40}const p = this\._runner\.run/,
    );
    assert.match(
      bots,
      /forget: \(goalId\) => \{\s*for \(const g of \(this\._runGoals \|\| new Map\(\)\)\.values\(\)\) \{\s*if \(g && g\.goalId === goalId\) \{\s*g\.goalId = null;/,
    );
  });

  it("a deleted dashboard's goals go with it", () => {
    assert.match(
      bots,
      /onWorkspaceDeleted\(\(workspaceId\) => \{[\s\S]{0,120}goalController\.forgetWorkspace\(workspaceId\);/,
    );
  });

  it("deleting a conversation can delete its goals, never half way", () => {
    assert.match(bots, /removeCreateRecent\(id, opts = \{\}\)/);
    assert.match(
      bots,
      /if \(opts && opts\.deleteGoals\) \{[\s\S]{0,400}isBusy[\s\S]{0,200}goalController\.delete\(ids\);/,
    );
  });

  it("finds and removes a goal's runs through the bot store", () => {
    assert.match(
      bots,
      /runsFor: \(goalId\) => this\._store\.runsForGoal\(goalId\)/,
    );
    assert.match(
      bots,
      /removeRuns: \(goalId\) => this\._store\.removeRunsForGoal\(goalId\)/,
    );
  });
});

describe("BotRunner", () => {
  it("records the goal and task on the run, and hands the holder to tools", () => {
    assert.match(runner, /runRecord\.goalId = opts\.goal\.goalId;/);
    assert.match(
      runner,
      /\.\.\.\(opts\.goal \? \{ goal: opts\.goal \} : \{\}\),/,
    );
  });
});
