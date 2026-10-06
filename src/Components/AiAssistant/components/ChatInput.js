/**
 * ChatInput
 *
 * Input bar with send button. Supports Enter to send, Shift+Enter for newline.
 */
import { useState, useRef, useEffect } from "react";

// When the panel mounts while hidden/collapsed, scrollHeight is 0 — pinning
// that as an inline height collapses the input to a sliver, so leave the
// natural (rows=1) height until it can actually be measured.
const autoResize = (el) => {
  if (!el) return;
  el.style.height = "auto";
  if (el.scrollHeight === 0) {
    el.style.height = "";
    return;
  }
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
};

export const ChatInput = ({ onSend, onStop, isLoading, disabled }) => {
  const [input, setInput] = useState("");
  const textareaRef = useRef(null);

  // Auto-resize; re-measure once the input's container actually gets laid
  // out (e.g. the panel is expanded).
  useEffect(() => {
    autoResize(textareaRef.current);
  }, [input]);

  useEffect(() => {
    const el = textareaRef.current;
    const parent = el?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => autoResize(el));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  // Enter/Send while a reply is still coming in (e.g. the panel's hidden
  // greeting right after it opens) queues the message instead of dropping
  // it; it goes out — with any edits made meanwhile — once the reply ends.
  const [queued, setQueued] = useState(false);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (isLoading) {
      setQueued(true);
      return;
    }
    // onSend returns false when it refused the message (e.g. the chosen
    // team lead is paused) — keep the text so the user can resend it.
    if (onSend(trimmed) === false) return;
    setInput("");
  };

  useEffect(() => {
    if (!queued || isLoading) return;
    setQueued(false);
    const trimmed = input.trim();
    if (!trimmed) return;
    if (onSend(trimmed) === false) return;
    setInput("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, queued]);

  const handleChange = (e) => {
    setInput(e.target.value);
    // Clearing the box cancels a queued message.
    if (!e.target.value.trim()) setQueued(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col gap-1 px-3 py-2 border-t border-gray-700/50">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-50"
        />
        {isLoading ? (
          <button
            onClick={onStop}
            className="px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors shrink-0"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim() || disabled}
            className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
          >
            Send
          </button>
        )}
      </div>
      {queued && (
        <span className="text-xs text-gray-500">
          Sends when the current reply finishes
        </span>
      )}
    </div>
  );
};
