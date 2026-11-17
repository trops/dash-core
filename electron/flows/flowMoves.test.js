/**
 * flowMoves.test.js — where a task goes as it travels its flow: on to the
 * next step when a step passes, back along a fail edge for the next round,
 * to the user once the rounds are used up, done past the last step, and
 * the user's own moves.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeFlow } = require("./flowModel");
const { startOf, afterStep, afterUserInFlow } = require("./flowMoves");

// Calendar + email → Brief writer → All events in it → You (UC6).
const brief = () =>
  normalizeFlow({
    workspaceId: "ws1",
    name: "Morning brief",
    maxRounds: 3,
    steps: [
      { id: "step_src", kind: "source", name: "Calendar + email", botId: "b1" },
      { id: "step_writer", kind: "bot", name: "Brief writer", botId: "b2" },
      {
        id: "step_check",
        kind: "check",
        name: "All events in it",
        check: { kind: "rules", rules: [] },
      },
      { id: "step_you", kind: "you", name: "You" },
    ],
    edges: [
      { from: "step_src", to: "step_writer", kind: "next" },
      { from: "step_writer", to: "step_check", kind: "next" },
      { from: "step_check", to: "step_you", kind: "next" },
      { from: "step_check", to: "step_writer", kind: "fail" },
    ],
  });

describe("startOf", () => {
  it("starts at the first step after the source, as new work", () => {
    assert.deepEqual(startOf(brief()), {
      stepId: "step_writer",
      status: "new",
    });
  });
});

describe("afterStep", () => {
  const at = (stepId, round = 1) => ({ stepId, round, maxRounds: 3 });

  it("passed: on to the check (built), then to you (ready)", () => {
    assert.deepEqual(afterStep(brief(), at("step_writer"), "passed"), {
      stepId: "step_check",
      status: "built",
    });
    assert.deepEqual(afterStep(brief(), at("step_check"), "passed"), {
      stepId: "step_you",
      status: "ready",
    });
  });

  it("a failed check sends the work back to the writer for the next round", () => {
    assert.deepEqual(afterStep(brief(), at("step_check", 1), "failed"), {
      stepId: "step_writer",
      status: "new",
      round: 2,
    });
  });

  it("at the round limit the task stops and waits for you", () => {
    const r = afterStep(brief(), at("step_check", 3), "failed");
    assert.equal(r.status, "needs-you");
    assert.equal(r.stopped, true);
    assert.equal(r.retryStepId, "step_writer");
  });

  it("a failed step with nowhere to go back to comes to you", () => {
    const r = afterStep(brief(), at("step_writer"), "failed");
    assert.equal(r.status, "needs-you");
    assert.equal(r.stopped, false);
  });

  it("passing the last step finishes the work", () => {
    const f = normalizeFlow({
      steps: [
        { id: "step_a", kind: "bot", name: "A" },
        {
          id: "step_b",
          kind: "check",
          name: "B",
          check: { kind: "rules", rules: [] },
        },
      ],
      edges: [{ from: "step_a", to: "step_b", kind: "next" }],
    });
    assert.deepEqual(afterStep(f, at("step_b"), "passed"), {
      stepId: null,
      status: "done",
    });
  });
});

describe("afterUserInFlow", () => {
  it("done at a you step moves it on (here: finished)", () => {
    const r = afterUserInFlow(
      brief(),
      { stepId: "step_you", status: "ready", round: 1 },
      "done",
    );
    assert.equal(r.status, "done");
  });

  it("done anywhere else is refused", () => {
    const r = afterUserInFlow(
      brief(),
      { stepId: "step_writer", status: "new", round: 1 },
      "done",
    );
    assert.match(r.error, /waiting for you/);
  });

  it("one more round goes back to the step that made the work", () => {
    const r = afterUserInFlow(
      brief(),
      {
        stepId: "step_check",
        status: "needs-you",
        round: 3,
        maxRounds: 3,
        retryStepId: "step_writer",
      },
      "one-more-round",
    );
    assert.deepEqual(r, {
      stepId: "step_writer",
      status: "new",
      round: 4,
      maxRounds: 4,
    });
  });
});
