/**
 * stepWhen.test.js — a check step that runs only when a team setting says so
 * (DASH-85). `when: "{approvePlans}"` is filled in with the team's settings
 * when the bot runs; the step is left out of that job when it reads no. So a
 * factory's plan approval ("you" step) is on or off from Team settings, with
 * no change to the bot.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanBotChecks,
  checksError,
  checksFlow,
  stepOff,
} = require("./botChecks");
const { mergeTeamValues, withTeamValues } = require("./teamValues");

const PLAN_OK = {
  kind: "check",
  name: "The plan has its sections",
  check: { kind: "rules", rules: [] },
};
const APPROVE = {
  kind: "you",
  name: "John approves the plan",
  when: "{approvePlans}",
};
const planner = (steps) => ({
  id: "bot_planner",
  name: "Planner",
  workspaceId: "ws1",
  checks: { steps, onFail: "you" },
});
const stepNames = (flow) => flow.steps.map((s) => s.name);

describe("a check's when (DASH-85)", () => {
  it("is kept when saved, and must be text", () => {
    const c = cleanBotChecks({ steps: [APPROVE] });
    assert.equal(c.steps[0].when, "{approvePlans}");
    assert.equal(cleanBotChecks({ steps: [PLAN_OK] }).steps[0].when, undefined);
    assert.match(
      checksError({ steps: [{ ...APPROVE, when: true }] }),
      /when must be text/,
    );
    assert.equal(checksError({ steps: [APPROVE] }), null);
  });

  it("reads no: no, false, off, 0 or empty; anything else (or unfilled) is on", () => {
    for (const w of ["no", "No", "false", "off", "0", " "]) {
      assert.equal(stepOff({ when: w }), true, w);
    }
    for (const w of ["yes", "true", "{approvePlans}", "on"]) {
      assert.equal(stepOff({ when: w }), false, w);
    }
    assert.equal(stepOff({}), false, "no when: always on");
  });

  it("a step whose when reads no is left out of the job", () => {
    const on = checksFlow(planner([PLAN_OK, { ...APPROVE, when: "yes" }]));
    assert.deepEqual(stepNames(on), [
      "Planner",
      "The plan has its sections",
      "John approves the plan",
    ]);
    const off = checksFlow(planner([PLAN_OK, { ...APPROVE, when: "no" }]));
    assert.deepEqual(stepNames(off), ["Planner", "The plan has its sections"]);
    // Every check left out: the work goes straight on.
    assert.equal(checksFlow(planner([{ ...APPROVE, when: "no" }])), null);
  });

  it("is filled from the team's settings, so Team settings turn it on and off", () => {
    const declare = [
      { name: "approvePlans", label: "Approve plans first", type: "boolean" },
    ];
    const bot = planner([PLAN_OK, APPROVE]);
    const flowWith = (value) => {
      const team = mergeTeamValues(null, {
        declare,
        values: { approvePlans: value },
      });
      const filled = withTeamValues(bot, team, { home: "/home/x" }).bot;
      return stepNames(checksFlow(filled));
    };
    assert.ok(flowWith(true).includes("John approves the plan"));
    assert.ok(!flowWith(false).includes("John approves the plan"));
  });
});
