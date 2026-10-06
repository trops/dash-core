/**
 * StreamingText
 *
 * Renders partial text with a blinking cursor while streaming is active.
 * Shows "Thinking..." when streaming has started but no text has arrived yet.
 */
import { useContext } from "react";
import { ThemeContext } from "@trops/dash-react";

export const StreamingText = ({ text, isStreaming }) => {
  const { currentTheme } = useContext(ThemeContext) || {};
  const t = (key) => currentTheme?.[key] || "";
  if (!text && !isStreaming) return null;

  if (isStreaming && !text) {
    return (
      <span
        className={`flex items-center gap-2 text-sm opacity-70 ${t(
          "text-primary-medium",
        )}`}
      >
        <span className="inline-flex gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full animate-bounce ${t(
              "bg-secondary-medium",
            )}`}
            style={{ animationDelay: "0ms" }}
          />
          <span
            className={`w-1.5 h-1.5 rounded-full animate-bounce ${t(
              "bg-secondary-medium",
            )}`}
            style={{ animationDelay: "150ms" }}
          />
          <span
            className={`w-1.5 h-1.5 rounded-full animate-bounce ${t(
              "bg-secondary-medium",
            )}`}
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
        <span
          className={`inline-block w-2 h-4 ml-0.5 animate-pulse align-text-bottom ${t(
            "bg-secondary-medium",
          )}`}
        />
      )}
    </span>
  );
};
