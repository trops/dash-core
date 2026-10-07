/**
 * openAICompatibleAdapter.test.js
 *
 * Unit tests for the OpenAI-compatible adapter (covers OpenAI + xAI): tool
 * schema mapping, tool-call parsing, finish_reason normalization, and the
 * per-result tool message shape. Uses a fake chat.completions client — no SDK,
 * no network.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("./openAICompatibleAdapter");

describe("openAICompatibleAdapter.toProviderTools", () => {
  it("maps MCP tools to OpenAI function-tool shape", () => {
    const out = adapter.toProviderTools([
      {
        name: "get_pr",
        description: "Get a PR",
        inputSchema: { type: "object", properties: { id: { type: "number" } } },
      },
    ]);
    assert.deepEqual(out, [
      {
        type: "function",
        function: {
          name: "get_pr",
          description: "Get a PR",
          parameters: {
            type: "object",
            properties: { id: { type: "number" } },
          },
        },
      },
    ]);
  });
});

describe("openAICompatibleAdapter.formatToolResults", () => {
  it("emits one role:tool message per result, keyed by tool_call_id", () => {
    const msgs = adapter.formatToolResults([
      { id: "c1", name: "a", text: "ok", isError: false },
      { id: "c2", name: "b", text: "nope", isError: true },
    ]);
    assert.deepEqual(msgs, [
      { role: "tool", tool_call_id: "c1", content: "ok" },
      { role: "tool", tool_call_id: "c2", content: "Error: nope" },
    ]);
  });

  it("sends images in one user message after the tool messages (CAP-001)", () => {
    const msgs = adapter.formatToolResults([
      {
        id: "c1",
        name: "fetch_image",
        text: "shoe.jpg",
        images: [{ data: "AAAA", mimeType: "image/jpeg" }],
        isError: false,
      },
      { id: "c2", name: "b", text: "ok", isError: false },
    ]);
    assert.deepEqual(msgs, [
      { role: "tool", tool_call_id: "c1", content: "shoe.jpg" },
      { role: "tool", tool_call_id: "c2", content: "ok" },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Images returned by fetch_image (call c1):",
          },
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64,AAAA" },
          },
        ],
      },
    ]);
  });

  it("an image-only tool result still gets non-empty tool content", () => {
    const msgs = adapter.formatToolResults([
      {
        id: "c1",
        name: "snap",
        text: "",
        images: [{ data: "AAAA", mimeType: "image/png" }],
        isError: false,
      },
    ]);
    assert.match(msgs[0].content, /image/);
  });
});

function fakeClient(response) {
  return {
    chat: { completions: { create: async () => response } },
  };
}

describe("openAICompatibleAdapter.runTurn", () => {
  it("emits text and normalizes finish_reason=stop to end_turn", async () => {
    const seen = [];
    const client = fakeClient({
      choices: [
        {
          message: { role: "assistant", content: "hi there" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 2 },
    });
    const result = await adapter.runTurn({
      client,
      model: "gpt-x",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      onText: (t) => seen.push(t),
    });
    assert.deepEqual(seen, ["hi there"]);
    assert.equal(result.stopReason, "end_turn");
    assert.deepEqual(result.toolCalls, []);
    assert.deepEqual(result.usage, { inputTokens: 8, outputTokens: 2 });
  });

  it("parses tool_calls and normalizes finish_reason=tool_calls to tool_use", async () => {
    const client = fakeClient({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                function: { name: "get_prs", arguments: '{"repo":"x"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 6 },
    });
    const result = await adapter.runTurn({
      client,
      model: "gpt-x",
      messages: [{ role: "user", content: "prs?" }],
      tools: [],
    });
    assert.equal(result.stopReason, "tool_use");
    assert.deepEqual(result.toolCalls, [
      { id: "call_1", name: "get_prs", input: { repo: "x" } },
    ]);
  });

  it("tolerates malformed tool arguments without throwing", async () => {
    const client = fakeClient({
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "call_2",
                function: { name: "oops", arguments: "{not json" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    const result = await adapter.runTurn({
      client,
      model: "gpt-x",
      messages: [],
      tools: [],
    });
    assert.equal(result.toolCalls[0].name, "oops");
    assert.equal(result.toolCalls[0].input.__raw, "{not json");
  });

  it("prepends the system prompt as a system message", async () => {
    let capturedMessages = null;
    const client = {
      chat: {
        completions: {
          create: async (params) => {
            capturedMessages = params.messages;
            return {
              choices: [
                {
                  message: { role: "assistant", content: "ok" },
                  finish_reason: "stop",
                },
              ],
            };
          },
        },
      },
    };
    await adapter.runTurn({
      client,
      model: "gpt-x",
      system: "You are a bot.",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    assert.equal(capturedMessages[0].role, "system");
    assert.equal(capturedMessages[0].content, "You are a bot.");
    assert.equal(capturedMessages[1].role, "user");
  });
});
