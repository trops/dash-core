/**
 * userRun.test.js — a run the user starts: a message or Run now is "manual",
 * a reply continues; a Dash team role talked to directly only answers.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { userRunOptions } = require("./userRun");

const mine = { id: "b1", name: "Inbox Watch" };
const builder = { id: "dt_b", system: "dash-team", role: "builder" };

describe("userRunOptions", () => {
  it("a message starts fresh; a reply continues the conversation", () => {
    assert.deepEqual(userRunOptions(mine, { prompt: "hi" }), {
      prompt: "hi",
      trigger: "manual",
      continueSession: false,
    });
    assert.deepEqual(
      userRunOptions(mine, { prompt: "and?", continueConversation: true }),
      { prompt: "and?", trigger: "reply", continueSession: true },
    );
  });

  it("a Dash team role the user talks to gets no build or place tools", () => {
    assert.equal(
      userRunOptions(builder, { prompt: "build me a clock" }).adviseOnly,
      true,
    );
    assert.equal(userRunOptions(mine, { prompt: "x" }).adviseOnly, undefined);
  });

  it("keeps the plan's memory scope when given one", () => {
    assert.equal(
      userRunOptions(builder, { prompt: "x", planId: 42 }).planId,
      "42",
    );
    assert.equal(
      "planId" in userRunOptions(builder, { prompt: "x", planId: null }),
      false,
    );
  });
});
