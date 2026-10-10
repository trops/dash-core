/**
 * approvalErrorReason.test.js
 *
 * Pins the deny text the mcp / fs / network gates return when a
 * permission prompt gets no answer.
 *
 * Run: `node --test electron/mcp/approvalErrorReason.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { approvalErrorReason, formatWait } = require("./approvalErrorReason");

function timeout(ms) {
  const err = new Error("permission request timed out");
  err.code = "JIT_TIMEOUT";
  err.timeoutMs = ms;
  return err;
}

test("a timeout reads as an expired request, in minutes", () => {
  assert.strictEqual(
    approvalErrorReason(timeout(300000), "'saveData' on 'notes.json'"),
    "Permission request for 'saveData' on 'notes.json' expired — no answer within 5 minutes. Try again.",
  );
});

test("formatWait uses minutes when whole, seconds otherwise", () => {
  assert.strictEqual(formatWait(60000), "1 minute");
  assert.strictEqual(formatWait(300000), "5 minutes");
  assert.strictEqual(formatWait(45000), "45 seconds");
  assert.strictEqual(formatWait(1000), "1 second");
});

test("other errors keep their message, without a 'JIT consent' prefix", () => {
  assert.strictEqual(
    approvalErrorReason(new Error("boom"), "'x' on 'y'"),
    "Permission request failed: boom",
  );
  assert.strictEqual(
    approvalErrorReason(null, "'x' on 'y'"),
    "Permission request failed: unknown error",
  );
});
