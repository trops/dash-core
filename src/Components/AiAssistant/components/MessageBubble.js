/**
 * MessageBubble
 *
 * Renders a single message — user, assistant (with markdown), or tool-use blocks.
 * Includes role labels for clear visual differentiation.
 */
import { useContext } from "react";
import { Caption2, ThemeContext, useStatusTokens } from "@trops/dash-react";
import { leadLabel } from "../leadMessages";
import { StreamingText } from "./StreamingText";
import { ToolCallBlock } from "./ToolCallBlock";
import { renderSafeMarkdown } from "../../../utils/safeMarkdown";

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
}) => {
  const { role, content, toolCalls, hidden } = message;
  const { currentTheme } = useContext(ThemeContext) || {};
  const statusTokens = useStatusTokens();
  // Theme-provided colors so the chat follows the active light/dark
  // theme. No hardcoded fallbacks — they only read correctly on dark.
  const bubbleBg =
    currentTheme?.["bg-secondary-dark"] ||
    currentTheme?.["bg-primary-dark"] ||
    "";
  // The user's bubble uses the primary surface so it stands apart from the
  // Assistant/lead bubbles (secondary). "bg-primary-medium" is a real
  // ThemeModel key; the old "bg-primary-bright"/"bg-primary" don't exist,
  // which left the user's text with no bubble at all.
  const userBubbleBg = currentTheme?.["bg-primary-medium"] || "";
  const bubbleText = currentTheme?.["text-primary-medium"] || "";

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
      <div className="flex justify-end mb-4">
        <div className="max-w-md">
          <Caption2
            block
            className="font-semibold uppercase tracking-wider mb-1 text-right"
          >
            {message.to ? `You → ${leadLabel(message.to)}` : "You"}
          </Caption2>
          <div
            className={`px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words leading-relaxed ${userBubbleBg} ${bubbleText}`}
          >
            {text}
          </div>
        </div>
      </div>
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
          <div className="mb-4">
            <Caption2
              block
              className="font-semibold uppercase tracking-wider mb-1"
            >
              Assistant
            </Caption2>
            <div
              className={`text-sm leading-relaxed px-3 py-2 rounded-lg ${bubbleBg}`}
            >
              <Caption2 className="italic">Thinking...</Caption2>
            </div>
          </div>
        );
      }
      return null;
    }

    return (
      <div className="mb-4">
        <Caption2 block className="font-semibold uppercase tracking-wider mb-1">
          Assistant
        </Caption2>
        <div
          className={`text-sm leading-relaxed px-3 py-2 rounded-lg ${bubbleBg} ${bubbleText}`}
        >
          {isStreaming && (
            <div>
              <StreamingText text={streamingText} isStreaming={true} />
            </div>
          )}
          {!isStreaming && text && <AssistantTextContent text={text} />}
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
        </div>
      </div>
    );
  }

  // A team lead's direct answer (bot-teams TEAM-013), labelled with the
  // lead and its dashboard.
  if (role === "lead") {
    const text = typeof content === "string" ? content : textOfContent(content);
    return (
      <div className="mb-4" data-testid="lead-bubble">
        <Caption2 block className="font-semibold uppercase tracking-wider mb-1">
          {leadLabel(message.from)}
        </Caption2>
        <div
          className={`text-sm leading-relaxed px-3 py-2 rounded-lg ${bubbleBg} ${bubbleText}`}
        >
          {message.error ? (
            <span className={statusTokens.error.icon}>{message.error}</span>
          ) : text ? (
            <AssistantTextContent text={text} />
          ) : (
            <Caption2 className="italic">
              {message.streaming ? "Working…" : "No answer."}
            </Caption2>
          )}
        </div>
      </div>
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
