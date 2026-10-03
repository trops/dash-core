import React, { useEffect, useRef, useState } from "react";
import { Button, Button3, InputText } from "@trops/dash-react";
import { appendAnswerText } from "../../utils/answerText";

/**
 * AskLead — chat with a dashboard's team lead (bot-teams PRD TEAM-003).
 *
 * The first question starts a new conversation; follow-ups continue it (the
 * lead's session is resumed). The answer streams in as the lead works, then
 * settles to the run's final answer. Each question is a lead run with
 * trigger "ask" in the Activity feed.
 *
 * Answers are shown as plain text — never rendered as HTML — because they
 * can quote email or web content. Leftover Markdown markers are stripped.
 *
 * @param {{ id: string, name: string }} lead
 */
const plainText = (text) =>
  String(text || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");

export const AskLead = ({ lead }) => {
  const [messages, setMessages] = useState([]); // { role, text, error? }
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(null); // streaming answer text
  const [asking, setAsking] = useState(false);
  const pendingRef = useRef("");
  // A tool call since the last text → the next text starts a new paragraph.
  const afterToolRef = useRef(false);

  // Live answer text for this lead only.
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.mainApi : null;
    if (!api?.bots?.onStream || !lead) return undefined;
    const id = api.bots.onStream(({ botId, event }) => {
      if (botId !== lead.id || !event) return;
      if (event.type === "tool_call") afterToolRef.current = true;
      if (event.type !== "text") return;
      pendingRef.current = appendAnswerText(pendingRef.current, event.text, {
        afterTool: afterToolRef.current,
      });
      afterToolRef.current = false;
      setPending(pendingRef.current);
    });
    return () => {
      if (api.bots.removeListener) api.bots.removeListener(id);
    };
  }, [lead]);

  const send = async () => {
    const q = question.trim();
    if (!q || asking || !lead) return;
    const continueConversation = messages.length > 0;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    setAsking(true);
    pendingRef.current = "";
    setPending("");
    try {
      const record = await window.mainApi.bots.askLead(
        lead.id,
        q,
        continueConversation,
      );
      if (!record || record.status === "failed" || record.error) {
        setMessages((m) => [
          ...m,
          {
            role: "lead",
            error: true,
            text: `The lead couldn't answer: ${(record && record.error) || "unknown error"}`,
          },
        ]);
      } else if (record.skipped) {
        setMessages((m) => [
          ...m,
          {
            role: "lead",
            error: true,
            text: "The lead is still answering your last question.",
          },
        ]);
      } else {
        const text = record.output || pendingRef.current || "(no answer)";
        setMessages((m) => [...m, { role: "lead", text }]);
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "lead",
          error: true,
          text: `The lead couldn't answer: ${e.message || String(e)}`,
        },
      ]);
    } finally {
      setAsking(false);
      setPending(null);
    }
  };

  const reset = () => {
    setMessages([]);
    setPending(null);
    pendingRef.current = "";
  };

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="flex flex-col gap-2 overflow-y-auto min-h-0">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}
          >
            <span className="text-xs opacity-50">
              {m.role === "user" ? "You" : lead.name}
            </span>
            <span
              className={`text-sm whitespace-pre-wrap ${m.error ? "opacity-70" : ""}`}
            >
              {m.role === "lead" ? plainText(m.text) : m.text}
            </span>
          </div>
        ))}
        {asking ? (
          <div className="flex flex-col gap-1 items-start">
            <span className="text-xs opacity-50">{lead.name}</span>
            <span className="text-sm whitespace-pre-wrap opacity-80">
              {pending ? plainText(pending) : "Thinking…"}
            </span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-row items-center gap-2">
        <div className="flex-1">
          <InputText
            value={question}
            onChange={setQuestion}
            placeholder="Ask the lead about this team…"
          />
        </div>
        <Button
          title="Ask"
          size="sm"
          onClick={send}
          disabled={!question.trim() || asking}
        />
        {messages.length ? (
          <Button3 title="New conversation" size="xs" onClick={reset} />
        ) : null}
      </div>
    </div>
  );
};
