import React, { useEffect, useRef, useState } from "react";
import { Button, Button3, TextArea } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { runTeamRole } from "../../utils/teamRoles";
import { extractPlan } from "../../utils/teamPlan";
import { runCostLabel } from "../../utils/runCostLabel";
import { withoutPlan } from "./CreatePlanStep";
import { YouBubble, TeamBubble } from "./ChatBubbles";
import {
  questionRequest,
  reopenedQuestion,
  hasPlan,
  planSeed,
} from "./askThread";

/**
 * AskStep — a question to the Dash team's Planner (create-entry PRD CRE-007
 * AC4 / CRE-011 AC6, phase 5e). It reads the user's bot results and runs
 * (bot_results / bot_runs) and answers; follow-ups carry on. Kept in Recent
 * as a "question". When an answer plans something, Open as a plan starts
 * Create from it (`onOpenPlan(seed)`).
 *
 * New: `question`. Reopened from Recent: `recentId`.
 */
export const AskStep = ({
  question = "",
  recentId = null,
  onOpenPlan = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  // [{ who: "you" | "planner" | "note", text, meta?, plan? }]
  const [messages, setMessages] = useState(
    recentId ? [] : [{ who: "you", text: question }],
  );
  const [busy, setBusy] = useState(!recentId);
  const [soFar, setSoFar] = useState("");
  const [reply, setReply] = useState("");
  const [loaded, setLoaded] = useState(!recentId);
  const askId = useRef(recentId);
  const reopened = useRef(false);
  const started = useRef(false);
  const alive = useRef(true);
  const firstAsked = useRef(question);

  const note = (text) => setMessages((m) => [...m, { who: "note", text }]);

  const ask = async (text, continueConversation, history) => {
    setBusy(true);
    setSoFar("");
    let request = questionRequest(text);
    let cont = continueConversation;
    if (reopened.current) {
      reopened.current = false;
      cont = false;
      request = reopenedQuestion(history, text);
    }
    const res = await runTeamRole("planner", request, {
      continueConversation: cont,
      planId: askId.current,
      onText: (t) => alive.current && setSoFar(t),
    });
    if (!alive.current) return;
    setBusy(false);
    setSoFar("");
    if (res.skipped) {
      note(
        `Can't answer right now: ${res.reason}. Resume the Planner on the Bots page › Dash team.`,
      );
      return;
    }
    if (res.status === "failed") {
      note(`The Planner couldn't answer: ${res.error || "unknown error"}`);
      return;
    }
    const plan = extractPlan(res.output);
    setMessages((m) => [
      ...m,
      {
        who: "planner",
        text: withoutPlan(res.output) || (plan ? plan.summary : "(no answer)"),
        meta: runCostLabel(res),
        ...(hasPlan(plan) ? { plan, asked: text } : {}),
      },
    ]);
  };

  useEffect(() => {
    alive.current = true;
    if (!started.current) {
      started.current = true;
      const bots = window.mainApi && window.mainApi.bots;
      if (recentId) {
        Promise.resolve(bots && bots.getCreateRecent(recentId))
          .then((entry) => {
            if (!alive.current) return;
            const conv = (entry && entry.conversation) || {};
            firstAsked.current = (entry && entry.prompt) || "";
            setMessages(
              Array.isArray(conv.messages) && conv.messages.length
                ? conv.messages
                : [{ who: "you", text: firstAsked.current }],
            );
            if (!entry) note("This conversation isn't in Recent any more.");
            reopened.current = true;
            setLoaded(true);
          })
          .catch(() => {
            if (!alive.current) return;
            reopened.current = true;
            setLoaded(true);
          });
      } else {
        // Kept in Recent from the start; its id is the memory scope too.
        Promise.resolve(
          bots && bots.saveCreateRecent
            ? bots.saveCreateRecent({ kind: "question", prompt: question })
            : null,
        )
          .then((res) => {
            if (res && res.id) askId.current = res.id;
          })
          .catch(() => {})
          .then(() => alive.current && ask(question, false, []));
      }
    }
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saved as it goes, like a plan conversation.
  useEffect(() => {
    if (!loaded || !askId.current) return undefined;
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots || !bots.saveCreateRecent) return undefined;
    const t = setTimeout(() => {
      Promise.resolve(
        bots.saveCreateRecent({
          id: askId.current,
          conversation: { messages },
        }),
      ).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [loaded, messages]);

  const send = (text) => {
    const t = String(text || "").trim();
    if (!t || busy) return;
    const history = messages;
    setReply("");
    setMessages((m) => [...m, { who: "you", text: t }]);
    ask(t, true, history);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="ask-step">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-3 px-3 py-3">
          {messages.map((m, i) =>
            m.who === "you" ? (
              <YouBubble key={i}>{m.text}</YouBubble>
            ) : m.who === "note" ? (
              <span key={i} className={`text-xs ${muted}`}>
                {m.text}
              </span>
            ) : (
              <TeamBubble
                key={i}
                meta={m.meta}
                testId="ask-answer"
                footer={
                  m.plan && onOpenPlan ? (
                    <div>
                      <Button3
                        size="sm"
                        title="Open as a plan"
                        onClick={() => onOpenPlan(planSeed(m.asked, m.plan))}
                      />
                    </div>
                  ) : null
                }
              >
                {m.text}
              </TeamBubble>
            ),
          )}
          {busy ? (
            <TeamBubble muted>{withoutPlan(soFar) || "Looking…"}</TeamBubble>
          ) : null}
        </div>
      </div>
      <div
        className={`flex-shrink-0 flex flex-row items-end gap-2 px-3 py-2 border-t ${hairline}`}
      >
        <div className="flex-1">
          <TextArea
            aria-label="Ask a follow-up"
            value={reply}
            onChange={(v) => setReply(v)}
            placeholder={busy ? "The Planner is looking…" : "Ask a follow-up…"}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(reply);
              }
            }}
          />
        </div>
        <Button
          title="Send"
          onClick={() => send(reply)}
          disabled={busy || !reply.trim()}
        />
      </div>
    </div>
  );
};

export default AskStep;
