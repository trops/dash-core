/**
 * botNotices.test.js — which bot events become OS notifications (bot-factory
 * US-019 AC3: 80% and over-budget; US-018 AC5: failed runs).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { failureNotice, budgetNotice } = require("./botNotices");

const bot = { id: "b1", name: "Writer", workspaceId: "7" };
const scope = (key, state, budget = 5) => ({
  scope: key,
  spent: 0,
  budget,
  pct: 0,
  state,
});
const status = (...scopes) => ({ scopes, overall: "ok" });

describe("failureNotice", () => {
  it("a failed run notifies with the error's first line", () => {
    assert.deepEqual(
      failureNotice(bot, {
        status: "failed",
        error: "API key rejected\nstack…",
      }),
      {
        kind: "failed",
        botId: "b1",
        title: "Bot failed",
        body: "Writer: API key rejected",
      },
    );
  });

  it("an API error's JSON reads as its message, like the chat shows it", () => {
    const error =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}';
    assert.equal(
      failureNotice(bot, { status: "failed", error }).body,
      "Writer: Your credit balance is too low",
    );
  });

  it("caps a long error", () => {
    const n = failureNotice(bot, { status: "failed", error: "x".repeat(300) });
    assert.ok(n.body.length <= "Writer: ".length + 120);
    assert.ok(n.body.endsWith("…"));
  });

  it("says so when there's no error text", () => {
    assert.equal(
      failureNotice(bot, { status: "failed" }).body,
      "Writer: the run failed.",
    );
  });

  it("stopped, interrupted, skipped and completed runs don't notify", () => {
    for (const r of [
      { status: "stopped" },
      { status: "interrupted" },
      { status: "completed" },
      { skipped: true, reason: "paused" },
      null,
    ]) {
      assert.equal(failureNotice(bot, r), null);
    }
  });

  it("the Dash team doesn't notify (Create shows its failures)", () => {
    assert.equal(
      failureNotice({ ...bot, system: "dash-team" }, { status: "failed" }),
      null,
    );
  });
});

describe("budgetNotice", () => {
  it("crossing 80% of the bot's own limit", () => {
    assert.deepEqual(
      budgetNotice({
        bot,
        before: status(scope("bot:b1", "ok")),
        after: status(scope("bot:b1", "warn")),
      }),
      {
        kind: "budget-warn",
        botId: "b1",
        title: "Bot budget at 80%",
        body: "Writer has used 80% of its $5.00 monthly budget.",
      },
    );
  });

  it("going over says it's paused and how to keep it running", () => {
    assert.deepEqual(
      budgetNotice({
        bot,
        before: status(scope("bot:b1", "warn")),
        after: status(scope("bot:b1", "exceeded")),
      }),
      {
        kind: "budget-exceeded",
        botId: "b1",
        title: "Bot paused for budget",
        body: "Writer is over its $5.00 monthly budget. Open it to keep it running.",
      },
    );
  });

  it("straight from under 80% to over: one notice, the over one", () => {
    const n = budgetNotice({
      bot,
      before: status(scope("bot:b1", "ok")),
      after: status(scope("bot:b1", "exceeded")),
    });
    assert.equal(n.kind, "budget-exceeded");
  });

  it("names a dashboard's or the overall limit", () => {
    assert.equal(
      budgetNotice({
        bot,
        before: status(),
        after: status(scope("workspace:7", "warn", 20)),
        dashboardNameOf: (id) => (id === "7" ? "Sales" : null),
      }).body,
      "Writer has used 80% of the Sales dashboard's $20.00 monthly budget.",
    );
    assert.equal(
      budgetNotice({
        bot,
        before: status(),
        after: status(scope("global", "exceeded", 50)),
      }).body,
      "Writer is over the overall $50.00 monthly budget. Open it to keep it running.",
    );
  });

  it("only a change notifies — staying at 80% or over doesn't", () => {
    assert.equal(
      budgetNotice({
        bot,
        before: status(scope("bot:b1", "warn")),
        after: status(scope("bot:b1", "warn")),
      }),
      null,
    );
    assert.equal(
      budgetNotice({
        bot,
        before: status(scope("bot:b1", "exceeded")),
        after: status(scope("bot:b1", "exceeded")),
      }),
      null,
    );
  });

  it("several limits crossing at once: one notice, for the most serious", () => {
    const n = budgetNotice({
      bot,
      before: status(scope("bot:b1", "ok"), scope("global", "ok", 50)),
      after: status(scope("bot:b1", "warn"), scope("global", "exceeded", 50)),
    });
    assert.equal(n.kind, "budget-exceeded");
    assert.match(n.body, /overall/);
  });

  it("the Dash team doesn't notify", () => {
    assert.equal(
      budgetNotice({
        bot: { ...bot, system: "dash-team" },
        before: status(scope("bot:b1", "ok")),
        after: status(scope("bot:b1", "warn")),
      }),
      null,
    );
  });
});
