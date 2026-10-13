/**
 * MessageBubble
 *
 * Renders a single message — user, assistant (with markdown), lead answer —
 * through dash-react's ChatMessage, with tool calls as ChatToolCall rows
 * (design guide: one chat everywhere).
 */
import { ChatMessage, useStatusTokens } from "@trops/dash-react";
import { leadLabel } from "../leadMessages";
import { StreamingText } from "./StreamingText";
import { ToolCallBlock } from "./ToolCallBlock";
import { renderSafeMarkdown } from "../../../utils/safeMarkdown";
import { collapseCodeBlocks } from "../codeBlocks";

function AssistantTextContent({ text }) {
  if (!text) return null;

  // Sanitized: replies can quote untrusted content (emails, web pages), and
  // this HTML is inserted into the app window.
  const html = renderSafeMarkdown(text);

  return (
    <div
      className="prose prose-sm max-w-none
                prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2
                prose-li:my-0.5 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export const MessageBubble = ({
  message,
  isStreaming,
  streamingText,
  isLast = false,
  // When set, code blocks in assistant replies show as this one-line note
  // (ChatCore hideCodeBlocks).
  codeNote = null,
}) => {
  const { role, content, toolCalls, hidden } = message;
  const statusTokens = useStatusTokens();

  // App-injected priming messages (e.g. widget-builder "Hello…" seed)
  // are kept in state for conversation continuity but suppressed from
  // the rendered timeline — the user sees only the agent's reply.
  if (hidden) return null;

  if (role === "user") {
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("")
          : "";

    return (
      <ChatMessage role="you" testId="user-bubble">
        {message.to ? (
          <span className="block text-xs opacity-70 mb-0.5">
            To {leadLabel(message.to)}
          </span>
        ) : null}
        {text}
      </ChatMessage>
    );
  }

  if (role === "assistant") {
    const textParts = [];
    const toolBlocks = [];

    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          const callInfo = toolCalls?.find((tc) => tc.toolUseId === block.id);
          toolBlocks.push({
            ...block,
            serverName: callInfo?.serverName,
            result: callInfo?.result,
            isError: callInfo?.isError,
            isLoading: callInfo?.isLoading,
          });
        }
      }
    } else if (typeof content === "string") {
      textParts.push(content);
    }

    // Fallback: CLI backend (Claude Code) tracks tool calls on the
    // message's `toolCalls` field without placing tool_use blocks in
    // `content`. If we found no tool blocks in content but have toolCalls,
    // render those directly so the user sees what Claude is doing.
    if (toolBlocks.length === 0 && Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        toolBlocks.push({
          id: tc.toolUseId,
          name: tc.toolName,
          input: tc.input,
          serverName: tc.serverName,
          result: tc.result,
          isError: tc.isError,
          isLoading: tc.isLoading,
        });
      }
    }

    const text = textParts.join("");

    // Hide empty assistant bubbles (tool-use-only responses from the
    // CLI backend). But if this is the LAST message, show a thinking
    // indicator so the user knows the AI is working.
    if (!isStreaming && !text && toolBlocks.length === 0) {
      if (isLast) {
        return (
          <ChatMessage role="reply" label="Assistant" streaming>
            Thinking...
          </ChatMessage>
        );
      }
      return null;
    }

    return (
      <div className="flex flex-col gap-2">
        {toolBlocks.map((block) => (
          <ToolCallBlock
            key={block.id}
            toolName={block.name}
            serverName={block.serverName}
            input={block.input}
            result={block.result}
            isError={block.isError}
            isLoading={block.isLoading}
          />
        ))}
        {isStreaming || text ? (
          <ChatMessage
            role="reply"
            label="Assistant"
            streaming={isStreaming && !streamingText}
          >
            {isStreaming ? (
              <StreamingText
                text={
                  codeNote
                    ? collapseCodeBlocks(streamingText, codeNote, {
                        plain: true,
                      })
                    : streamingText
                }
                isStreaming={true}
              />
            ) : (
              <AssistantTextContent
                text={codeNote ? collapseCodeBlocks(text, codeNote) : text}
              />
            )}
          </ChatMessage>
        ) : null}
      </div>
    );
  }

  // A team lead's direct answer (bot-teams TEAM-013), labelled with the
  // lead and its dashboard.
  if (role === "lead") {
    const text = typeof content === "string" ? content : textOfContent(content);
    return (
      <ChatMessage
        role="reply"
        label={leadLabel(message.from)}
        streaming={!!message.streaming && !text}
        testId="lead-bubble"
      >
        {message.error ? (
          <span className={statusTokens.error.icon}>{message.error}</span>
        ) : text ? (
          <AssistantTextContent text={text} />
        ) : (
          <span className="italic">
            {message.streaming ? "Working…" : "No answer."}
          </span>
        )}
      </ChatMessage>
    );
  }

  return null;
};

function textOfContent(content) {
  return Array.isArray(content)
    ? content
        .filter((c) => c && c.type === "text")
        .map((c) => c.text)
        .join("")
    : "";
}
