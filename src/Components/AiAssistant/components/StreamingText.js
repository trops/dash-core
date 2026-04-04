/**
 * StreamingText
 *
 * Renders partial text with a blinking cursor while streaming is active.
 * Shows "Thinking..." when streaming has started but no text has arrived yet.
 */
export const StreamingText = ({ text, isStreaming }) => {
  if (!text && !isStreaming) return null;

  if (isStreaming && !text) {
    return (
      <span className="flex items-center gap-2 text-gray-400 text-sm">
        <span className="inline-flex gap-1">
          <span
            className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </span>
        Thinking...
      </span>
    );
  }

  return (
    <span className="whitespace-pre-wrap break-words">
      {text}
      {isStreaming && (
        <span className="inline-block w-2 h-4 ml-0.5 bg-indigo-400 animate-pulse align-text-bottom" />
      )}
    </span>
  );
};
