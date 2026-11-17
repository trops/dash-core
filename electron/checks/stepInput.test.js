/**
 * stepInput.test.js — the standard input every step gets ({goal, input,
 * from, files, fix}), a step's declared fields checked on its record, and
 * fields suggested from its last records (flows PRD, phase 3).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeFlow } = require("../flows/flowModel");
const {
  stepKey,
  buildInput,
  checkOutput,
  outputProblem,
  suggestFields,
  describeInput,
  kindOf,
} = require("./stepInput");

const flow = normalizeFlow({
  steps: [
    { id: "step_notes", kind: "source", name: "Notes reader" },
    { id: "step_writer", kind: "bot", name: "Writer" },
    {
      id: "step_check",
      kind: "check",
      name: "Draft check",
      check: { kind: "rules", rules: [] },
    },
    { id: "step_sender", kind: "bot", name: "Sender" },
  ],
  edges: [
    { from: "step_notes", to: "step_writer", kind: "next" },
    { from: "step_writer", to: "step_check", kind: "next" },
    { from: "step_check", to: "step_sender", kind: "next" },
    { from: "step_check", to: "step_writer", kind: "fail" },
  ],
});

const task = {
  id: "task_1",
  round: 2,
  maxRounds: 3,
  history: [
    {
      stepId: "step_notes",
      status: "passed",
      output: { notes: [{ title: "Spring" }] },
    },
    {
      stepId: "step_writer",
      status: "passed",
      output: { text: "Hi", links: [] },
    },
    {
      stepId: "step_check",
      status: "failed",
      summary: "1 link is broken",
      details: ["x.com"],
    },
  ],
};

describe("buildInput", () => {
  it("gives a check the Writer's record as input, and earlier records by step", () => {
    const input = buildInput({
      goal: { id: "goal_1", title: "Spring newsletter" },
      task,
      flow,
      stepId: "step_check",
      files: ["draft.md"],
    });
    assert.deepEqual(input.input, { text: "Hi", links: [] });
    assert.deepEqual(input.from, {
      notesReader: { notes: [{ title: "Spring" }] },
      writer: { text: "Hi", links: [] },
    });
    assert.equal(input.goal.round, 2);
    assert.deepEqual(input.files, ["draft.md"]);
  });

  it("work sent back carries why: the fix", () => {
    const input = buildInput({
      goal: { id: "g" },
      task,
      flow,
      stepId: "step_writer",
    });
    assert.deepEqual(input.fix, {
      step: "Draft check",
      reason: "1 link is broken",
      details: ["x.com"],
    });
    // The writer reads the notes reader's record.
    assert.deepEqual(input.input, { notes: [{ title: "Spring" }] });
  });

  it("the Sender after a check reads the Writer's work (checks pass it through)", () => {
    const input = buildInput({
      goal: { id: "g" },
      task,
      flow,
      stepId: "step_sender",
    });
    assert.deepEqual(input.input, { text: "Hi", links: [] });
  });
});

describe("checkOutput", () => {
  const fields = [
    { name: "text", kind: "text", required: true },
    { name: "subject", kind: "text", required: true },
    { name: "links", kind: "links", required: true },
    { name: "wordCount", kind: "number", required: false },
  ];

  it("passes a record that fills every required field with the right kinds", () => {
    const r = checkOutput(fields, {
      text: "Hi",
      subject: "Spring",
      links: ["https://a.com"],
    });
    assert.equal(r.ok, true);
  });

  it("names what's missing and what has the wrong kind", () => {
    const r = checkOutput(fields, {
      text: "Hi",
      links: "https://a.com",
      wordCount: "712",
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["subject"]);
    assert.deepEqual(r.wrong, [
      { name: "links", want: "links", got: "text" },
      { name: "wordCount", want: "number", got: "text" },
    ]);
    assert.match(
      outputProblem("Writer", r),
      /missing subject; links should be links, not text/,
    );
  });
});

describe("suggestFields", () => {
  it("every field from the last records, required when every record filled it", () => {
    const fields = suggestFields([
      { text: "a", subject: "s", links: ["https://x.com"], wordCount: 700 },
      { text: "b", subject: "t", links: ["https://y.com"] },
    ]);
    assert.deepEqual(fields, [
      { name: "text", kind: "text", required: true },
      { name: "subject", kind: "text", required: true },
      { name: "links", kind: "links", required: true },
      { name: "wordCount", kind: "number", required: false },
    ]);
  });
});

describe("describeInput and kinds", () => {
  it("lists each field with its kind and a sample", () => {
    const rows = describeInput({
      goal: { title: "Spring", round: 1 },
      input: { links: ["https://a.com", "https://b.com"], wordCount: 712 },
      from: { notes: [{ title: "x" }] },
      files: ["draft.md"],
    });
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
    assert.equal(byPath["goal.title"].kind, "text");
    assert.equal(byPath["input.links"].kind, "links");
    assert.equal(byPath["input.links"].sample, "2 items");
    assert.equal(byPath["input.wordCount"].kind, "number");
    assert.equal(byPath.files.kind, "paths");
  });

  it("step keys are camelCase names", () => {
    assert.equal(stepKey({ name: "Calendar + email" }), "calendarEmail");
    assert.equal(stepKey({ name: "Notes reader" }), "notesReader");
    assert.equal(kindOf(null), "empty");
  });
});
