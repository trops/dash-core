/**
 * openAICompatibleAdapter.js
 *
 * One adapter for every OpenAI-compatible provider — OpenAI itself and xAI
 * (Grok), which exposes an OpenAI-compatible API at a different base URL. The
 * `baseURL` comes from the provider registry (electron/llm/modelProviders.js),
 * so adding another OpenAI-compatible vendor is a registry entry, not new code.
 *
 * Implements the same adapter contract as anthropicAdapter (see that file).
 *
 * First cut uses a non-streaming chat.completions call and emits the full turn
 * text once via `onText`. Token-level streaming (assembling `tool_calls` from
 * SSE deltas) is a later refinement; the engine's BotEvent stream and the tool
 * gate behave identically either way.
 */
"use strict";

/**
 * MCP tool { name, description, inputSchema } -> OpenAI function-tool shape.
 */
function mcpToolToOpenAI(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
  };
}

// OpenAI finish_reason -> normalized stopReason the engine understands.
function normalizeStopReason(finishReason) {
  if (finishReason === "tool_calls") return "tool_use";
  if (finishReason === "stop") return "end_turn";
  return finishReason || "end_turn";
}

const openAICompatibleAdapter = {
  id: "openai-compatible",

  toProviderTools(mcpTools) {
    return (mcpTools || []).map(mcpToolToOpenAI);
  },

  async runTurn({
    credentials,
    client,
    baseURL,
    model,
    system,
    messages,
    tools,
    signal,
    onText,
  }) {
    let c = client;
    if (!c) {
      // Lazy require so the provider registry (which references this adapter by
      // id) never pulls the OpenAI SDK in just to hold metadata.
      const OpenAI = require("openai");
      c = new OpenAI({
        apiKey: credentials && credentials.apiKey,
        baseURL: baseURL || undefined,
      });
    }

    // OpenAI carries the system prompt as a leading system message rather than a
    // top-level field.
    const reqMessages = system
      ? [{ role: "system", content: system }, ...messages]
      : messages;

    const params = { model, messages: reqMessages };
    if (tools && tools.length) params.tools = tools;

    const resp = await c.chat.completions.create(
      params,
      signal ? { signal } : undefined,
    );

    const choice = (resp.choices && resp.choices[0]) || {};
    const message = choice.message || { role: "assistant", content: "" };

    if (typeof onText === "function" && message.content) {
      onText(message.content);
    }

    const toolCalls = (message.tool_calls || []).map((tc) => {
      let input = {};
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch (e) {
        input = { __raw: tc.function.arguments };
      }
      return { id: tc.id, name: tc.function.name, input };
    });

    return {
      assistantMessage: message,
      toolCalls,
      stopReason: normalizeStopReason(choice.finish_reason),
      usage: resp.usage
        ? {
            inputTokens: resp.usage.prompt_tokens,
            outputTokens: resp.usage.completion_tokens,
          }
        : null,
    };
  },

  /**
   * OpenAI takes each tool result as its own `role: "tool"` message keyed by
   * tool_call_id. Tool messages can only carry text, so images (CAP-001)
   * follow in one user message, each group labelled with the call it came from.
   * @param {Array<{id: string, name: string, text: string, images?: Array<{data: string, mimeType: string}>, isError: boolean}>} results
   */
  formatToolResults(results) {
    const messages = results.map((r) => {
      const hasImages = Array.isArray(r.images) && r.images.length > 0;
      const text =
        r.text ||
        (hasImages
          ? `Returned ${r.images.length} image(s), attached below.`
          : "");
      return {
        role: "tool",
        tool_call_id: r.id,
        content: r.isError ? `Error: ${text}` : text,
      };
    });
    const parts = [];
    for (const r of results) {
      if (!Array.isArray(r.images) || !r.images.length) continue;
      parts.push({
        type: "text",
        text: `Images returned by ${r.name} (call ${r.id}):`,
      });
      for (const img of r.images) {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.data}` },
        });
      }
    }
    if (parts.length) messages.push({ role: "user", content: parts });
    return messages;
  },
};

module.exports = openAICompatibleAdapter;
