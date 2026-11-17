/**
 * proposals.test.js — starters and the Lead's proposed flows (frames
 * 22–24): read from <flow>…</flow>, turned into a flow once its bots exist,
 * and what "Dash checked this flow" and "It will" say.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  readProposal,
  proposalToFlow,
  dashChecked,
  itWill,
} = require("./proposals");
const { STARTERS, starterProposal, listStarters } = require("./starterFlows");
const { chain, failTarget } = require("./flowModel");
const { flowWarnings } = require("./flowWarnings");

describe("starters", () => {
  it("lists Ticket to PR; Draft, check, send; Daily brief; Blank", () => {
    assert.deepEqual(
      listStarters().map((s) => s.name),
      ["Ticket to PR", "Draft, check, send", "Daily brief", "Blank"],
    );
  });

  for (const s of STARTERS.filter((x) => x.id !== "blank")) {
    it(`${s.name}: Dash checked every ✓`, () => {
      const checked = dashChecked(starterProposal(s.id));
      assert.deepEqual(
        checked.map((c) => c.ok),
        [true, true, true],
        JSON.stringify(checked),
      );
    });

    it(`${s.name}: becomes a flow with no setup warnings once its bots exist`, () => {
      const p = starterProposal(s.id);
      const made = Object.fromEntries(
        p.steps.filter((x) => x.bot).map((x) => [x.key, `bot_${x.key}`]),
      );
      const flow = proposalToFlow(p, made, "ws1");
      const actsKeys = p.steps
        .filter((x) => x.bot && x.bot.acts)
        .map((x) => `bot_${x.key}`);
      const w = flowWarnings(flow, {
        botExists: () => true,
        actsOutward: (id) => actsKeys.includes(id),
      });
      assert.deepEqual(
        w.map((x) => x.id),
        [],
      );
      assert.equal(chain(flow)[0].kind, "source");
    });
  }

  it("Ticket to PR: CI and the Reviewer send the work back to the Builder", () => {
    const flow = proposalToFlow(starterProposal("ticket-to-pr"), {}, "ws1");
    assert.equal(failTarget(flow, "step_ci").name, "Builder");
    assert.equal(failTarget(flow, "step_reviewer").name, "Builder");
    assert.deepEqual(
      chain(flow).map((s) => s.name),
      ["Ticket reader", "Builder", "GitHub CI", "Reviewer", "You"],
    );
  });
});

describe("readProposal", () => {
  it("reads the flow in the Lead's answer", () => {
    const text = `Here's a flow. <flow>{"name":"Inbox triage","steps":[
      {"key":"r","kind":"source","name":"Inbox reader","bot":{"name":"Inbox reader","instructions":"Read","schedules":[{"cron":"*/30 * * * *"}]}},
      {"key":"s","kind":"bot","name":"Sorter","botId":"bot_x"},
      {"key":"y","kind":"you","name":"You"}]}</flow>`;
    const p = readProposal(text);
    assert.equal(p.name, "Inbox triage");
    // No edges given: one after another.
    assert.deepEqual(
      p.edges.map((e) => `${e.from}>${e.to}`),
      ["r>s", "s>y"],
    );
    assert.equal(p.steps[1].botId, "bot_x");
    assert.equal(p.steps[0].bot.schedules[0].cron, "*/30 * * * *");
  });

  it("nothing readable → null", () => {
    assert.equal(readProposal("no flow here"), null);
    assert.equal(readProposal("<flow>{not json}</flow>"), null);
    assert.equal(
      readProposal('<flow>{"steps":[{"kind":"robot"}]}</flow>'),
      null,
    );
  });
});

describe("dashChecked and itWill", () => {
  it("a flow that sends without you or a check fails two checks", () => {
    const p = readProposal(`<flow>{"name":"x","steps":[
      {"key":"w","kind":"bot","name":"Writer","bot":{"name":"Writer","instructions":"w"}},
      {"key":"s","kind":"bot","name":"Sender","bot":{"name":"Sender","instructions":"s","acts":true}}]}</flow>`);
    const c = dashChecked(p);
    assert.equal(c[0].ok, false);
    assert.equal(c[2].ok, false);
    assert.equal(c[2].text, "Nothing waits for you");
  });

  it("says which providers are connected and which bots it makes", () => {
    const w = itWill(starterProposal("daily-brief"), {
      providers: [{ name: "Google Calendar", type: "google-calendar" }],
    });
    assert.deepEqual(w.makeBots, ["Calendar + email", "Brief writer"]);
    assert.deepEqual(
      w.uses.map((u) => [u.label, u.connected]),
      [
        ["Your calendar", true],
        ["Your email", false],
      ],
    );
    assert.equal(w.folder, false);
  });
});
