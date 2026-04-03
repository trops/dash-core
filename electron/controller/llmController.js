/**
 * llmController.js
 *
 * Manages LLM chat interactions in the main process.
 * Streams responses from Anthropic's Messages API, handles tool-use loops
 * by calling MCP tools via mcpController, and supports request cancellation.
 *
 * Conversation state lives in the renderer — this controller is stateless
 * per-request, receiving the full messages array each time.
 */
const Anthropic = require("@anthropic-ai/sdk");
const mcpController = require("./mcpController");
const cliController = require("./cliController");
const toolDefinitions = require("../mcp/toolDefinitions");
const toolHandlers = require("../mcp/toolHandlers");
const {
  LLM_STREAM_DELTA,
  LLM_STREAM_TOOL_CALL,
  LLM_STREAM_TOOL_RESULT,
  LLM_STREAM_COMPLETE,
  LLM_STREAM_ERROR,
} = require("../events/llmEvents");

/**
 * Internal Dash MCP tools — always available to the LLM.
 * Collected from all tool definition groups and mapped to their handlers.
 */
const DASH_TOOL_SERVER = "__dash_internal__";
const dashToolDefs = [
  ...toolDefinitions.dashboardTools,
  ...toolDefinitions.widgetTools,
  ...toolDefinitions.themeTools,
  ...toolDefinitions.providerTools,
  ...toolDefinitions.guideTools,
  ...toolDefinitions.layoutTools,
];
const dashToolHandlerMap = {
  list_dashboards: toolHandlers.handleListDashboards,
  get_dashboard: toolHandlers.handleGetDashboard,
  create_dashboard: toolHandlers.handleCreateDashboard,
  delete_dashboard: toolHandlers.handleDeleteDashboard,
  get_app_stats: toolHandlers.handleGetAppStats,
  add_widget: toolHandlers.handleAddWidget,
  remove_widget: toolHandlers.handleRemoveWidget,
  configure_widget: toolHandlers.handleConfigureWidget,
  list_widgets: toolHandlers.handleListWidgets,
  search_widgets: toolHandlers.handleSearchWidgets,
  install_widget: toolHandlers.handleInstallWidget,
  list_themes: toolHandlers.handleListThemes,
  get_theme: toolHandlers.handleGetTheme,
  create_theme: toolHandlers.handleCreateTheme,
  create_theme_from_url: toolHandlers.handleCreateThemeFromUrl,
  apply_theme: toolHandlers.handleApplyTheme,
  list_providers: toolHandlers.handleListProviders,
  add_provider: toolHandlers.handleAddProvider,
  remove_provider: toolHandlers.handleRemoveProvider,
  get_setup_guide: toolHandlers.handleGetSetupGuide,
  set_layout: toolHandlers.handleSetLayout,
  update_layout: toolHandlers.handleUpdateLayout,
  move_widget: toolHandlers.handleMoveWidget,
};

/**
 * In-flight requests for cancellation support.
 * Map<requestId, AbortController>
 */
const activeRequests = new Map();

/**
 * Default maximum tool-use rounds to prevent infinite loops.
 */
const DEFAULT_MAX_TOOL_ROUNDS = 10;

/**
 * Convert MCP tool format to Anthropic tool format.
 * MCP: { name, description, inputSchema }
 * Anthropic: { name, description, input_schema }
 */
function mcpToolToAnthropic(tool) {
  return {
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.inputSchema || { type: "object", properties: {} },
  };
}

/**
 * Extract text content from an MCP tool result.
 * MCP results can be { content: [{ type: "text", text: "..." }] } or plain strings.
 */
function extractToolResultText(mcpResult) {
  if (!mcpResult) return "No result returned.";
  if (mcpResult.error) return `Error: ${mcpResult.message}`;

  const result = mcpResult.result;
  if (!result) return "No result returned.";

  // MCP standard: { content: [{ type, text }] }
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  // Plain string
  if (typeof result === "string") return result;

  // Fallback: JSON stringify
  return JSON.stringify(result);
}

const llmController = {
  /**
   * sendMessage
   * Stream a response from the Anthropic Messages API with tool-use support.
   *
   * @param {BrowserWindow} win - the window to send stream events to
   * @param {string} requestId - unique ID for this request (for filtering + cancellation)
   * @param {object} params - { apiKey, model, messages, tools, toolServerMap, systemPrompt, maxToolRounds }
   */
  sendMessage: async (win, requestId, params) => {
    // Route to CLI backend if specified
    if (params.backend === "claude-code") {
      return cliController.sendMessage(win, requestId, params);
    }

    const {
      apiKey,
      model = "claude-sonnet-4-20250514",
      messages,
      tools = [],
      toolServerMap = {},
      systemPrompt,
      maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
    } = params;

    // Set up abort controller
    const abortController = new AbortController();
    activeRequests.set(requestId, abortController);

    try {
      if (!apiKey) {
        throw new Error(
          "API key is required. Add an Anthropic provider in your dashboard settings.",
        );
      }

      const client = new Anthropic({ apiKey });

      // Inject Dash internal tools alongside any externally connected tools
      const allTools = [...tools, ...dashToolDefs];
      const mergedToolServerMap = { ...toolServerMap };
      for (const def of dashToolDefs) {
        mergedToolServerMap[def.name] = DASH_TOOL_SERVER;
      }

      // Convert MCP tools to Anthropic format
      const anthropicTools = allTools.map(mcpToolToAnthropic);

      // Build the conversation — mutable copy for tool-use loop
      let currentMessages = [...messages];
      let toolRound = 0;

      while (toolRound <= maxToolRounds) {
        // Check for abort before each API call
        if (abortController.signal.aborted) {
          return;
        }

        // Build request params
        const requestParams = {
          model,
          max_tokens: 8192,
          messages: currentMessages,
          stream: true,
        };
        if (systemPrompt) {
          requestParams.system = systemPrompt;
        }
        if (anthropicTools.length > 0) {
          requestParams.tools = anthropicTools;
        }

        // Stream the response
        const stream = client.messages.stream(requestParams, {
          signal: abortController.signal,
        });

        let responseContentBlocks = [];
        let stopReason = null;

        // Collect text deltas and content blocks
        stream.on("text", (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send(LLM_STREAM_DELTA, { requestId, text });
          }
        });

        // Wait for the full message
        const finalMessage = await stream.finalMessage();
        responseContentBlocks = finalMessage.content;
        stopReason = finalMessage.stop_reason;

        // Check for tool use
        const toolUseBlocks = responseContentBlocks.filter(
          (block) => block.type === "tool_use",
        );

        if (stopReason === "end_turn" || toolUseBlocks.length === 0) {
          // Done — send complete event
          if (win && !win.isDestroyed()) {
            win.webContents.send(LLM_STREAM_COMPLETE, {
              requestId,
              content: responseContentBlocks,
              stopReason,
              usage: finalMessage.usage,
            });
          }
          return;
        }

        // Tool use round
        toolRound++;

        // Append assistant message with tool_use blocks
        currentMessages.push({
          role: "assistant",
          content: responseContentBlocks,
        });

        // Execute each tool call
        const toolResults = [];
        for (const toolBlock of toolUseBlocks) {
          if (abortController.signal.aborted) return;

          const serverName = mergedToolServerMap[toolBlock.name];

          // Notify renderer of tool call
          if (win && !win.isDestroyed()) {
            win.webContents.send(LLM_STREAM_TOOL_CALL, {
              requestId,
              toolUseId: toolBlock.id,
              toolName: toolBlock.name,
              serverName: serverName === DASH_TOOL_SERVER ? "Dash" : serverName,
              input: toolBlock.input,
            });
          }

          let resultText;
          let isError = false;

          if (serverName === DASH_TOOL_SERVER) {
            // Route to local Dash tool handler
            const handler = dashToolHandlerMap[toolBlock.name];
            if (!handler) {
              resultText = `Error: Unknown Dash tool "${toolBlock.name}".`;
              isError = true;
            } else {
              try {
                const dashResult = await handler(toolBlock.input || {});
                if (dashResult.isError) {
                  resultText = dashResult.content
                    .filter((c) => c.type === "text")
                    .map((c) => c.text)
                    .join("\n");
                  isError = true;
                } else {
                  resultText = dashResult.content
                    .filter((c) => c.type === "text")
                    .map((c) => c.text)
                    .join("\n");
                }
              } catch (err) {
                resultText = `Error calling Dash tool: ${err.message}`;
                isError = true;
              }
            }
          } else if (!serverName) {
            resultText = `Error: No MCP server found for tool "${toolBlock.name}". The server may have disconnected.`;
            isError = true;
          } else {
            try {
              const mcpResult = await mcpController.callTool(
                win,
                serverName,
                toolBlock.name,
                toolBlock.input,
              );
              if (mcpResult.error) {
                resultText = `Error: ${mcpResult.message}`;
                isError = true;
              } else {
                resultText = extractToolResultText(mcpResult);
              }
            } catch (err) {
              resultText = `Error calling tool: ${err.message}`;
              isError = true;
            }
          }

          // Notify renderer of tool result
          if (win && !win.isDestroyed()) {
            win.webContents.send(LLM_STREAM_TOOL_RESULT, {
              requestId,
              toolUseId: toolBlock.id,
              toolName: toolBlock.name,
              result: resultText,
              isError,
            });
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: resultText,
            is_error: isError,
          });
        }

        // Append tool results as user message
        currentMessages.push({
          role: "user",
          content: toolResults,
        });

        // Loop continues — next API call with tool results
      }

      // Exceeded max tool rounds
      if (win && !win.isDestroyed()) {
        win.webContents.send(LLM_STREAM_ERROR, {
          requestId,
          error: `Exceeded maximum tool-use rounds (${maxToolRounds}). The assistant may be stuck in a loop.`,
          code: "MAX_TOOL_ROUNDS",
        });
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        // Request was cancelled — not an error
        return;
      }

      console.error(`[llmController] Error in sendMessage:`, error);

      const errorPayload = {
        requestId,
        error: error.message || "Unknown error",
        code: error.status || error.code || "UNKNOWN",
      };

      // Handle rate limiting
      if (error.status === 429) {
        errorPayload.code = "RATE_LIMITED";
        const retryAfter = error.headers?.["retry-after"];
        if (retryAfter) {
          errorPayload.retryAfter = parseInt(retryAfter, 10);
        }
      }

      if (win && !win.isDestroyed()) {
        win.webContents.send(LLM_STREAM_ERROR, errorPayload);
      }
    } finally {
      activeRequests.delete(requestId);
    }
  },

  /**
   * abortRequest
   * Cancel an in-flight LLM request.
   *
   * @param {BrowserWindow} win - the window (unused but kept for API consistency)
   * @param {string} requestId - the request to cancel
   * @returns {{ success: boolean }}
   */
  abortRequest: (win, requestId) => {
    const controller = activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      activeRequests.delete(requestId);
      return { success: true };
    }
    // Fallback to CLI controller
    return cliController.abortRequest(requestId);
  },
};

module.exports = llmController;
