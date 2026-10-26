import React, { useEffect, useRef, useState } from "react";
import { Button, Button3, ChatComposer, ChatMessage } from "@trops/dash-react";
import { runTeamRole } from "../../utils/teamRoles";
import { askTeamLead } from "../../utils/leadAsk";
import { useTeamLeads } from "../AiAssistant/components/RecipientPicker";
import { leadLabel } from "../AiAssistant/leadMessages";
import { readableError } from "../Bots/botConversation";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { extractPlan } from "../../utils/teamPlan";
import { runCostLabel } from "../../utils/runCostLabel";
import { withoutPlan } from "./CreatePlanStep";
import { extractHandoff, withoutHandoff } from "../../utils/handoff";
import { planWithDashTeam } from "../../utils/openCreate";
import {
  questionRequest,
  leadQuestion,
  reopenedQuestion,
  hasPlan,
  handoverSeed,
} from "./askThread";

/**
 * AskStep — a question to the Dash team's Planner (create-entry PRD CRE-007
 * AC4 / CRE-011 AC6, phase 5e). It reads the user's bot results and runs
 * (bot_results / bot_runs) and answers; follow-ups carry on. Saved
 * as a "question". When an answer plans something (or asks the questions a
 * plan needs), Create takes over at once with the conversation so far
 * (`onOpenPlan(seed)`); a reopened answer's Open as a plan does the same.
 *
 * Asked of a team lead instead (5e-2a, the Ask box's "To:"): `recipient` is
 * the lead ({ botId, leadName, dashboardName, dashboardLabel }); the question
 * goes straight to it (bots.askLead) and the conversation stays with it,
 * saved with the conversation so a reopened one carries on with the lead.
 *
 * A lead asked to make something hands it to the Dash team (consolidation
 * Phase 2c-2): its answer shows "Plan this with the Dash team" — here in
 * Create, `onHandoff(handoff, lead)` starts it; elsewhere (the dock) it opens
 * Create.
 *
 * New: `question` (+ `recipient`). Reopened from Recent: `recentId`.
 * `onStarted(id)` says which Recent entry a new question was saved as (the
 * Dash team's conversation list selects it, Phase 4a).
 */
export const AskStep = ({
  question = "",
  recentId = null,
  recipient = null,
  onOpenPlan = null,
  onHandoff = null,
  onStarted = null,
}) => {
  // [{ who: "you" | "planner" | "lead" | "note", text, meta?, plan? }]
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
  // The lead this conversation is with (null = the Dash team's Planner).
  const [lead, setLead] = useState(recipient);
  const leadRef = useRef(recipient);
  // Live state (paused / over budget / running) for the availability check.
  const { leads } = useTeamLeads(!!lead);
  const leadsRef = useRef(leads);
  leadsRef.current = leads;
  const { muted } = useConfigTokens();
  // The lead's name on its replies; the To: line names the dashboard.
  const replyLabel = lead ? lead.leadName : "Planner";
  const replyName = lead ? lead.leadName : "the Planner";

  // The conversation as it stands, for an answer that lands after this step
  // has closed (Create's Back / Close, Phase 2a).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Show a reply — or, once closed, save it to Recent so it isn't lost.
  const add = (msg) => {
    if (alive.current) {
      setMessages((m) => [...m, msg]);
      return;
    }
    const bots = window.mainApi && window.mainApi.bots;
    if (!askId.current || !bots || !bots.saveCreateRecent) return;
    messagesRef.current = [...messagesRef.current, msg];
    Promise.resolve(
      bots.saveCreateRecent({
        id: askId.current,
        conversation: { messages: messagesRef.current },
      }),
    ).catch(() => {});
  };
  const note = (text) => add({ who: "note", text });

  const ask = async (text, continueConversation, history) => {
    setBusy(true);
    setSoFar("");
    const to = leadRef.current;
    const wrap = to ? leadQuestion : questionRequest;
    let request = wrap(text);
    let cont = continueConversation;
    if (reopened.current) {
      reopened.current = false;
      cont = false;
      request = reopenedQuestion(history, text, 6, wrap);
    }
    const onText = (t) => alive.current && setSoFar(t);
    let res;
    if (to) {
      // Live state when the lead list has it (it may have been paused).
      const live =
        (leadsRef.current || []).find((l) => l.botId === to.botId) || to;
      res = await askTeamLead(live, request, {
        continueConversation: cont,
        onText,
      });
    } else {
      res = await runTeamRole("planner", request, {
        continueConversation: cont,
        planId: askId.current,
        onText,
      });
    }
    if (alive.current) {
      setBusy(false);
      setSoFar("");
    }
    if (res.skipped) {
      note(
        to
          ? res.reason
          : `Can't answer right now: ${res.reason}. Turn the Planner on in the Bots page › Dash team.`,
      );
      return;
    }
    if (res.status === "failed") {
      note(
        to
          ? readableError(String(res.error || "")) ||
              `${to.leadName} couldn't answer.`
          : `The Planner couldn't answer: ${res.error || "unknown error"}`,
      );
      return;
    }
    if (to) {
      const handoff = extractHandoff(res.output);
      add({
        who: "lead",
        text: withoutHandoff(res.output) || "(no answer)",
        meta: runCostLabel(res),
        ...(handoff ? { handoff } : {}),
      });
      return;
    }
    const plan = extractPlan(res.output);
    const msg = {
      who: "planner",
      text: withoutPlan(res.output) || (plan ? plan.summary : "(no answer)"),
      meta: runCostLabel(res),
      ...(hasPlan(plan) ? { plan, asked: text } : {}),
    };
    add(msg);
    // An answer that plans (or asks what a plan needs) moves on to Create:
    // its questions are taps there, and Build is there.
    if (hasPlan(plan) && onOpenPlan && alive.current) {
      const all = [...messagesRef.current, msg];
      // Saved now: the host closes this step before it renders the answer,
      // so the as-it-goes save wouldn't see it.
      const bots = window.mainApi && window.mainApi.bots;
      if (askId.current && bots && bots.saveCreateRecent) {
        Promise.resolve(
          bots.saveCreateRecent({
            id: askId.current,
            conversation: { messages: all },
          }),
        ).catch(() => {});
      }
      onOpenPlan(handoverSeed(all, plan));
    }
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
            if (conv.recipient && conv.recipient.botId) {
              leadRef.current = conv.recipient;
              setLead(conv.recipient);
            }
            setMessages(
              Array.isArray(conv.messages) && conv.messages.length
                ? conv.messages
                : [{ who: "you", text: firstAsked.current }],
            );
            if (!entry) note("This conversation isn't saved any more.");
            reopened.current = true;
            setLoaded(true);
          })
          .catch(() => {
            if (!alive.current) return;
            reopened.current = true;
            setLoaded(true);
          });
      } else {
        // Saved from the start; its id is the memory scope too.
        Promise.resolve(
          bots && bots.saveCreateRecent
            ? bots.saveCreateRecent({
                kind: "question",
                prompt: question,
                ...(recipient ? { conversation: { recipient } } : {}),
              })
            : null,
        )
          .then((res) => {
            if (res && res.id) {
              askId.current = res.id;
              if (onStarted && alive.current) onStarted(res.id);
            }
          })
          .catch(() => {})
          // Asked even if closed meanwhile: the answer is saved to Recent
          // (add), so a reopened question isn't left unanswered.
          .then(() => ask(question, false, []));
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
              <ChatMessage key={i} role="you">
                {m.text}
              </ChatMessage>
            ) : m.who === "note" ? (
              <ChatMessage key={i} role="note">
                {m.text}
              </ChatMessage>
            ) : (
              <ChatMessage
                key={i}
                role="reply"
                label={m.who === "lead" ? replyLabel : "Planner"}
                meta={m.meta}
                testId="ask-answer"
                footer={
                  m.handoff && lead ? (
                    <Button
                      size="sm"
                      title="Plan this with the Dash team"
                      onClick={() =>
                        onHandoff
                          ? onHandoff(m.handoff, lead)
                          : planWithDashTeam(m.handoff, {
                              workspaceId: lead.dashboardId ?? null,
                              from: lead.leadName,
                            })
                      }
                    />
                  ) : m.plan && onOpenPlan ? (
                    <Button3
                      size="sm"
                      title="Open as a plan"
                      onClick={() =>
                        onOpenPlan(
                          handoverSeed(messages.slice(0, i + 1), m.plan),
                        )
                      }
                    />
                  ) : null
                }
              >
                <span className="whitespace-pre-wrap">{m.text}</span>
              </ChatMessage>
            ),
          )}
          {busy ? (
            <ChatMessage role="reply" label={replyLabel} streaming>
              <span className="whitespace-pre-wrap">
                {(lead ? withoutHandoff(soFar) : withoutPlan(soFar)) ||
                  "Looking…"}
              </span>
            </ChatMessage>
          ) : null}
        </div>
      </div>
      <ChatComposer
        ariaLabel="Ask a follow-up"
        value={reply}
        onChange={(v) => setReply(v)}
        onSend={() => send(reply)}
        busy={busy}
        placeholder={
          busy
            ? `${replyName.charAt(0).toUpperCase()}${replyName.slice(1)} is looking…`
            : lead
              ? `Ask ${lead.leadName} a follow-up…`
              : "Ask a follow-up…"
        }
        above={
          lead ? (
            <span className={`text-xs ${muted}`} data-testid="ask-to">
              To: {leadLabel(lead)}
            </span>
          ) : null
        }
        // Same word as the dock's first question (one label per action).
        sendLabel="Ask"
        className="flex-shrink-0"
      />
    </div>
  );
};

export default AskStep;
