/**
 * flowModel.test.js — a flow's shape: steps and edges cleaned, the chain
 * from the source, a step added on an arrow (a check gets a fail edge back
 * to the work it checks), and a step removed.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeFlow,
  chain,
  nextStep,
  failTarget,
  firstWorkStep,
  inputStep,
  insertBetween,
  removeStep,
  briefLine,
} = require("./flowModel");

const newsletter = () =>
  normalizeFlow({
    workspaceId: "ws1",
    name: "Weekly newsletter",
    steps: [
      { id: "step_notes", kind: "source", name: "Notes reader", botId: "b1" },
      { id: "step_writer", kind: "bot", name: "Writer", botId: "b2" },
      { id: "step_sender", kind: "bot", name: "Sender", botId: "b3" },
    ],
    edges: [
      { from: "step_notes", to: "step_writer", kind: "next", label: "notes" },
      { from: "step_writer", to: "step_sender", kind: "next" },
    ],
  });

describe("normalizeFlow", () => {
  it("keeps only known step kinds, unique ids, and edges between real steps", () => {
    const f = normalizeFlow({
      workspaceId: 7,
      steps: [
        { id: "step_a", kind: "bot", name: "A" },
        {
          id: "step_a",
          kind: "check",
          name: "B",
          check: { kind: "rules", rules: [] },
        },
        { kind: "robot", name: "C" },
      ],
      edges: [
        { from: "step_a", to: "step_a1" },
        { from: "step_a", to: "step_zzz" },
        { from: "step_a", to: "step_a1" },
      ],
    });
    assert.equal(f.workspaceId, "7");
    assert.deepEqual(
      f.steps.map((s) => s.id),
      ["step_a", "step_a1"],
    );
    assert.equal(f.edges.length, 1);
    assert.equal(f.maxRounds, 3);
  });

  it("drops a check with an unknown kind, and cleans declared fields", () => {
    const f = normalizeFlow({
      steps: [
        { kind: "check", name: "C", check: { kind: "magic" } },
        {
          kind: "bot",
          name: "W",
          outputs: [
            { name: "text", kind: "text" },
            { name: "bad name", kind: "text" },
            { name: "links", kind: "links", required: false },
          ],
        },
      ],
    });
    assert.equal(f.steps[0].check, null);
    assert.deepEqual(f.steps[1].outputs, [
      { name: "text", kind: "text", required: true },
      { name: "links", kind: "links", required: false },
    ]);
  });
});

describe("chain and neighbours", () => {
  it("runs from the source along next edges", () => {
    const f = newsletter();
    assert.deepEqual(
      chain(f).map((s) => s.name),
      ["Notes reader", "Writer", "Sender"],
    );
    assert.equal(nextStep(f, "step_writer").name, "Sender");
    assert.equal(firstWorkStep(f).name, "Writer");
    assert.equal(nextStep(f, "step_sender"), null);
  });
});

describe("insertBetween (the + on an arrow)", () => {
  it("puts a check between Writer and Sender, with a fail edge back to Writer", () => {
    const r = insertBetween(newsletter(), "step_writer", "step_sender", {
      kind: "check",
      name: "Draft check",
      check: { kind: "rules", rules: [] },
    });
    assert.ok(!r.error);
    const f = r.flow;
    assert.deepEqual(
      chain(f).map((s) => s.name),
      ["Notes reader", "Writer", "Draft check", "Sender"],
    );
    assert.equal(failTarget(f, r.stepId).name, "Writer");
    // A check reads the work of the step before it.
    assert.equal(inputStep(f, r.stepId).name, "Writer");
    // The Sender reads the Writer's work: checks pass it through.
    assert.equal(inputStep(f, "step_sender").name, "Writer");
  });

  it("a you step needs no fail edge", () => {
    const r = insertBetween(newsletter(), "step_writer", "step_sender", {
      kind: "you",
      name: "You approve",
    });
    assert.equal(failTarget(r.flow, r.stepId), null);
    assert.equal(r.flow.steps.find((s) => s.id === r.stepId).action, "Approve");
  });
});

describe("removeStep", () => {
  it("joins the steps either side", () => {
    const f = removeStep(newsletter(), "step_writer");
    assert.deepEqual(
      chain(f).map((s) => s.name),
      ["Notes reader", "Sender"],
    );
  });
});

describe("briefLine", () => {
  it("says how many steps and where it's from", () => {
    assert.equal(
      briefLine({ ...newsletter(), brief: "weekly" }),
      "3 steps · weekly",
    );
  });
});

describe("a check that's off (DASH-125)", () => {
  it("keeps what the check would run on its You step", () => {
    const flow = normalizeFlow({
      steps: [
        { id: "step_work", kind: "bot", name: "Coder", botId: "c" },
        {
          id: "c1",
          kind: "you",
          name: "Tests pass (off)",
          offCommand: "npm test",
        },
        { id: "c2", kind: "you", name: "You approve" },
      ],
    });
    assert.equal(flow.steps[1].offCommand, "npm test");
    assert.equal(flow.steps[2].offCommand, undefined);
  });
});
