/**
 * mcpResult.test.js — normalization of mcpController.callTool results.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeMcpResult } = require("./mcpResult");

describe("normalizeMcpResult", () => {
  it("maps an error result to isError with the message", () => {
    assert.deepEqual(normalizeMcpResult({ error: true, message: "nope" }), {
      text: "nope",
      isError: true,
    });
  });

  it("joins MCP text content blocks", () => {
    const r = normalizeMcpResult({
      success: true,
      result: {
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      },
    });
    assert.deepEqual(r, { text: "a\nb", isError: false });
  });

  it("propagates result.isError on a content result", () => {
    const r = normalizeMcpResult({
      success: true,
      result: { content: [{ type: "text", text: "bad" }], isError: true },
    });
    assert.deepEqual(r, { text: "bad", isError: true });
  });

  it("passes through a string result", () => {
    assert.deepEqual(normalizeMcpResult({ success: true, result: "hello" }), {
      text: "hello",
      isError: false,
    });
  });

  it("JSON-stringifies a non-string, non-content result", () => {
    const r = normalizeMcpResult({ success: true, result: { a: 1 } });
    assert.deepEqual(r, { text: '{"a":1}', isError: false });
  });

  it("handles a null/empty result", () => {
    assert.equal(normalizeMcpResult(null).isError, true);
    assert.equal(normalizeMcpResult({ success: true }).isError, false);
  });
});
