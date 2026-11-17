/**
 * flowWarnings.test.js — how a flow could fool itself (frames 7 and 14).
 * The newsletter with Writer → Sender has three problems; a check between
 * them fixes two; asking you before the send fixes the last.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeFlow, insertBetween } = require("./flowModel");
const { flowWarnings, flowGood } = require("./flowWarnings");

const newsletter = () =>
  normalizeFlow({
    workspaceId: "ws1",
    steps: [
      { id: "step_notes", kind: "source", name: "Notes reader", botId: "b1" },
      { id: "step_writer", kind: "bot", name: "Writer", botId: "b2" },
      { id: "step_sender", kind: "bot", name: "Sender", botId: "b3" },
    ],
    edges: [
      { from: "step_notes", to: "step_writer", kind: "next" },
      { from: "step_writer", to: "step_sender", kind: "next" },
    ],
  });

const deps = { botExists: () => true, actsOutward: (id) => id === "b3" };
const ids = (list) => list.map((w) => w.id).sort();

describe("flowWarnings", () => {
  it("the newsletter has three problems", () => {
    const w = flowWarnings(newsletter(), deps);
    assert.deepEqual(ids(w), [
      "no-fields:step_writer",
      "unanchored:step_sender",
      "unchecked:step_sender",
      "unchecked:step_writer",
    ]);
    const writer = w.find((x) => x.id === "unchecked:step_writer");
    assert.equal(writer.title, "Nothing checks Writer's work");
    assert.deepEqual(writer.fix, {
      type: "add-check",
      label: "Add a check",
      from: "step_writer",
      to: "step_sender",
    });
    assert.equal(
      w.find((x) => x.id === "unanchored:step_sender").title,
      "Sender has nothing it can't argue with",
    );
  });

  it("a check between Writer and Sender fixes Writer's; the send still needs you", () => {
    let f = insertBetween(newsletter(), "step_writer", "step_sender", {
      kind: "check",
      name: "Draft check",
      check: {
        kind: "rules",
        rules: [{ type: "required", field: "input.text" }],
      },
    }).flow;
    f = {
      ...f,
      steps: f.steps.map((s) =>
        s.id === "step_writer"
          ? { ...s, outputs: [{ name: "text", kind: "text", required: true }] }
          : s,
      ),
    };
    const w = ids(flowWarnings(f, deps));
    assert.ok(!w.includes("unchecked:step_writer"));
    assert.ok(!w.includes("no-fields:step_writer"));
    assert.ok(w.includes("unanchored:step_sender"));
    assert.ok(
      flowGood(f, deps).some(
        (g) => g.text === "Writer's work is checked before it goes on",
      ),
    );

    // You approve before the Sender: nothing left about the send.
    const withYou = insertBetween(
      { ...f, steps: f.steps },
      f.edges.find((e) => e.to === "step_sender" && e.kind === "next").from,
      "step_sender",
      { kind: "you", name: "You approve" },
    ).flow;
    const left = ids(flowWarnings(withYou, deps));
    assert.ok(!left.includes("unanchored:step_sender"), left.join());
  });

  it("a judgment step needs a check before it", () => {
    const f = normalizeFlow({
      steps: [
        {
          id: "step_b",
          kind: "bot",
          name: "Builder",
          botId: "b1",
          outputs: [{ name: "pr", kind: "number" }],
        },
        {
          id: "step_r",
          kind: "bot",
          name: "Reviewer",
          botId: "b2",
          judgment: true,
        },
        { id: "step_y", kind: "you", name: "You" },
      ],
      edges: [
        { from: "step_b", to: "step_r", kind: "next" },
        { from: "step_r", to: "step_y", kind: "next" },
      ],
    });
    const w = flowWarnings(f, deps);
    assert.ok(w.some((x) => x.id === "judgment-alone:step_r"));
    // The Builder before a judgment step isn't checked by anything certain.
    assert.ok(w.some((x) => x.id === "unchecked:step_b"));
  });

  it("steps that can't run: no bot, not set up, off the chain", () => {
    const f = normalizeFlow({
      steps: [
        { id: "step_a", kind: "bot", name: "A", botId: "gone" },
        { id: "step_c", kind: "check", name: "C" },
        { id: "step_z", kind: "bot", name: "Z", botId: "b9" },
      ],
      edges: [{ from: "step_a", to: "step_c", kind: "next" }],
    });
    const w = ids(flowWarnings(f, { botExists: (id) => id !== "gone" }));
    assert.ok(w.includes("no-bot:step_a"));
    assert.ok(w.includes("no-check:step_c"));
    assert.ok(w.includes("orphan:step_z"));
  });
});
