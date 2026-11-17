/**
 * criteria.test.js — what done means (frames 29–30): each criterion gets a
 * way to be proven, vague ones are flagged with a measurable rewrite, and a
 * goal can't start while one has no way to be proven.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  vagueness,
  guessProof,
  proveCriteria,
  canStart,
} = require("./criteria");
const { proposalToFlow } = require("../flows/proposals");
const { starterProposal } = require("../flows/starterFlows");

const ticketFlow = proposalToFlow(starterProposal("ticket-to-pr"), {}, "ws1");

describe("vagueness", () => {
  it("flags what can't be checked as written, with a rewrite", () => {
    const v = vagueness("It should feel fast");
    assert.equal(v.vague, true);
    assert.match(v.rewrite, /under 200 ms/);
    assert.equal(
      vagueness("The switcher should be fast").rewrite,
      "Switcher opens in under 200 ms",
    );
    assert.equal(vagueness("Works like the old version").vague, true);
  });

  it("leaves measurable criteria alone", () => {
    assert.equal(vagueness("The switcher opens in under 200 ms").vague, false);
    assert.equal(
      vagueness("Each lead shows how many conversations it has").vague,
      false,
    );
    assert.equal(
      vagueness('Leads with none say "No conversations"').vague,
      false,
    );
  });
});

describe("guessProof", () => {
  it("a building flow proves with tests; looks with the Reviewer", () => {
    assert.equal(
      guessProof("Counts update right after a delete", ticketFlow),
      "test",
    );
    assert.equal(
      guessProof("Looks right in light and dark", ticketFlow),
      "reviewer",
    );
    assert.equal(guessProof("Works like the old version", ticketFlow), "none");
  });
});

describe("proveCriteria and canStart", () => {
  it("a ticket's criteria: one can't be checked, so the goal waits (frame 30)", () => {
    const r = proveCriteria(
      [
        "Each step shows the model that ran it",
        'Retired models are marked "Retired"',
        "Looks right in light and dark",
        "Works like the old version",
      ],
      ticketFlow,
    );
    assert.equal(r.waiting, true);
    assert.deepEqual(
      r.criteria.map((c) => c.proof),
      ["test", "test", "reviewer", "none"],
    );
    const s = canStart(r.criteria);
    assert.equal(s.ok, false);
    assert.deepEqual(s.blocking, ["c4"]);
  });

  it("leave it out, or I'll decide: it can start", () => {
    const r = proveCriteria(
      [
        { text: "Works like the old version", leftOut: true },
        { text: "It should feel fast", proof: "you" },
      ],
      ticketFlow,
    );
    assert.equal(r.waiting, false);
    assert.equal(canStart(r.criteria).ok, true);
  });
});
