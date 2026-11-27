/**
 * rerunStep.test.js — what a step's bot is told when its job runs again
 * from that step (DASH-122).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { rerunPrompt, handedFrom } = require("./rerunStep");

const job = {
  title: "Format dates in the footer",
  leadId: "lead",
  request: "Format dates in the footer\nUse the user's time zone.",
  item: { id: "SANDBOX-52", title: "Format dates", url: "https://x/52" },
  workspace: { dir: "~/f/SANDBOX-52", branch: "fix/dates" },
  steps: [
    {
      id: "s1",
      botId: "lead",
      botName: "Lead",
      status: "done",
      summary: "Asked Planner.",
    },
    {
      id: "s2",
      botId: "plan",
      botName: "Planner",
      status: "done",
      summary: "Plan: change formatDate.",
      handoff: { status: "ok", summary: "plan" },
    },
    {
      id: "s3",
      botId: "coder",
      botName: "Coder",
      status: "failed",
      summary: "Changed formatDate.",
      failed: 'Didn\'t pass "validate" on try 2: 2 tests fail',
    },
  ],
};

describe("rerunPrompt", () => {
  it("a hand-on step: the job, its item and workspace, what it was handed, why it failed, the note", () => {
    const text = rerunPrompt({
      job,
      step: job.steps[2],
      note: " Mind the null date. ",
    });
    assert.match(
      text,
      /running your step of this job again: Format dates in the footer/,
    );
    assert.match(
      text,
      /Work item: SANDBOX-52 · Format dates \(https:\/\/x\/52\)/,
    );
    assert.match(text, /Workspace: ~\/f\/SANDBOX-52 on fix\/dates/);
    assert.match(
      text,
      /Planner handed you this work:\nPlan: change formatDate\./,
    );
    assert.match(text, /```json\n\{\n {2}"status": "ok"/);
    assert.match(text, /Your last try failed: Didn't pass "validate"/);
    assert.match(text, /A note from the user: Mind the null date\.$/);
  });

  it("the lead's step: what it was asked", () => {
    const step = {
      id: "s1",
      botId: "lead",
      status: "failed",
      summary: "It failed.",
    };
    const text = rerunPrompt({ job: { ...job, steps: [step] }, step });
    assert.match(
      text,
      /^Format dates in the footer\nUse the user's time zone\./,
    );
    assert.match(text, /Your last try failed: It failed\./);
    assert.doesNotMatch(text, /A note/);
  });

  it("the step it was handed from is the last done one of another bot", () => {
    assert.equal(handedFrom(job, job.steps[2]).id, "s2");
    assert.equal(handedFrom(job, job.steps[0]), null);
    assert.equal(rerunPrompt({}), "");
  });
});
