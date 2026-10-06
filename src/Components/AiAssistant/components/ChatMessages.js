/**
 * ChatMessages
 *
 * Scrollable message list that auto-scrolls to the bottom on new messages.
 */
import { useContext, useEffect, useRef } from "react";
import { Caption2, ThemeContext } from "@trops/dash-react";
import { MessageBubble } from "./MessageBubble";

export const ChatMessages = ({
  messages,
  streamingRequestId,
  streamingText,
  isLoading = false,
}) => {
  const scrollRef = useRef(null);
  const { currentTheme } = useContext(ThemeContext) || {};
  const t = (key) => currentTheme?.[key] || "";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-1">
          <div className="text-2xl">{"\u{1F4AC}"}</div>
          <Caption2 block className="text-sm">
            Send a message to start chatting
          </Caption2>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-3 scroll-smooth"
    >
      {messages.map((message, index) => {
        const isLastAssistant =
          message.role === "assistant" && index === messages.length - 1;
        const isStreaming = isLastAssistant && streamingRequestId !== null;

        return (
          <MessageBubble
            key={message.id || index}
            message={message}
            isStreaming={isStreaming}
            streamingText={isStreaming ? streamingText : ""}
            isLast={index === messages.length - 1}
          />
        );
      })}
      {isLoading &&
        !streamingRequestId &&
        messages[messages.length - 1]?.role === "user" && (
          <div className="mb-4">
            <Caption2
              block
              className="font-semibold uppercase tracking-wider mb-1"
            >
              Assistant
            </Caption2>
            <div
              className={`text-sm leading-relaxed px-3 py-2 rounded-lg italic flex items-center gap-2 opacity-70 ${t(
                "bg-primary-dark",
              )} ${t("text-primary-medium")}`}
            >
              <span className="inline-flex gap-0.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full animate-bounce ${t(
                    "bg-primary-medium",
                  )}`}
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className={`w-1.5 h-1.5 rounded-full animate-bounce ${t(
                    "bg-primary-medium",
                  )}`}
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className={`w-1.5 h-1.5 rounded-full animate-bounce ${t(
                    "bg-primary-medium",
                  )}`}
                  style={{ animationDelay: "300ms" }}
                />
              </span>
              Thinking...
            </div>
          </div>
        )}
    </div>
  );
};
