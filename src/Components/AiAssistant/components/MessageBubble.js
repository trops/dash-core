/**
 * MessageBubble
 *
 * Renders a single message — user, assistant (with markdown), or tool-use blocks.
 * Includes role labels for clear visual differentiation.
 */
import { useContext } from "react";
import { ThemeContext } from "@trops/dash-react";
import { StreamingText } from "./StreamingText";
import { ToolCallBlock } from "./ToolCallBlock";
import { marked } from "marked";

function AssistantTextContent({ text }) {
  if (!text) return null;

  const html = marked(text, { breaks: true });

  return (
    <div
      className="prose prose-invert prose-sm max-w-none
                prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2
                prose-li:my-0.5
                prose-pre:bg-black/40 prose-pre:text-gray-300 prose-code:text-indigo-300
                prose-a:text-indigo-400 leading-relaxed"
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
  // Prefer theme-provided panel colors so assistant chrome follows the
  // active app theme. Fall back to the original muted neutral if no
  // theme is in scope.
  const bubbleBg =
    currentTheme?.["bg-secondary-dark"] ||
    currentTheme?.["bg-primary-dark"] ||
    "bg-gray-800/40";
  const userBubbleBg =
    currentTheme?.["bg-primary-bright"] ||
    currentTheme?.["bg-primary"] ||
    "bg-indigo-700/40";

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
        <div className="max-w-[85%]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400 mb-1 text-right">
            You
          </div>
          <div
            className={`px-3 py-2 rounded-lg text-sm text-gray-100 whitespace-pre-wrap break-words leading-relaxed ${userBubbleBg}`}
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
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Assistant
            </div>
            <div
              className={`text-sm leading-relaxed px-3 py-2 rounded-lg text-gray-500 italic ${bubbleBg}`}
            >
              Thinking...
            </div>
          </div>
        );
      }
      return null;
    }

    return (
      <div className="mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
          Assistant
        </div>
        <div
          className={`text-sm leading-relaxed px-3 py-2 rounded-lg ${bubbleBg}`}
        >
          {isStreaming && (
            <div className="text-gray-200">
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

  return null;
};
