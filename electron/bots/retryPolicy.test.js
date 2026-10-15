/**
 * retryPolicy.test.js — which failures are retried and how long to wait
 * (bot-factory US-023 AC1/AC2).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_ATTEMPTS,
  classifyError,
  retryDelay,
  errorDetails,
} = require("./retryPolicy");

describe("classifyError — temporary trouble is retried", () => {
  const cases = [
    [{ status: 529, message: "Overloaded" }, "Overloaded"],
    [{ message: 'API Error: 529 {"type":"overloaded_error"}' }, "Overloaded"],
    [{ status: 429, message: "slow down" }, "Rate limited"],
    [{ message: "Rate limit reached for requests" }, "Rate limited"],
    [{ message: "Request timed out." }, "Timed out"],
    [{ message: "read ECONNRESET" }, "Connection dropped"],
    [{ message: "fetch failed" }, "Connection dropped"],
    [{ message: "socket hang up" }, "Connection dropped"],
    [{ status: 500, message: "boom" }, "Server error"],
    [{ status: 503 }, "Server error"],
    [{ message: "API Error: 500 Internal server error" }, "Server error"],
  ];
  for (const [err, label] of cases) {
    it(`${JSON.stringify(err)} → ${label}`, () => {
      assert.deepEqual(classifyError(err), { transient: true, label });
    });
  }
});

describe("classifyError — problems another try can't fix fail at once", () => {
  const cases = [
    { status: 401, message: "invalid x-api-key" },
    { status: 400, message: "messages: field required" },
    { status: 403, message: "forbidden" },
    { message: 'API Error: 401 {"type":"authentication_error"}' },
    { message: "Your credit balance is too low to access the Anthropic API." },
    { message: "You exceeded your current quota (insufficient_quota)" },
    { message: "No AI model chosen" },
    { code: "CLAUDE_CLI_NOT_FOUND", message: "Claude Code CLI not found." },
    { code: "MODEL_NO_IMAGES", message: "This model can't read images." },
    { message: "Something odd happened" },
    {},
    null,
  ];
  for (const err of cases) {
    it(JSON.stringify(err), () => {
      assert.equal(classifyError(err).transient, false);
    });
  }

  it("a quota error isn't mistaken for a rate limit", () => {
    assert.equal(
      classifyError({ message: "429 You exceeded your current quota" })
        .transient,
      false,
    );
  });
});

describe("retryDelay", () => {
  it("grows: about 2s, then about 8s (±25%)", () => {
    assert.equal(
      retryDelay(1, null, () => 0.5),
      2000,
    );
    assert.equal(
      retryDelay(2, null, () => 0.5),
      8000,
    );
    assert.equal(
      retryDelay(1, null, () => 0),
      1500,
    );
    assert.equal(
      retryDelay(1, null, () => 1),
      2500,
    );
  });

  it("is capped", () => {
    assert.equal(
      retryDelay(5, null, () => 1),
      30000,
    );
  });

  it("honors the provider's retry-after (capped at a minute)", () => {
    assert.equal(
      retryDelay(1, 12000, () => 0.5),
      12000,
    );
    assert.equal(
      retryDelay(1, 600000, () => 0.5),
      60000,
    );
  });

  it("three attempts in all", () => {
    assert.equal(MAX_ATTEMPTS, 3);
  });
});

describe("errorDetails — status and retry-after from an SDK error", () => {
  it("reads a Headers-like object", () => {
    const err = {
      status: 429,
      headers: { get: (k) => (k === "retry-after" ? "7" : null) },
    };
    assert.deepEqual(errorDetails(err), { status: 429, retryAfterMs: 7000 });
  });

  it("reads a plain headers record", () => {
    assert.deepEqual(
      errorDetails({ status: 529, headers: { "retry-after": "2" } }),
      { status: 529, retryAfterMs: 2000 },
    );
  });

  it("nothing for a plain error", () => {
    assert.deepEqual(errorDetails(new Error("x")), {});
    assert.deepEqual(errorDetails(null), {});
  });
});
