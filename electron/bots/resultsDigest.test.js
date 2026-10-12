/**
 * resultsDigest — what the Planner reads about the user's bots (CRE-011 AC6).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  itemText,
  describeResults,
  filterRuns,
  describeRuns,
  MAX_RUNS,
  TOTAL_CHARS,
  localTime,
} = require("./resultsDigest");

describe("describeResults", () => {
  it("says when nothing was sent", () => {
    assert.match(describeResults([]), /No bot has sent results yet/);
  });

  it("newest first, items clipped to ten, unknown times named", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}` }));
    const text = describeResults([
      { botName: "Old", name: "a", items: [], sentAt: "2026-10-01T08:00:00Z" },
      {
        botName: "New",
        name: "b",
        label: "B",
        items,
        sentAt: "2026-10-12T08:00:00Z",
      },
      { botName: "When", name: "c", items: [] },
    ]);
    assert.ok(text.indexOf("New · B") < text.indexOf("Old · a"));
    assert.match(text, /…and 2 more/);
    assert.match(text, /sent at an unknown time/);
    assert.match(text, /Only the latest result for each name is kept/);
  });

  it("caps the whole text", () => {
    const big = Array.from({ length: 200 }, (_, i) => ({
      botName: `Bot ${i}`,
      name: "r",
      items: [{ title: "x".repeat(250) }],
      sentAt: "2026-10-12T08:00:00Z",
    }));
    const text = describeResults(big);
    assert.ok(text.length < TOTAL_CHARS + 200);
    assert.match(text, /More results left out/);
  });
});

describe("itemText", () => {
  it("title first, then plain fields; nested objects skipped", () => {
    assert.equal(
      itemText({ subject: "Hi", from: "Alex", meta: { a: 1 } }),
      "Hi — from: Alex",
    );
    assert.equal(itemText("plain"), "plain");
    assert.equal(itemText({ count: 3 }), "count: 3");
  });
});

describe("filterRuns / describeRuns", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const runs = [
    {
      botName: "A",
      run: {
        endedAt: "2026-10-12T10:00:00Z",
        status: "done",
        output: "line1\nline2",
      },
    },
    {
      botName: "B",
      run: { endedAt: "2026-10-10T10:00:00Z", status: "error", error: "boom" },
    },
    { botName: "C", run: { status: "done" } },
  ];

  it("by hours drops old and timeless runs; by bot matches any case", () => {
    assert.deepEqual(
      filterRuns(runs, { sinceHours: 24, now }).map((r) => r.botName),
      ["A"],
    );
    assert.deepEqual(
      filterRuns(runs, { bot: "b" }).map((r) => r.botName),
      ["B"],
    );
    assert.equal(filterRuns(runs).length, 3);
  });

  it("at most MAX_RUNS", () => {
    const many = Array.from({ length: 40 }, () => runs[0]);
    assert.equal(filterRuns(many).length, MAX_RUNS);
  });

  it("answers indented, errors named, no matches said", () => {
    const text = describeRuns(runs.slice(0, 2));
    const when = localTime("2026-10-12T10:00:00Z");
    assert.ok(text.includes(`- A · ${when} · done\n    line1\n    line2`));
    assert.match(text, /Error: boom/);
    assert.match(describeRuns([]), /No bot runs match\.$/);
  });
});

describe("times are the user's local time (5e)", () => {
  it("never the raw UTC string; the digest says what now is", () => {
    const iso = "2026-10-12T23:06:00Z";
    const now = new Date("2026-10-12T23:10:00Z");
    const local = localTime(iso, now);
    assert.equal(
      local,
      new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    const text = describeResults(
      [{ botName: "A", name: "r", items: [], sentAt: iso }],
      now,
    );
    assert.ok(text.includes(`sent ${local}`));
    assert.doesNotMatch(text, /2026-10-12T23:06/);
    assert.match(
      text,
      /^Now: .*\(the user's local time; all times below are local\)\./,
    );
    assert.equal(localTime("nope"), null);
  });
});
