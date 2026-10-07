/**
 * anthropicAdapter.test.js
 *
 * Unit tests for the Anthropic adapter's pure mappers and its runTurn parsing,
 * driven by a fake Anthropic streaming client (no SDK, no network).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("./anthropicAdapter");

describe("anthropicAdapter.toProviderTools", () => {
  it("maps MCP tools to Anthropic input_schema shape", () => {
    const out = adapter.toProviderTools([
      {
        name: "get_pr",
        description: "Get a PR",
        inputSchema: { type: "object", properties: { id: { type: "number" } } },
      },
    ]);
    assert.deepEqual(out, [
      {
        name: "get_pr",
        description: "Get a PR",
        input_schema: {
          type: "object",
          properties: { id: { type: "number" } },
        },
      },
    ]);
  });

  it("defaults an empty object schema when inputSchema is missing", () => {
    const out = adapter.toProviderTools([{ name: "ping" }]);
    assert.deepEqual(out[0].input_schema, { type: "object", properties: {} });
  });

  it("passes Anthropic server tools through unchanged", () => {
    const serverTool = { type: "web_search_20260209", name: "web_search" };
    const out = adapter.toProviderTools([serverTool]);
    assert.deepEqual(out[0], serverTool);
  });
});

describe("anthropicAdapter.formatToolResults", () => {
  it("packs results into one user message of tool_result blocks", () => {
    const msgs = adapter.formatToolResults([
      { id: "t1", name: "a", text: "ok", isError: false },
      { id: "t2", name: "b", text: "boom", isError: true },
    ]);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].role, "user");
    assert.deepEqual(msgs[0].content, [
      {
        type: "tool_result",
        tool_use_id: "t1",
        content: "ok",
        is_error: false,
      },
      {
        type: "tool_result",
        tool_use_id: "t2",
        content: "boom",
        is_error: true,
      },
    ]);
  });

  it("puts images inside the tool_result as base64 image blocks (CAP-001)", () => {
    const msgs = adapter.formatToolResults([
      {
        id: "t1",
        name: "fetch_image",
        text: "shoe.jpg",
        images: [{ data: "AAAA", mimeType: "image/jpeg" }],
        isError: false,
      },
    ]);
    assert.deepEqual(msgs[0].content[0].content, [
      { type: "text", text: "shoe.jpg" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
      },
    ]);
  });

  it("omits an empty text block when a result is image-only", () => {
    const msgs = adapter.formatToolResults([
      {
        id: "t1",
        name: "snap",
        text: "",
        images: [{ data: "AAAA", mimeType: "image/png" }],
        isError: false,
      },
    ]);
    assert.deepEqual(msgs[0].content[0].content, [
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AAAA" },
      },
    ]);
  });
});

// Fake stream matching the subset of the Anthropic SDK the adapter uses:
// .on("text", cb) and .finalMessage().
function fakeClient(finalMessage, textChunks = []) {
  return {
    messages: {
      stream() {
        const handlers = {};
        // Emit text on next tick so the .on("text") registration lands first.
        queueMicrotask(() => {
          for (const t of textChunks) {
            if (handlers.text) handlers.text(t);
          }
        });
        return {
          on(event, cb) {
            handlers[event] = cb;
          },
          async finalMessage() {
            return finalMessage;
          },
        };
      },
    },
  };
}

describe("anthropicAdapter.runTurn", () => {
  it("streams text and returns normalized end_turn result", async () => {
    const seen = [];
    const client = fakeClient(
      {
        content: [{ type: "text", text: "hello world" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 4 },
      },
      ["hello ", "world"],
    );
    const result = await adapter.runTurn({
      client,
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      onText: (t) => seen.push(t),
    });
    assert.deepEqual(seen, ["hello ", "world"]);
    assert.equal(result.stopReason, "end_turn");
    assert.deepEqual(result.toolCalls, []);
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4 });
    assert.equal(result.assistantMessage.role, "assistant");
  });

  it("extracts tool_use blocks into normalized toolCalls", async () => {
    const client = fakeClient({
      content: [
        { type: "text", text: "let me check" },
        { type: "tool_use", id: "tu_1", name: "get_prs", input: { repo: "x" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 6 },
    });
    const result = await adapter.runTurn({
      client,
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "prs?" }],
      tools: [],
    });
    assert.equal(result.stopReason, "tool_use");
    assert.deepEqual(result.toolCalls, [
      { id: "tu_1", name: "get_prs", input: { repo: "x" } },
    ]);
  });
});
