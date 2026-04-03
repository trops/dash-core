/**
 * MessageBubble
 *
 * Renders a single message — user, assistant (with markdown), or tool-use blocks.
 * Includes role labels for clear visual differentiation.
 */
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

export const MessageBubble = ({ message, isStreaming, streamingText }) => {
  const { role, content, toolCalls } = message;

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
      <div className="mb-4 pt-3 border-t border-gray-700/30">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400 mb-1.5">
          You
        </div>
        <div className="text-sm text-gray-100 whitespace-pre-wrap break-words leading-relaxed">
          {text}
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

    const text = textParts.join("");

    return (
      <div className="mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
          Assistant
        </div>
        <div className="text-sm leading-relaxed">
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
