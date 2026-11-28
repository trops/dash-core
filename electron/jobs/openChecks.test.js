"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { openCheckGoals, endedJobGoals } = require("./openChecks");

describe("openCheckGoals", () => {
  it("closes checks being run and checks waiting on the user", () => {
    const steps = [
      { botId: "t", status: "done", goalId: "g0" },
      { botId: "a", status: "needs-you", goalId: "g1" },
      { botId: "b", status: "checking", goalId: "g2" },
      { botId: "c", status: "running" },
      { botId: "d", status: "failed", goalId: "g3" },
      { botId: "e", status: "needs-you" },
      { botId: "f", status: "checking", goalId: "g2" },
    ];
    assert.deepEqual(openCheckGoals(steps), ["g1", "g2"]);
  });

  it("is empty for no steps", () => {
    assert.deepEqual(openCheckGoals(undefined), []);
  });
});

describe("endedJobGoals", () => {
  it("every check job of an ended job, earlier tries too", () => {
    const job = {
      status: "stopped",
      tries: [{ steps: [{ goalId: "g1" }, { status: "done" }] }],
      steps: [{ goalId: "g2" }, { goalId: "g1" }],
    };
    assert.deepEqual(endedJobGoals(job), ["g1", "g2"]);
  });

  it("nothing for a job that's still going", () => {
    for (const status of ["running", "checking", "needs-you", "queued"]) {
      assert.deepEqual(
        endedJobGoals({ status, steps: [{ goalId: "g" }] }),
        [],
        status,
      );
    }
  });
});
