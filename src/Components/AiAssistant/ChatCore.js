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
import { AlertBanner, SubHeading2 } from "@trops/dash-react";
import { ChatMessages } from "./components/ChatMessages";
import { ChatInput } from "./components/ChatInput";
import { ToolSelector } from "./components/ToolSelector";
import { RecipientPicker, useTeamLeads } from "./components/RecipientPicker";
import {
  availabilityNotice,
  buildLlmHistory,
  hasLeadSession,
} from "./leadMessages";
import { appendAnswerText } from "../../utils/answerText";
import { readableError } from "../Bots/botConversation";

// The fields of a team lead stored on chat messages / the saved recipient.
const pickLead = (lead) => ({
  botId: lead.botId,
  leadName: lead.leadName,
  dashboardName: lead.dashboardName,
  dashboardLabel: lead.dashboardLabel || lead.dashboardName,
});

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
  // Like persistKey but uses sessionStorage — chat survives component
  // unmount/remount within the same Electron window (e.g. collapsing
  // and re-opening a sidebar) but resets when the app window closes.
  // Useful for sidebar-style assistants where long-lived
  // cross-session history isn't desired.
  sessionKey = null,
  backend = "anthropic",
  // Per-call lockdown flags forwarded to the Claude Code CLI invocation.
  // Defaults preserve the AssistantPanel behavior (Claude Code's default
  // system prompt is APPENDED, all built-in tools available, MCP wired).
  // The widget builder modal opts both true to lock the AI to text +
  // code-block output with no Skill/Bash/Read/etc. invocations. Both are
  // ignored on the anthropic backend — the CLI flags they map to
  // (--system-prompt vs --append-system-prompt, --tools "") only exist
  // for `claude -p`. This component must FORWARD them to the IPC payload
  // even though it doesn't act on them itself; cliController is what
  // turns them into argv. (Slice 18b — fixes a chain break where these
  // props were silently dropped between WidgetBuilderModal and
  // cliController.)
  replaceSystemPrompt = false,
  disableTools = false,
  onPublishEvent = null,
  hideToolsBanner = false,
  cwd = null,
  // Optional starter message auto-sent when the chat mounts with an
  // empty conversation. Used by callers that want the AI to greet /
  // orient the user before they type anything (e.g. the widget
  // builder introducing the widget being edited).
  initialMessage = null,
  // Offer a "To:" picker so the user can message a team lead directly
  // (bot-teams TEAM-013). Only the AI Assistant panel turns this on.
  enableLeadRecipients = false,
}) {
  const mainApi = window.mainApi;

  // Direct-to-lead state (TEAM-013). recipient null = the Assistant.
  const [recipient, setRecipient] = useState(null);
  const recipientRef = useRef(null);
  recipientRef.current = recipient;
  const [leadNotice, setLeadNotice] = useState(null);
  const leadRunRef = useRef(null);
  const { leads, loaded: leadsLoaded } = useTeamLeads(enableLeadRecipients);

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
      const data = {
        messages: msgs,
        enabledTools: tools || enabledTools,
        recipient: recipientRef.current,
      };
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
      } else if (sessionKey) {
        try {
          sessionStorage.setItem(sessionKey, JSON.stringify(data));
        } catch (e) {
          /* ignore quota errors */
        }
      }
    },
    [api, uuid, persistKey, sessionKey, enabledTools],
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
          if (enableLeadRecipients && data?.recipient?.botId) {
            setRecipient(data.recipient);
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
          if (enableLeadRecipients && data?.recipient?.botId) {
            setRecipient(data.recipient);
          }
        }
      } catch (e) {
        /* ignore */
      }
    } else if (sessionKey) {
      try {
        const raw = sessionStorage.getItem(sessionKey);
        if (raw) {
          const data = JSON.parse(raw);
          if (data?.messages && Array.isArray(data.messages)) {
            setMessages(data.messages);
          }
          if (data?.enabledTools) {
            setEnabledTools(data.enabledTools);
          }
          if (enableLeadRecipients && data?.recipient?.botId) {
            setRecipient(data.recipient);
          }
        }
      } catch (e) {
        /* ignore */
      }
    }
  }, [api, uuid, persistKey, sessionKey, enableLeadRecipients]);

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
      // Force re-render so MessageBubble picks up the updated tool
      // result state (isLoading=false, result populated). Can't rely on
      // setStreamingText since it may already be empty (tool-only
      // response from CLI backend).
      setMessages((prev) => [...prev]);
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

  // ---- Direct-to-lead messages (bot-teams TEAM-013) ----------------------

  // Replace the lead's streaming placeholder with its final answer/error.
  const finishLeadRun = useCallback(
    (placeholderId, { content, error: leadError }) => {
      const run = leadRunRef.current;
      if (run && run.listenerId != null) {
        mainApi?.bots?.removeListener?.(run.listenerId);
      }
      leadRunRef.current = null;
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === placeholderId
            ? {
                ...m,
                streaming: false,
                content: content !== undefined ? content : m.content,
                error: leadError || undefined,
              }
            : m,
        );
        saveConversation(updated);
        return updated;
      });
      setIsLoading(false);
    },
    [mainApi, saveConversation],
  );

  // Send `text` straight to the selected team lead — the Assistant's model
  // is not called. Returns false (text stays in the box) when the lead
  // can't take it right now.
  const sendToLead = useCallback(
    (text) => {
      const lead = leads.find((l) => l.botId === recipient.botId) || recipient;
      const notice = availabilityNotice(lead);
      if (notice) {
        setLeadNotice(notice);
        return false;
      }
      if (!mainApi?.bots?.askLead) {
        setLeadNotice("Team leads aren't available in this window.");
        return false;
      }
      setLeadNotice(null);
      setError(null);

      const target = pickLead(lead);
      const placeholderId = `msg-lead-${Date.now()}`;
      const continueConversation = hasLeadSession(messages, target.botId);
      setMessages((prev) => [
        ...prev,
        { id: `msg-${Date.now()}`, role: "user", content: text, to: target },
        {
          id: placeholderId,
          role: "lead",
          from: target,
          content: "",
          streaming: true,
        },
      ]);
      setIsLoading(true);

      let streamed = "";
      let afterTool = false;
      const listenerId = mainApi.bots.onStream
        ? mainApi.bots.onStream((payload) => {
            if (!payload || payload.botId !== target.botId) return;
            const event = payload.event || {};
            if (event.type === "text" && event.text) {
              streamed = appendAnswerText(streamed, event.text, { afterTool });
              afterTool = false;
              const now = streamed;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === placeholderId ? { ...m, content: now } : m,
                ),
              );
            } else if (
              event.type === "tool_call" ||
              event.type === "tool_result"
            ) {
              afterTool = true;
            }
          })
        : null;
      leadRunRef.current = {
        botId: target.botId,
        listenerId,
        placeholderId,
        streamed: () => streamed,
      };

      Promise.resolve(
        mainApi.bots.askLead(
          target.botId,
          text,
          continueConversation,
          "assistant",
        ),
      )
        .then((record) => {
          // Stop already finished this run.
          if (
            !leadRunRef.current ||
            leadRunRef.current.placeholderId !== placeholderId
          )
            return;
          if (record?.skipped) {
            finishLeadRun(placeholderId, {
              error: `${target.leadName} is busy with another run — try again when it finishes.`,
            });
          } else if (record?.error || record?.status === "failed") {
            finishLeadRun(placeholderId, {
              error:
                readableError(String(record.error || "")) ||
                `${target.leadName} couldn't answer.`,
            });
          } else {
            finishLeadRun(placeholderId, {
              content: record?.output || streamed,
            });
          }
        })
        .catch((e) => {
          if (!leadRunRef.current) return;
          finishLeadRun(placeholderId, {
            error: e?.message || `${target.leadName} couldn't answer.`,
          });
        });
      return true;
    },
    [leads, recipient, mainApi, messages, finishLeadRun],
  );

  // Stop waiting for the lead (AC9) and stop its run.
  const stopLeadRun = useCallback(() => {
    const run = leadRunRef.current;
    if (!run) return false;
    mainApi?.bots?.stop?.(run.botId);
    const partial = run.streamed();
    finishLeadRun(run.placeholderId, {
      content: partial ? `${partial}\n\n(stopped)` : "(stopped)",
    });
    return true;
  }, [mainApi, finishLeadRun]);

  const handleRecipientChange = useCallback(
    (lead) => {
      const next = lead ? pickLead(lead) : null;
      setRecipient(next);
      recipientRef.current = next;
      setLeadNotice(null);
      saveConversation(messages);
    },
    [messages, saveConversation],
  );

  // The selected lead was removed or turned off → back to the Assistant.
  useEffect(() => {
    if (!enableLeadRecipients || !leadsLoaded || !recipient) return;
    if (leads.some((l) => l.botId === recipient.botId)) return;
    setLeadNotice(
      `${recipient.leadName} is no longer available — messages go to the Assistant.`,
    );
    setRecipient(null);
    recipientRef.current = null;
  }, [enableLeadRecipients, leadsLoaded, leads, recipient]);

  // Send message. `options.hidden` marks the user message so
  // MessageBubble skips rendering it — useful for app-injected
  // priming prompts where the agent's reply should appear first,
  // but the prompt still needs to be in conversation history.
  const handleSend = useCallback(
    (text, options = {}) => {
      if (enableLeadRecipients && recipient && !options.hidden) {
        if (isLoading) return false;
        return sendToLead(text);
      }
      if (!mainApi?.llm || isLoading) return;

      setError(null);
      setLeadNotice(null);

      const userMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: text,
        hidden: options.hidden === true,
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);

      if (onPublishEvent) {
        onPublishEvent("messageSent", { text });
      }

      // With lead recipients on, direct lead exchanges are folded in as
      // labelled context (TEAM-013 AC10); otherwise unchanged.
      const apiMessages = enableLeadRecipients
        ? buildLlmHistory(updatedMessages)
        : updatedMessages.map((msg) => ({
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

      const requestId = generateRequestId(uuid || persistKey || sessionKey);
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
        widgetUuid: uuid || persistKey || sessionKey,
        cwd: cwd || undefined,
        replaceSystemPrompt,
        disableTools,
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
      enableLeadRecipients,
      recipient,
      sendToLead,
    ],
  );

  // Stop streaming
  const handleStop = useCallback(() => {
    if (stopLeadRun()) return;
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
  }, [mainApi, streamingText, saveConversation, stopLeadRun]);

  // Auto-send an initial message once the chat is ready and empty.
  // Runs at most once per mount. Skipped if the conversation was
  // restored from persistence (messages already populated) or the
  // backend isn't ready yet.
  const initialMessageFiredRef = useRef(false);
  useEffect(() => {
    if (initialMessageFiredRef.current) return;
    if (!initialMessage) return;
    if (!mainApi?.llm) return;
    if (isLoading) return;
    if (messages.length !== 0) return;
    // CLI backend: wait for availability check to resolve.
    if (isCliBackend && cliAvailable === null) return;
    if (isCliBackend && !cliAvailable) return;
    initialMessageFiredRef.current = true;
    handleSend(initialMessage, { hidden: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialMessage,
    mainApi,
    messages,
    isCliBackend,
    cliAvailable,
    isLoading,
  ]);

  // Slice 19H — external "send this message" hook.
  //
  // Some parent components (the widget builder modal's "Send error to AI"
  // banner, the Console tab's per-error Send-to-AI button) need to push
  // a user message into THIS chat conversation without rendering the
  // input themselves. They dispatch a window CustomEvent named
  // `dash:chat-core-send` with `detail: { persistKey, content, hidden? }`.
  //
  // Each ChatCore instance only reacts to events targeting its own
  // persistKey OR sessionKey OR uuid — so the dashboard's AssistantPanel
  // and the widget builder's chat don't cross-talk.
  //
  // Why a CustomEvent (not localStorage poll, not ref): the prior
  // approach was for parent code to write to localStorage directly,
  // hoping ChatCore would notice. ChatCore reads localStorage only at
  // mount — so externally-written messages were silently dropped.
  // CustomEvent is one-way + synchronous + zero-cost when nobody fires
  // it, and stays consistent with the existing
  // `dash:open-settings-create-provider` / `dash:provider-installed` /
  // `dash:open-widget-builder` event bus used elsewhere in the app.
  useEffect(() => {
    const myKey = persistKey || sessionKey || uuid || null;
    if (!myKey) return;
    if (typeof window === "undefined") return;
    const handler = (event) => {
      const detail = event && event.detail;
      if (!detail) return;
      const targetKey =
        detail.persistKey || detail.sessionKey || detail.uuid || null;
      if (targetKey !== myKey) return;
      const content = detail.content;
      if (typeof content !== "string" || content.length === 0) return;
      // hidden defaults to false — the user typically WANTS to see the
      // error-fix request in the chat history so it's clear what was
      // sent and what the AI responded to.
      const hidden = detail.hidden === true;
      try {
        handleSend(content, { hidden });
      } catch (e) {
        // Sending may fail (no API key, no CLI). Swallow — the parent
        // can't recover beyond surfacing its own error state.
      }
    };
    window.addEventListener("dash:chat-core-send", handler);
    return () => window.removeEventListener("dash:chat-core-send", handler);
  }, [persistKey, sessionKey, uuid, handleSend]);

  // New chat
  const handleNewChat = () => {
    if (isLoading) handleStop();
    setMessages([]);
    setError(null);
    setStreamingText("");
    setSessionActive(false);
    // A new chat goes back to the Assistant (TEAM-013 AC5).
    setRecipient(null);
    recipientRef.current = null;
    setLeadNotice(null);
    saveConversation([]);
    // Allow the initial-message auto-send to re-fire on the fresh
    // empty conversation. Without this reset, the greeting only ever
    // appears once per mount, and New Chat leaves the panel blank.
    initialMessageFiredRef.current = false;

    if (isCliBackend && mainApi?.llm?.clearCliSession) {
      mainApi.llm.clearCliSession(uuid || persistKey || sessionKey);
    }
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
      {!hideToolsBanner &&
        isAnthropicBackend &&
        !hasTools &&
        apiKey &&
        messages.length === 0 && (
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
        isLoading={isLoading}
      />

      {/* Direct-to-lead recipient (TEAM-013) */}
      {enableLeadRecipients && leadNotice && (
        <div className="px-3 pt-2">
          <AlertBanner
            variant="warning"
            size="compact"
            message={leadNotice}
            onClose={() => setLeadNotice(null)}
          />
        </div>
      )}
      {enableLeadRecipients && (
        <RecipientPicker
          leads={leads}
          recipient={recipient}
          onChange={handleRecipientChange}
          disabled={isLoading}
        />
      )}

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
