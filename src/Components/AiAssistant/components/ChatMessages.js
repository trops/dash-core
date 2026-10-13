/**
 * ChatMessages
 *
 * Scrollable message list that auto-scrolls to the bottom on new messages.
 */
import { useEffect, useRef } from "react";
import { Caption2, ChatMessage } from "@trops/dash-react";
import { MessageBubble } from "./MessageBubble";

export const ChatMessages = ({
  messages,
  streamingRequestId,
  streamingText,
  isLoading = false,
  codeNote = null,
}) => {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <Caption2 block className="text-sm text-center">
          Send a message to start chatting
        </Caption2>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-3 scroll-smooth flex flex-col gap-3"
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
            codeNote={codeNote}
          />
        );
      })}
      {isLoading &&
        !streamingRequestId &&
        messages[messages.length - 1]?.role === "user" && (
          <ChatMessage role="reply" label="Assistant" streaming>
            Thinking...
          </ChatMessage>
        )}
    </div>
  );
};
