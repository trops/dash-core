/**
 * resultTools.test.js — bots send structured results (team-dashboards TD-001).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  SEND_RESULT,
  MAX_RESULT_ITEMS,
  MAX_RESULT_BYTES,
  resultToolsFor,
  checkResult,
  sendResult,
  latestResult,
} = require("./resultTools");

const bot = {
  id: "bot_a",
  publishes: [
    {
      name: "importantEmails",
      label: "Important emails",
      description: "Emails that need a reply today",
    },
    { name: "digest" },
  ],
};

describe("resultToolsFor", () => {
  it("gives no tool to a bot without declared results", () => {
    assert.deepEqual(resultToolsFor({ id: "bot_b", publishes: [] }), []);
    assert.deepEqual(resultToolsFor({ id: "bot_b" }), []);
  });

  it("gives send_result limited to the declared names", () => {
    const [tool] = resultToolsFor(bot);
    assert.equal(tool.name, SEND_RESULT);
    assert.deepEqual(tool.inputSchema.properties.name.enum, [
      "importantEmails",
      "digest",
    ]);
    assert.deepEqual(tool.inputSchema.required, ["name", "items"]);
    assert.match(
      tool.description,
      /importantEmails — Emails that need a reply today; digest/,
    );
  });
});

describe("checkResult", () => {
  it("accepts a declared result and fills its label", () => {
    const r = checkResult(bot, {
      name: "importantEmails",
      items: [{ title: "Contract", link: "https://x.test" }],
      summary: "1 email",
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result, {
      name: "importantEmails",
      label: "Important emails",
      items: [{ title: "Contract", link: "https://x.test" }],
      summary: "1 email",
    });
  });

  it("labels an unlabelled result by its name and allows an empty list", () => {
    const r = checkResult(bot, { name: "digest", items: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.label, "digest");
    assert.equal(r.result.summary, null);
  });

  it("refuses an undeclared name", () => {
    const r = checkResult(bot, { name: "other", items: [] });
    assert.equal(r.ok, false);
    assert.match(
      r.message,
      /isn't one of your results \(importantEmails, digest\)/,
    );
  });

  it("refuses when the bot declares nothing", () => {
    const r = checkResult({ id: "bot_b" }, { name: "x", items: [] });
    assert.equal(r.ok, false);
    assert.match(r.message, /doesn't declare any results/);
  });

  it("refuses items that aren't a list of objects", () => {
    assert.equal(checkResult(bot, { name: "digest", items: "x" }).ok, false);
    assert.equal(checkResult(bot, { name: "digest", items: [1] }).ok, false);
    assert.equal(checkResult(bot, { name: "digest", items: [[]] }).ok, false);
    assert.equal(checkResult(bot, { name: "digest", items: [null] }).ok, false);
  });

  it("refuses a non-text summary", () => {
    const r = checkResult(bot, { name: "digest", items: [], summary: 3 });
    assert.equal(r.ok, false);
  });

  it("refuses too many items", () => {
    const items = Array.from({ length: MAX_RESULT_ITEMS + 1 }, () => ({}));
    const r = checkResult(bot, { name: "digest", items });
    assert.equal(r.ok, false);
    assert.match(r.message, /Too many items/);
  });

  it("refuses a result over the size limit", () => {
    const items = [{ title: "x".repeat(MAX_RESULT_BYTES) }];
    const r = checkResult(bot, { name: "digest", items });
    assert.equal(r.ok, false);
    assert.match(r.message, /too large/);
  });

  it("keeps plain data only", () => {
    const r = checkResult(bot, {
      name: "digest",
      items: [{ title: "a", when: new Date(0), skip: undefined }],
    });
    assert.deepEqual(r.result.items, [
      { title: "a", when: "1970-01-01T00:00:00.000Z" },
    ]);
  });
});

describe("sendResult / latestResult", () => {
  const stored = { ...bot, ref: "local/triage", name: "Triage" };
  function deps() {
    const saved = {};
    const sent = [];
    const store = {
      get: (id) => (id === stored.id ? stored : null),
      setResult: (id, name, payload) => (saved[`${id}/${name}`] = payload),
      getResult: (id, name) => saved[`${id}/${name}`] || null,
    };
    const publisher = { sendResult: (b, payload) => sent.push({ b, payload }) };
    return { store, publisher, now: () => "2026-10-10T12:00:00.000Z", sent };
  }
  const type = "bot:local/triage[bot_a].result.importantEmails";

  it("saves the result, publishes it and reports what was sent", () => {
    const d = deps();
    const r = sendResult(d, "bot_a", {
      name: "importantEmails",
      items: [{ title: "a" }, { title: "b" }],
    });
    assert.deepEqual(r, {
      text: 'Sent "Important emails" (2 items).',
      isError: false,
    });
    assert.equal(d.sent.length, 1);
    assert.equal(d.sent[0].payload.sentAt, "2026-10-10T12:00:00.000Z");
    assert.equal(d.sent[0].payload.botName, "Triage");
    assert.deepEqual(latestResult(d.store, type), d.sent[0].payload);
  });

  it("neither saves nor publishes a refused result", () => {
    const d = deps();
    const r = sendResult(d, "bot_a", { name: "nope", items: [] });
    assert.equal(r.isError, true);
    assert.equal(d.sent.length, 0);
    assert.equal(latestResult(d.store, type), null);
  });

  it("refuses an unknown bot", () => {
    const d = deps();
    assert.equal(
      sendResult(d, "bot_x", { name: "digest", items: [] }).isError,
      true,
    );
  });

  it("reports a save failure without publishing", () => {
    const d = deps();
    d.store.setResult = () => {
      throw new Error("disk full");
    };
    const r = sendResult(d, "bot_a", { name: "digest", items: [] });
    assert.equal(r.isError, true);
    assert.match(r.text, /disk full/);
    assert.equal(d.sent.length, 0);
  });

  it("looks up nothing for other events, gone bots or undeclared names", () => {
    const d = deps();
    sendResult(d, "bot_a", { name: "digest", items: [] });
    assert.equal(
      latestResult(d.store, "bot:local/triage[bot_a].completed"),
      null,
    );
    assert.equal(
      latestResult(d.store, "bot:local/x[bot_x].result.digest"),
      null,
    );
    stored.publishes = [{ name: "importantEmails" }];
    try {
      assert.equal(
        latestResult(d.store, "bot:local/triage[bot_a].result.digest"),
        null,
      );
    } finally {
      stored.publishes = bot.publishes;
    }
  });
});
