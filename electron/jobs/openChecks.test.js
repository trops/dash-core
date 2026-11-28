"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { openCheckGoals } = require("./openChecks");

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
