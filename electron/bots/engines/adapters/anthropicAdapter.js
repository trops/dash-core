/**
 * anthropicAdapter.js
 *
 * Anthropic provider adapter for the tool-loop engine. Generalized from the
 * Anthropic streaming + tool-use loop in electron/controller/llmController.js
 * (sendMessage) — same SDK calls and tool-format conversion, factored into the
 * adapter contract the tool-loop engine drives.
 *
 * Adapter contract (shared with openAICompatibleAdapter):
 *   id
 *   toProviderTools(mcpTools)            -> provider-shaped tool defs
 *   async runTurn({ credentials, client, model, system, messages, tools,
 *                   signal, onText })    -> { assistantMessage, toolCalls,
 *                                             stopReason, usage }
 *   formatToolResults(results)           -> provider-shaped message(s) to append
 *
 * `messages` are provider-shaped and opaque to the engine — the adapter owns
 * their format on both the request and the tool-result side.
 */
"use strict";

const Anthropic = require("@anthropic-ai/sdk");

// Server-side tool prefixes Anthropic executes itself — passed through as-is,
// no input_schema, no local execution (mirrors llmController.js).
const SERVER_TOOL_TYPE_PREFIXES = [
  "web_search",
  "code_execution",
  "computer_",
  "bash_",
  "text_editor_",
];

function isServerTool(tool) {
  return (
    !!tool &&
    typeof tool.type === "string" &&
    SERVER_TOOL_TYPE_PREFIXES.some((p) => tool.type.startsWith(p))
  );
}

/**
 * MCP tool { name, description, inputSchema } -> Anthropic { name, description,
 * input_schema }. Server tools carry a `type` and pass through unchanged.
 */
function mcpToolToAnthropic(tool) {
  if (isServerTool(tool)) return tool;
  return {
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.inputSchema || { type: "object", properties: {} },
  };
}

const anthropicAdapter = {
  id: "anthropic",

  toProviderTools(mcpTools) {
    return (mcpTools || []).map(mcpToolToAnthropic);
  },

  /**
   * Stream one assistant turn. Text deltas are emitted via `onText`; the full
   * assistant message (content blocks) is returned for the engine to append.
   */
  async runTurn({
    credentials,
    client,
    model,
    system,
    messages,
    tools,
    signal,
    onText,
  }) {
    const c =
      client || new Anthropic({ apiKey: credentials && credentials.apiKey });

    const params = {
      model,
      max_tokens: 8192,
      messages,
      stream: true,
    };
    if (system) params.system = system;
    if (tools && tools.length) params.tools = tools;

    const stream = c.messages.stream(params, signal ? { signal } : undefined);
    if (typeof onText === "function") {
      stream.on("text", (t) => onText(t));
    }

    const final = await stream.finalMessage();
    const content = final.content || [];
    const toolCalls = content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    return {
      assistantMessage: { role: "assistant", content },
      toolCalls,
      stopReason: final.stop_reason || "end_turn",
      usage: final.usage
        ? {
            inputTokens: final.usage.input_tokens,
            outputTokens: final.usage.output_tokens,
          }
        : null,
    };
  },

  /**
   * Anthropic takes tool results as a single user message of tool_result blocks.
   * @param {Array<{id: string, name: string, text: string, isError: boolean}>} results
   */
  formatToolResults(results) {
    return [
      {
        role: "user",
        content: results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.text,
          is_error: !!r.isError,
        })),
      },
    ];
  },
};

module.exports = anthropicAdapter;
