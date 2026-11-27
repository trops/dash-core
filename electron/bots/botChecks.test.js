/**
 * botChecks.test.js — a bot's own checks as saved and as the job's flow
 * (bot-checks PRD, DASH-9): cleaning, validation, the flow made from them
 * (fail arrows, you step), a job's title and source, what's handed on,
 * what the bot is told when its work comes back, and what the lead hears.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanBotChecks,
  checksError,
  checksFlow,
  isChecksFlow,
  jobTitle,
  jobSource,
  handedOn,
  passedWork,
  retryPrompt,
  WORK_STEP,
} = require("./botChecks");
const { validateBotDefinition, withDefaults } = require("./botSchema");
const { checkedAnswer, jobMarker } = require("./teamTools");
const { inputStep } = require("../flows/flowModel");

const RULES = {
  kind: "rules",
  rules: [{ type: "required", field: "input.answer" }],
};

describe("a bot's checks as saved", () => {
  it("is null with no steps: the work goes straight on", () => {
    assert.equal(cleanBotChecks(null), null);
    assert.equal(cleanBotChecks({ steps: [] }), null);
    assert.equal(cleanBotChecks({ steps: [{ kind: "nope" }] }), null);
    assert.equal(withDefaults({}).checks, null);
  });

  it("keeps the steps in order with defaults for the rest", () => {
    const c = cleanBotChecks({
      steps: [
        { kind: "check", name: "Filled in", check: RULES },
        { kind: "reviewer", botId: "bot_r" },
        { kind: "you" },
      ],
    });
    assert.deepEqual(
      c.steps.map((s) => [s.kind, s.name]),
      [
        ["check", "Filled in"],
        ["reviewer", "Reviewer"],
        ["you", "You approve"],
      ],
    );
    assert.equal(c.onFail, "retry");
    assert.equal(c.maxTries, 3);
    assert.equal(c.handsOn, "answer");
    assert.equal(
      cleanBotChecks({ steps: [{ kind: "you" }], maxTries: 50 }).maxTries,
      10,
    );
  });

  it("drops a check with no known settings, and never reuses the work step's id", () => {
    const c = cleanBotChecks({
      steps: [
        { kind: "check", check: { kind: "unknown" } },
        { kind: "you", id: WORK_STEP },
      ],
    });
    assert.equal(c.steps.length, 1);
    assert.notEqual(c.steps[0].id, WORK_STEP);
  });

  it("is validated with the bot", () => {
    const bot = (checks) =>
      validateBotDefinition(
        withDefaults({ name: "B", instructions: "Do it", checks }),
      );
    assert.equal(bot(null).valid, true);
    assert.equal(bot({ steps: [{ kind: "check", check: RULES }] }).valid, true);
    assert.match(bot([]).errors.join(), /checks must be an object/);
    assert.match(
      bot({ steps: [{ kind: "check" }] }).errors.join(),
      /a check needs settings/,
    );
    assert.match(bot({ steps: [], onFail: "later" }).errors.join(), /onFail/);
    assert.equal(
      checksError({ steps: [{ kind: "you" }], handsOn: "summary" }),
      null,
    );
  });
});

describe("the flow a job follows", () => {
  const bot = {
    id: "bot_w",
    name: "Writer",
    workspaceId: "ws1",
    checks: {
      steps: [
        { kind: "check", name: "Filled in", check: RULES },
        { kind: "reviewer", name: "Reads clearly", botId: "bot_r" },
        { kind: "you" },
      ],
    },
  };

  it("is the bot's work, then each check, with fail arrows back to it", () => {
    const flow = checksFlow(bot);
    assert.ok(isChecksFlow(flow));
    assert.equal(flow.botId, "bot_w");
    assert.deepEqual(
      flow.steps.map((s) => s.kind),
      ["bot", "check", "bot", "you"],
    );
    assert.equal(flow.steps[0].id, WORK_STEP);
    assert.equal(flow.steps[2].judgment, true);
    assert.equal(flow.steps[3].sendBackTo, WORK_STEP);
    const fails = flow.edges.filter((e) => e.kind === "fail");
    assert.deepEqual(
      fails.map((e) => [e.from, e.to]),
      [
        [flow.steps[1].id, WORK_STEP],
        [flow.steps[2].id, WORK_STEP],
      ],
    );
  });

  it("has no fail arrows when a fail comes to you or stops it", () => {
    for (const onFail of ["you", "stop"]) {
      const flow = checksFlow({ ...bot, checks: { ...bot.checks, onFail } });
      assert.equal(flow.edges.filter((e) => e.kind === "fail").length, 0);
      assert.equal(flow.onFail, onFail);
    }
  });

  it("gives a check after the reviewer the work, not the verdict", () => {
    const flow = checksFlow({
      ...bot,
      checks: {
        steps: [
          { kind: "reviewer", botId: "bot_r" },
          { kind: "check", check: RULES },
        ],
      },
    });
    assert.equal(inputStep(flow, flow.steps[2].id).id, WORK_STEP);
  });

  it("is null for a bot with no checks", () => {
    assert.equal(checksFlow({ id: "bot_x", name: "X" }), null);
  });

  it("never has a reviewer with no bot, or the bot reviewing itself", () => {
    assert.match(
      checksError({ steps: [{ kind: "reviewer" }] }),
      /needs the bot that reviews/,
    );
    assert.match(
      checksError({ steps: [{ kind: "reviewer", botId: "bot_w" }] }, "bot_w"),
      /can't review its own work/,
    );
    const flow = checksFlow({
      ...bot,
      checks: {
        steps: [
          { kind: "reviewer", botId: "bot_w" },
          { kind: "reviewer" },
          { kind: "you" },
        ],
      },
    });
    assert.deepEqual(
      flow.steps.map((s) => s.kind),
      ["bot", "you"],
    );
  });

  it("leaves a flow's own reviewer as the input after it", () => {
    const { normalizeFlow } = require("../flows/flowModel");
    const flow = normalizeFlow({
      steps: [
        { id: "step_b", kind: "bot", name: "Builder" },
        { id: "step_r", kind: "bot", name: "Reviewer", judgment: true },
        { id: "step_c", kind: "check", name: "Lint", check: RULES },
      ],
      edges: [
        { from: "step_b", to: "step_r", kind: "next" },
        { from: "step_r", to: "step_c", kind: "next" },
      ],
    });
    assert.equal(inputStep(flow, "step_c").id, "step_r");
  });
});

describe("a job", () => {
  it("is titled by the bot and what it was asked", () => {
    assert.equal(
      jobTitle(
        { name: "Coordinator" },
        { prompt: "\n  Put together tomorrow's brief\nmore" },
      ),
      "Coordinator: Put together tomorrow's brief",
    );
    assert.equal(
      jobTitle({ name: "Coordinator" }, { trigger: "schedule" }),
      "Coordinator: its scheduled run",
    );
    assert.ok(
      jobTitle({ name: "B" }, { prompt: "x".repeat(400) }).length <= 120,
    );
  });

  it("says where it came from", () => {
    assert.deepEqual(jobSource({ via: "lead:bot_l", trigger: "ask" }), {
      kind: "lead",
      ref: "bot_l",
    });
    assert.deepEqual(jobSource({ trigger: "catch-up" }), { kind: "schedule" });
    assert.deepEqual(jobSource({ trigger: "event" }), { kind: "event" });
  });

  it("hands on the whole answer, or its first paragraph", () => {
    const text = "Summary line.\n\nThe rest of it.";
    assert.equal(handedOn({ handsOn: "answer" }, text), text);
    assert.equal(handedOn({ handsOn: "summary" }, text), "Summary line.");
  });

  it("tells the bot what it was asked, its last answer and what failed", () => {
    const task = {
      round: 2,
      maxRounds: 3,
      history: [
        { stepId: WORK_STEP, status: "passed", output: { answer: "Draft 1" } },
      ],
    };
    assert.equal(passedWork(task), "Draft 1");
    const p = retryPrompt({
      goal: { body: "Write the brief" },
      task,
      input: {
        fix: { step: "Filled in", reason: "answer is empty", details: null },
      },
    });
    assert.match(p, /try 2 of 3/);
    assert.match(p, /What you were asked:\nWrite the brief/);
    assert.match(p, /Your last answer:\nDraft 1/);
    assert.match(p, /"Filled in" failed: answer is empty/);
    const byYou = retryPrompt({
      goal: {},
      task,
      input: { fix: { step: "You", reason: "Shorter", byYou: true } },
    });
    assert.match(byYou, /The user sent it back: Shorter/);
  });
});

describe("what the lead hears", () => {
  it("ends with which job it was (the conversation shows its checks)", () => {
    assert.equal(jobMarker("goal_x1"), '\n<job id="goal_x1"/>');
    assert.equal(jobMarker('g"><x'), '\n<job id="gx"/>');
    assert.equal(jobMarker(null), "");
  });
  const job = { goalId: "goal_x", title: "Writer: the brief" };
  it("gets the answer once it passed", () => {
    const t = checkedAnswer("Writer", {
      ...job,
      state: "passed",
      round: 2,
      output: "Brief",
    });
    assert.match(
      t,
      /^Writer's answer \(it passed its checks on try 2\):\nBrief$/,
    );
  });
  it("hears where the work is otherwise", () => {
    assert.match(
      checkedAnswer("Writer", { ...job, state: "waiting" }),
      /waiting for the user to approve it \(the job "Writer: the brief" in Jobs\)/,
    );
    assert.match(
      checkedAnswer("Writer", {
        ...job,
        state: "needs-you",
        reason: "Too long",
      }),
      /didn't pass its checks.*Last check that failed: Too long/,
    );
    assert.match(
      checkedAnswer("Writer", { ...job, state: "stopped" }),
      /nothing was handed on/,
    );
    assert.match(
      checkedAnswer("Writer", { ...job, state: "checking" }),
      /still going through its checks/,
    );
  });
});

describe("a paused bot finishes a job already started (DASH-12)", () => {
  const { flowBotHooks, finishesJob } = require("../flows/flowBotHooks");
  const fakeCtl = () => {
    const calls = [];
    return {
      calls,
      _run: (botId, opts) => {
        calls.push(["run", botId, opts.via]);
        return Promise.resolve({ status: "completed" });
      },
      _asJobRun: (botId, start) => {
        calls.push(["asJob", botId]);
        return start();
      },
    };
  };

  it("knows a checks job's runs by their flow", () => {
    assert.equal(finishesJob({ via: "flow:checks_bot_w" }), true);
    assert.equal(finishesJob({ via: "flow:flow_123" }), false);
    assert.equal(finishesJob({}), false);
  });

  it("runs a checks job's step as part of work already started", async () => {
    const ctl = fakeCtl();
    await flowBotHooks(ctl).runBot("bot_w", {
      prompt: "Fix it",
      via: "flow:checks_bot_w",
    });
    assert.deepEqual(ctl.calls, [
      ["asJob", "bot_w"],
      ["run", "bot_w", "flow:checks_bot_w"],
    ]);
  });

  it("any other run starts as it always did", async () => {
    const ctl = fakeCtl();
    await flowBotHooks(ctl).runBot("bot_w", { via: "flow:flow_123" });
    assert.deepEqual(ctl.calls, [["run", "bot_w", "flow:flow_123"]]);
  });
});

// DASH-140: a self-test's checks are told so, since what it skipped (a
// comment, a push) isn't there to check.
describe("a self-test's checks know it (DASH-140)", () => {
  const { flowBotHooks } = require("../flows/flowBotHooks");
  const ctl = (test) => ({
    _jobs: {
      jobForGoal: () => "job_1",
      contextOf: () => ({ item: { id: "DASH-97" }, workspace: null }),
      isTest: () => test,
    },
  });

  it("a test job's context says test: true", () => {
    assert.deepEqual(flowBotHooks(ctl(true)).jobContext("g"), {
      item: { id: "DASH-97" },
      workspace: null,
      test: true,
    });
  });

  it("a real job's context is as before", () => {
    assert.deepEqual(flowBotHooks(ctl(false)).jobContext("g"), {
      item: { id: "DASH-97" },
      workspace: null,
    });
  });
});
