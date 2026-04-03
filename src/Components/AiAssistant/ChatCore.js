/**
 * ChatCore
 *
 * Core chat engine for LLM conversations. Backend-agnostic — receives
 * `backend` prop ("anthropic" | "claude-code") and adjusts readiness
 * checks, warning banners, and message params accordingly.
 *
 * This is a framework component in dash-core — it does NOT depend on
 * WidgetContext or WorkspaceContext, so it can be used both as a widget
 * (via wrapper) and as a standalone panel (AI Assistant).
 *
 * @param {string} apiKey - Anthropic API key (passed directly, not via provider hook)
 * @param {object} api - Optional widget API for persistence (storeData/readData)
 * @param {string} persistKey - Optional localStorage key for persistence when api is not available
 * @param {function} onPublishEvent - Optional callback for publishing events (replaces useWidgetEvents)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { SubHeading2 } from "@trops/dash-react";
import { ChatMessages } from "./components/ChatMessages";
import { ChatInput } from "./components/ChatInput";
import { ToolSelector } from "./components/ToolSelector";

let requestCounter = 0;
function generateRequestId(uuid) {
  return `${uuid || "chat"}-${Date.now()}-${++requestCounter}`;
}

export function ChatCore({
  title,
  model,
  systemPrompt,
  maxToolRounds,
  apiKey = null,
  api = null,
  uuid = null,
  persistKey = null,
  backend = "anthropic",
  onPublishEvent = null,
}) {
  const mainApi = window.mainApi;

  // Conversation state
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [streamingText, setStreamingText] = useState("");
  const activeRequestId = useRef(null);

  // MCP tool state (only used for anthropic backend)
  const [servers, setServers] = useState([]);
  const [enabledTools, setEnabledTools] = useState({});

  // Tool calls for current streaming response
  const toolCallsRef = useRef([]);

  // Scoped listener references for cleanup
  const listenersRef = useRef([]);

  // CLI session state
  const [sessionActive, setSessionActive] = useState(false);

  // Backend readiness
  const isAnthropicBackend = backend === "anthropic";
  const isCliBackend = backend === "claude-code";

  // CLI availability state
  const [cliAvailable, setCliAvailable] = useState(null);

  useEffect(() => {
    if (!isCliBackend || !mainApi?.llm?.checkCliAvailable) return;
    mainApi.llm.checkCliAvailable().then((result) => {
      setCliAvailable(result?.available || false);
    });
  }, [isCliBackend, mainApi]);

  const handleCheckCliAgain = useCallback(() => {
    if (!mainApi?.llm?.checkCliAvailable) return;
    setCliAvailable(null);
    mainApi.llm.checkCliAvailable().then((result) => {
      setCliAvailable(result?.available || false);
    });
  }, [mainApi]);

  // Determine readiness
  const isReady = isAnthropicBackend ? !!apiKey : cliAvailable === true;

  // Persistence helpers
  const saveConversation = useCallback(
    (msgs, tools) => {
      const data = { messages: msgs, enabledTools: tools || enabledTools };
      if (api && uuid) {
        api.storeData({
          data,
          uuid,
          append: false,
          callbackComplete: () => {},
          callbackError: () => {},
        });
      } else if (persistKey) {
        try {
          localStorage.setItem(persistKey, JSON.stringify(data));
        } catch (e) {
          /* ignore quota errors */
        }
      }
    },
    [api, uuid, persistKey, enabledTools],
  );

  // Load saved conversation on mount
  useEffect(() => {
    if (api && uuid) {
      api.readData({
        uuid,
        callbackComplete: (data) => {
          if (data?.messages && Array.isArray(data.messages)) {
            setMessages(data.messages);
          }
          if (data?.enabledTools) {
            setEnabledTools(data.enabledTools);
          }
        },
        callbackError: () => {},
      });
    } else if (persistKey) {
      try {
        const raw = localStorage.getItem(persistKey);
        if (raw) {
          const data = JSON.parse(raw);
          if (data?.messages && Array.isArray(data.messages)) {
            setMessages(data.messages);
          }
          if (data?.enabledTools) {
            setEnabledTools(data.enabledTools);
          }
        }
      } catch (e) {
        /* ignore */
      }
    }
  }, [api, uuid, persistKey]);

  // Discover connected MCP tools (only for anthropic backend)
  const refreshTools = useCallback(() => {
    if (!isAnthropicBackend || !mainApi?.llm) return;
    mainApi.llm.listConnectedTools().then((result) => {
      if (Array.isArray(result)) {
        setServers(result);
      }
    });
  }, [mainApi, isAnthropicBackend]);

  useEffect(() => {
    refreshTools();
    const interval = setInterval(refreshTools, 30000);
    return () => clearInterval(interval);
  }, [refreshTools]);

  // Set up stream listeners
  useEffect(() => {
    if (!mainApi?.llm) return;

    const deltaId = mainApi.llm.onStreamDelta((data) => {
      if (data.requestId !== activeRequestId.current) return;
      setStreamingText((prev) => prev + data.text);
    });

    const toolCallId = mainApi.llm.onStreamToolCall((data) => {
      if (data.requestId !== activeRequestId.current) return;
      toolCallsRef.current.push({
        toolUseId: data.toolUseId,
        toolName: data.toolName,
        serverName: data.serverName,
        input: data.input,
        isLoading: true,
      });
      setMessages((prev) => [...prev]);
    });

    const toolResultId = mainApi.llm.onStreamToolResult((data) => {
      if (data.requestId !== activeRequestId.current) return;
      const tc = toolCallsRef.current.find(
        (t) => t.toolUseId === data.toolUseId,
      );
      if (tc) {
        tc.result = data.result;
        tc.isError = data.isError;
        tc.isLoading = false;
      }
      setStreamingText("");
      if (onPublishEvent) {
        onPublishEvent("toolUsed", {
          toolName: data.toolName,
          isError: data.isError,
        });
      }
    });

    const completeId = mainApi.llm.onStreamComplete((data) => {
      if (data.requestId !== activeRequestId.current) return;

      const assistantMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: data.content,
        toolCalls: [...toolCallsRef.current],
        usage: data.usage,
      };

      setMessages((prev) => {
        const updated = [...prev, assistantMessage];
        saveConversation(updated);
        return updated;
      });
      setStreamingText("");
      setIsLoading(false);
      setSessionActive(true);
      activeRequestId.current = null;
      toolCallsRef.current = [];
    });

    const errorId = mainApi.llm.onStreamError((data) => {
      if (data.requestId !== activeRequestId.current) return;

      let errorMessage = data.error;
      if (data.code === "RATE_LIMITED" && data.retryAfter) {
        errorMessage = `Rate limited. Try again in ${data.retryAfter} seconds.`;
      }

      setError(errorMessage);
      setIsLoading(false);
      setStreamingText("");
      activeRequestId.current = null;
      toolCallsRef.current = [];
    });

    listenersRef.current = [
      deltaId,
      toolCallId,
      toolResultId,
      completeId,
      errorId,
    ];

    return () => {
      for (const id of listenersRef.current) {
        mainApi.llm.removeStreamListener(id);
      }
      listenersRef.current = [];
    };
  }, [mainApi, onPublishEvent, saveConversation]);

  // Send message
  const handleSend = useCallback(
    (text) => {
      if (!mainApi?.llm || isLoading) return;

      setError(null);

      const userMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: text,
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);

      if (onPublishEvent) {
        onPublishEvent("messageSent", { text });
      }

      const apiMessages = updatedMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const allTools = [];
      const toolServerMap = {};
      if (isAnthropicBackend) {
        for (const server of servers) {
          for (const tool of server.tools || []) {
            if (enabledTools[tool.name] !== false) {
              allTools.push(tool);
              toolServerMap[tool.name] = server.serverName;
            }
          }
        }
      }

      const requestId = generateRequestId(uuid || persistKey);
      activeRequestId.current = requestId;
      toolCallsRef.current = [];
      setIsLoading(true);
      setStreamingText("");

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-streaming`,
          role: "assistant",
          content: [],
          toolCalls: toolCallsRef.current,
        },
      ]);

      mainApi.llm.sendMessage(requestId, {
        backend,
        apiKey: isAnthropicBackend ? apiKey : undefined,
        model,
        messages: apiMessages,
        tools: allTools,
        toolServerMap,
        systemPrompt,
        maxToolRounds: parseInt(maxToolRounds, 10) || 10,
        widgetUuid: uuid || persistKey,
      });
    },
    [
      mainApi,
      isLoading,
      messages,
      servers,
      enabledTools,
      apiKey,
      model,
      systemPrompt,
      maxToolRounds,
      uuid,
      persistKey,
      onPublishEvent,
      backend,
      isAnthropicBackend,
    ],
  );

  // Stop streaming
  const handleStop = useCallback(() => {
    if (activeRequestId.current && mainApi?.llm) {
      mainApi.llm.abortRequest(activeRequestId.current);

      if (streamingText) {
        setMessages((prev) => {
          const updated = prev.map((msg) => {
            if (msg.id === "msg-streaming") {
              return {
                ...msg,
                id: `msg-${Date.now()}`,
                content: [{ type: "text", text: streamingText }],
                toolCalls: [...toolCallsRef.current],
              };
            }
            return msg;
          });
          saveConversation(updated);
          return updated;
        });
      } else {
        setMessages((prev) => {
          const updated = prev.filter((msg) => msg.id !== "msg-streaming");
          saveConversation(updated);
          return updated;
        });
      }

      setIsLoading(false);
      setStreamingText("");
      activeRequestId.current = null;
      toolCallsRef.current = [];
    }
  }, [mainApi, streamingText, saveConversation]);

  // New chat
  const handleNewChat = () => {
    if (isLoading) handleStop();
    setMessages([]);
    setError(null);
    setStreamingText("");
    setSessionActive(false);
    saveConversation([]);

    if (isCliBackend && mainApi?.llm?.clearCliSession) {
      mainApi.llm.clearCliSession(uuid || persistKey);
    }
  };

  // End CLI session
  const handleEndSession = () => {
    if (!isCliBackend || !mainApi?.llm?.endCliSession) return;
    if (isLoading) handleStop();
    mainApi.llm.endCliSession(uuid || persistKey);
    setSessionActive(false);
  };

  // Toggle tool
  const handleToggleTool = (toolName) => {
    setEnabledTools((prev) => {
      const updated = {
        ...prev,
        [toolName]: prev[toolName] === false ? true : false,
      };
      saveConversation(messages, updated);
      return updated;
    });
  };

  const hasTools =
    isAnthropicBackend && servers.some((s) => s.tools?.length > 0);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-gray-900 text-gray-200">
      {/* Header — only shown when title is provided */}
      {title ? (
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50 shrink-0">
          <div className="flex items-center gap-2">
            <SubHeading2 title={title} />
            {isCliBackend && sessionActive && (
              <span
                className="inline-block w-2 h-2 rounded-full bg-green-400"
                title="CLI session active"
              />
            )}
          </div>
          <div className="flex items-center gap-1">
            {isCliBackend && sessionActive && (
              <button
                onClick={handleEndSession}
                className="px-2 py-1 text-xs rounded bg-red-900/50 hover:bg-red-800/50 text-red-300 transition-colors"
              >
                End Session
              </button>
            )}
            <button
              onClick={handleNewChat}
              className="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            >
              New Chat
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end px-3 py-1 shrink-0">
          {isCliBackend && sessionActive && (
            <button
              onClick={handleEndSession}
              className="px-2 py-1 text-xs rounded bg-red-900/50 hover:bg-red-800/50 text-red-300 transition-colors mr-1"
            >
              End Session
            </button>
          )}
          <button
            onClick={handleNewChat}
            className="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            New Chat
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-3 mt-2 p-2 bg-red-900/30 border border-red-700 rounded text-red-300 text-xs">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-400 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Anthropic API key warning */}
      {isAnthropicBackend && !apiKey && (
        <div className="mx-3 mt-2 p-2 bg-yellow-900/30 border border-yellow-700 rounded text-yellow-300 text-xs">
          Add an Anthropic API key in Settings &gt; AI Assistant to start
          chatting.
        </div>
      )}

      {/* CLI checking state */}
      {isCliBackend && cliAvailable === null && (
        <div className="mx-3 mt-2 p-2 bg-gray-800/50 border border-gray-700 rounded text-gray-400 text-xs">
          Checking for Claude Code CLI...
        </div>
      )}

      {/* CLI setup panel */}
      {isCliBackend && cliAvailable === false && (
        <div className="mx-3 mt-2 p-3 bg-yellow-900/30 border border-yellow-700 rounded text-yellow-300 text-xs">
          <p className="font-semibold mb-2">Claude Code CLI not found</p>
          <ol className="list-decimal list-inside space-y-1 mb-3 text-yellow-300/90">
            <li>
              Download Claude Code from{" "}
              <button
                onClick={() =>
                  mainApi?.shell?.openExternal?.("https://claude.ai/download")
                }
                className="underline hover:text-yellow-200 font-mono"
              >
                claude.ai/download
              </button>
            </li>
            <li>
              Open your terminal and run{" "}
              <span className="font-mono bg-yellow-900/50 px-1 rounded">
                claude auth login
              </span>
            </li>
            <li>Complete authentication in your browser</li>
          </ol>
          <button
            onClick={handleCheckCliAgain}
            className="px-3 py-1 text-xs rounded bg-yellow-800/60 hover:bg-yellow-700/60 text-yellow-200 border border-yellow-600/50 transition-colors"
          >
            Check Again
          </button>
        </div>
      )}

      {/* No tools info (anthropic only) */}
      {isAnthropicBackend && !hasTools && apiKey && messages.length === 0 && (
        <div className="mx-3 mt-2 p-2 bg-gray-800/50 border border-gray-700 rounded text-gray-400 text-xs">
          No MCP tools connected. Connect providers (GitHub, Slack, etc.) to
          enable tool-use.
        </div>
      )}

      {/* CLI tools info */}
      {isCliBackend && cliAvailable && messages.length === 0 && (
        <div className="mx-3 mt-2 p-2 bg-gray-800/50 border border-gray-700 rounded text-gray-400 text-xs">
          Using Claude Code CLI. Your configured MCP tools pass through
          automatically.
        </div>
      )}

      {/* Tool selector (anthropic only) */}
      {hasTools && (
        <div className="px-1 pt-1">
          <ToolSelector
            servers={servers}
            enabledTools={enabledTools}
            onToggle={handleToggleTool}
          />
        </div>
      )}

      {/* Messages */}
      <ChatMessages
        messages={messages}
        streamingRequestId={isLoading ? activeRequestId.current : null}
        streamingText={streamingText}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isLoading={isLoading}
        disabled={!isReady}
      />
    </div>
  );
}
