/**
 * rules.test.js — a rules check (frame 13): each ready-made rule passes or
 * fails on its own, with a reason; the check passes when every ticked rule
 * does.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { runRule, runRules, linksIn } = require("./rules");

const draft = {
  goal: { title: "Spring newsletter" },
  input: {
    text: "Spring sale hours and the garden party. See https://ok.example/a and https://broken.example/spring-sale.",
    subject: "Spring at the shop",
    links: ["https://ok.example/a", "https://broken.example/spring-sale"],
  },
  from: {
    notesReader: {
      notes: [
        { title: "Spring sale hours" },
        { title: "garden party" },
        { title: "Opening times" },
      ],
    },
    calendar: { events: [{ id: "e1" }, { id: "e2" }] },
  },
};

const fetchStatus = async (url) => (url.includes("broken") ? 404 : 200);

describe("runRule", () => {
  it("All links work: names the broken link and its status", async () => {
    const r = await runRule(
      { type: "linksWork", field: "input.links" },
      draft,
      { fetchStatus },
    );
    assert.equal(r.pass, false);
    assert.match(
      r.reason,
      /1 link is broken: broken\.example\/spring-sale \(404\)/,
    );
  });

  it("links are also found in text", () => {
    assert.equal(linksIn(draft.input.text).length, 2);
  });

  it("Length counts words", async () => {
    const r = await runRule(
      { type: "words", field: "input.text", min: 5, max: 900 },
      draft,
    );
    assert.equal(r.pass, true);
    const short = await runRule(
      { type: "words", field: "input.text", min: 400, max: 900 },
      draft,
    );
    assert.equal(short.pass, false);
    assert.match(short.reason, /needs 400–900/);
  });

  it("No banned words: whole words only", async () => {
    const r = await runRule(
      { type: "banned", field: "input.text", words: ["sale", "free"] },
      draft,
    );
    assert.equal(r.pass, false);
    assert.deepEqual(r.details, ["sale"]);
    const ok = await runRule(
      { type: "banned", field: "input.text", words: ["gard"] },
      draft,
    );
    assert.equal(ok.pass, true);
  });

  it("Every item is used: names the ones missing", async () => {
    const r = await runRule(
      {
        type: "everyIncluded",
        list: "from.notesReader.notes",
        key: "title",
        in: "input.text",
      },
      draft,
    );
    assert.equal(r.pass, false);
    assert.deepEqual(r.details, ["Opening times"]);
  });

  it("Every event is in the brief, by id (UC6)", async () => {
    const input = { ...draft, input: { eventIds: ["e1", "e2"] } };
    const r = await runRule(
      {
        type: "everyIncluded",
        list: "from.calendar.events",
        key: "id",
        in: "input.eventIds",
      },
      input,
    );
    assert.equal(r.pass, true);
    const missing = await runRule(
      {
        type: "everyIncluded",
        list: "from.calendar.events",
        key: "id",
        in: "input.eventIds",
      },
      { ...draft, input: { eventIds: ["e1"] } },
    );
    assert.equal(missing.pass, false);
    assert.deepEqual(missing.details, ["e2"]);
  });

  it("Short enough, Has a value, Matches", async () => {
    assert.equal(
      (
        await runRule(
          { type: "maxLength", field: "input.subject", max: 60 },
          draft,
        )
      ).pass,
      true,
    );
    assert.equal(
      (await runRule({ type: "required", field: "input.missing" }, draft)).pass,
      false,
    );
    assert.equal(
      (
        await runRule(
          { type: "equals", field: "goal.title", value: "Spring newsletter" },
          draft,
        )
      ).pass,
      true,
    );
  });

  it("Totals add up, to the cent (UC5)", async () => {
    const input = {
      input: {
        matched: [{ amount: 100.1 }, { amount: 0.2 }],
        unmatched: [5],
        bankTotal: 105.3,
      },
    };
    const r = await runRule(
      {
        type: "sumEquals",
        fields: ["input.matched", "input.unmatched"],
        total: "input.bankTotal",
      },
      input,
    );
    assert.equal(r.pass, true);
    const off = await runRule(
      {
        type: "sumEquals",
        fields: ["input.matched"],
        total: "input.bankTotal",
      },
      input,
    );
    assert.equal(off.pass, false);
    assert.match(off.reason, /Off by 5\.00/);
  });

  it("Nothing used twice", async () => {
    const r = await runRule(
      { type: "noDuplicates", field: "input.pairs", key: "payment" },
      { input: { pairs: [{ payment: "p1" }, { payment: "p1" }] } },
    );
    assert.equal(r.pass, false);
  });
});

describe("runRules", () => {
  it("passes only when every ticked rule passes, and says how many did", async () => {
    const r = await runRules(
      {
        rules: [
          { type: "linksWork", field: "input.links", on: true },
          { type: "required", field: "input.subject", on: true },
          { type: "banned", field: "input.text", words: ["sale"], on: false },
        ],
      },
      draft,
      { fetchStatus },
    );
    assert.equal(r.pass, false);
    assert.match(r.reason, /^1 of 2 passed\./);
    assert.equal(r.details.length, 2);
  });

  it("no ticked rules never passes", async () => {
    assert.equal((await runRules({ rules: [] }, draft)).pass, false);
  });
});
