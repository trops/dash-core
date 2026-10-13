/**
 * ChatInput
 *
 * The AI Assistant's message box, on dash-react's ChatComposer: Enter sends,
 * Shift+Enter is a new line, plus the @-lead menu and queued sends.
 */
import { useState, useRef, useEffect } from "react";
import { ChatComposer } from "@trops/dash-react";
import { LeadMentionMenu } from "./LeadMentionMenu";
import { filterRecipients } from "../leadMessages";

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

export const ChatInput = ({
  onSend,
  onStop,
  isLoading,
  disabled,
  // @ shortcut (bot-teams TEAM-013 AC6). Only the AI Assistant passes
  // these; without onPickRecipient an "@" is just text (widget chats,
  // Slack-style @mentions).
  leads = null,
  onPickRecipient = null,
  // The "To:" picker: part of composing, so it sits inside the message box
  // above the field, spaced by the box's own padding.
  recipientPicker = null,
}) => {
  const [input, setInput] = useState("");
  const textareaRef = useRef(null);

  // The @ list is open while the box starts with "@" (and wasn't dismissed
  // with Esc); the text after "@" filters it.
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionOn = !!onPickRecipient && Array.isArray(leads);
  const mentionOpen = mentionOn && input.startsWith("@") && !mentionDismissed;
  const mentionOptions = mentionOpen
    ? filterRecipients(leads, input.slice(1))
    : [];

  const pickMention = (option) => {
    onPickRecipient(option && !option.isAssistant ? option : null);
    setInput("");
    setMentionIndex(0);
    setMentionDismissed(false);
  };

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
    const value = e.target.value;
    setInput(value);
    // Clearing the box cancels a queued message.
    if (!value.trim()) setQueued(false);
    // A fresh "@" (or a changed filter) re-opens the list from the top.
    if (!value.startsWith("@")) setMentionDismissed(false);
    setMentionIndex(0);
  };

  const handleKeyDown = (e) => {
    if (mentionOpen) {
      const count = mentionOptions.length;
      if (e.key === "ArrowDown" && count) {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % count);
        return;
      }
      if (e.key === "ArrowUp" && count) {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + count) % count);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(true);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        if (count) pickMention(mentionOptions[mentionIndex] || null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <ChatComposer
      ref={textareaRef}
      value={input}
      onChange={(_value, e) => handleChange(e)}
      onKeyDown={handleKeyDown}
      onSend={handleSend}
      onStop={onStop}
      busy={!!isLoading}
      disabled={disabled}
      rows={1}
      placeholder="Type a message..."
      hint={
        queued
          ? "Sends when the current reply finishes"
          : "Enter to send · Shift+Enter for a new line"
      }
      above={
        recipientPicker || mentionOpen ? (
          <>
            {recipientPicker}
            {mentionOpen ? (
              <LeadMentionMenu
                options={mentionOptions}
                activeIndex={mentionIndex}
                onPick={pickMention}
              />
            ) : null}
          </>
        ) : null
      }
    />
  );
};
