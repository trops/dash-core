import React, { useEffect, useRef, useState } from "react";
import { Button, Button3, ChatComposer, ChatMessage } from "@trops/dash-react";
import {
  findTeamRole,
  runTeamRole,
  stopTeamRole,
  teamSkipText,
} from "../../utils/teamRoles";
import { DashTeamApprovals } from "../Bots/DashTeamApprovals";

// The app's own hand-offs to the Planner still running, by conversation id:
// { id, result } — a copy of the conversation opened again while one runs
// (switched away and back) picks its answer up instead of spinning.
const directRuns = new Map();
import { askTeamLead } from "../../utils/leadAsk";
import { useTeamLeads } from "../AiAssistant/components/RecipientPicker";
import { leadLabel } from "../AiAssistant/leadMessages";
import { readableError } from "../Bots/botConversation";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { extractPlan } from "../../utils/teamPlan";
import { runCostLabel } from "../../utils/runCostLabel";
import { extractHandoff, withoutHandoff } from "../../utils/handoff";
import {
  stepFromCall,
  withResult,
  withStopped,
} from "../LeadWorkspace/handoffSteps";
import { HandoffStep } from "../LeadWorkspace/HandoffStep";
import { planWithDashTeam } from "../../utils/openCreate";
import {
  questionRequest,
  roleQuestion,
  leadQuestion,
  reopenedQuestion,
  hasPlan,
  handoverSeed,
  withoutPlan,
} from "./askThread";

// Who a conversation is with: a team lead ({ botId, leadName, … }), a Dash
// team role other than the Planner ({ role, roleName }), or — neither — the
// Planner.
const leadOf = (r) => (r && r.botId && !r.role ? r : null);
const roleOf = (r) => (r && r.role && r.role !== "planner" ? r : null);

/**
 * AskStep — a question to the Dash team's Planner (create-entry PRD CRE-007
 * AC4 / CRE-011 AC6, phase 5e). It reads the user's bot results and runs
 * (bot_results / bot_runs) and answers; follow-ups carry on. Saved
 * as a "question". When an answer plans something (or asks the questions a
 * plan needs), a host with `onOpenPlan(seed)` takes over with the
 * conversation so far; the lead workspace shows the plan itself.
 *
 * Asked of a team lead instead (5e-2a, the Ask box's "To:"): `recipient` is
 * the lead ({ botId, leadName, dashboardName, dashboardLabel }); the question
 * goes straight to it (bots.askLead) and the conversation stays with it,
 * saved with the conversation so a reopened one carries on with the lead.
 *
 * A lead asked to make something hands it to the Dash team (consolidation
 * Phase 2c-2): its answer shows "Plan this with the Dash team" —
 * `onHandoff(handoff, lead)` starts it, else a new Dash Lead conversation
 * opens with the request (lead-workspace release 6c).
 *
 * Asked of another Dash team role (the Dash team chat's "To:"):
 * `recipient` is { role, roleName } — the Builder, Scout or Checker answers
 * (from a chat it has no tools that build or change anything; the main
 * process holds it to that), and the conversation stays with it.
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
  // Lead workspace (release 2): the conversation as it changes (its steps
  // feed the right column), and whose approvals show here.
  onMessagesChange = null,
  // Told whether someone is still answering (the lead's run, or the app's
  // hand-off to the Planner) — the plan's card waits for it.
  onBusyChange = null,
  approvalBots = null,
  // In the workspace the left column already says who it is.
  hideTo = false,
  // Lead workspace (release 3a): what shows after a message — the plan's
  // card, the reply choices — as (message, index, { send, focusReply,
  // busy }) => node; and what's sent for a typed reply (the plan as it
  // stands goes along), as (text) => text.
  renderAfter = null,
  prepareSend = null,
  // A typed reply the host takes instead (a plain "yes" builds the plan):
  // (text) => true when it did, and nothing is sent.
  takeReply = null,
  // The host's handle on the conversation: { askPlanner, stopPlanner } —
  // set as it renders (the plan's card on the right uses it).
  controlRef = null,
  // What the conversation is about (release 6c): { label, text, note } —
  // saved with it; its note goes with the first question and with the
  // first reply after a reopen (the chat shows what was typed). A reopened
  // conversation's own is told to `onAbout`.
  about = null,
  onAbout = null,
  // The reply box's words, when the host has its own (the workspace's
  // "Reply", no hint line); otherwise it names who is asked.
  placeholder = null,
  hint = undefined,
  // Lead workspace (release 3b): the team is building — { text, onStop }:
  // the reply box says what's going on and its Stop stops the build. And a
  // value that changes as the build goes, so the chat follows it.
  working = null,
  follow = null,
}) => {
  // [{ who: "you" | "planner" | "lead" | "role" | "note" | "step", text, meta?, plan? }]
  // A step is a hand-off ("Asked Inbox Watch"): { id, bot, label, request,
  // status, answer?, result? } (handoffSteps.js).
  const [messages, setMessages] = useState(
    recentId ? [] : [{ who: "you", text: question }],
  );
  const [busy, setBusy] = useState(!recentId);
  // The app asked the Planner itself (askPlanner): its step shows working.
  const [plannerBusy, setPlannerBusy] = useState(false);
  // The role didn't answer because it's still busy: offer to stop it.
  const [roleBusy, setRoleBusy] = useState(false);
  const [soFar, setSoFar] = useState("");
  const [reply, setReply] = useState("");
  const [loaded, setLoaded] = useState(!recentId);
  const askId = useRef(recentId);
  const reopened = useRef(false);
  const started = useRef(false);
  const alive = useRef(true);
  const firstAsked = useRef(question);
  const aboutRef = useRef(about);
  const withAbout = (t) =>
    aboutRef.current && aboutRef.current.note
      ? `${t}\n\n${aboutRef.current.note}`
      : t;
  // Unique across reopens too (a reopened thread keeps its old steps).
  const askSeq = useRef(Date.now());
  // The lead this conversation is with (null = the Dash team).
  const [lead, setLead] = useState(leadOf(recipient));
  const leadRef = useRef(leadOf(recipient));
  // The Dash team role it's with, when not the Planner.
  const [teamRole, setTeamRole] = useState(roleOf(recipient));
  const teamRoleRef = useRef(roleOf(recipient));
  // Live state (paused / over budget / running) for the availability check.
  const { leads } = useTeamLeads(!!lead);
  const leadsRef = useRef(leads);
  leadsRef.current = leads;
  const { muted } = useConfigTokens();
  // The lead's name on its replies; the To: line names the dashboard.
  const roleName = teamRole ? teamRole.roleName || "Dash team" : "Planner";
  // Who answered a reopened conversation's earlier replies, when they
  // didn't say (saved before release 6b): its saved recipient, else the
  // Planner — not whoever it's carried on with now.
  const [savedLabel, setSavedLabel] = useState(null);
  const replyLabel = lead ? lead.leadName : roleName;
  const replyName = lead ? lead.leadName : `the ${roleName}`;

  // The conversation as it stands, for an answer that lands after this step
  // has closed (Phase 2a).
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
    const other = to ? null : teamRoleRef.current;
    const role = other ? other.role : "planner";
    const name = other ? other.roleName || other.role : "Planner";
    // The Dash Lead takes the words as typed (it can ask the Planner);
    // the other roles are told they only answer from a chat.
    const wrap = to
      ? leadQuestion
      : other
        ? other.role === "dashlead"
          ? leadQuestion
          : roleQuestion
        : questionRequest;
    let request = wrap(text);
    let cont = continueConversation;
    if (reopened.current) {
      reopened.current = false;
      cont = false;
      request = reopenedQuestion(history, withAbout(text), 6, wrap);
    }
    const onText = (t) => alive.current && setSoFar(t);
    // Hand-offs as they happen: the step, then its answer. Ids are this
    // question's own (an engine's call ids can repeat across runs).
    askSeq.current += 1;
    const seq = askSeq.current;
    const onEvent = (e) => {
      const step = stepFromCall(e);
      if (step) {
        add({ ...step, id: `${seq}:${step.id}` });
        return;
      }
      if (e && e.type === "tool_result") {
        const mine = { ...e, id: `${seq}:${e.id}` };
        if (alive.current) setMessages((m) => withResult(m, mine));
        else messagesRef.current = withResult(messagesRef.current, mine);
      }
    };
    let res;
    if (to) {
      // Live state when the lead list has it (it may have been paused).
      const live =
        (leadsRef.current || []).find((l) => l.botId === to.botId) || to;
      res = await askTeamLead(live, request, {
        continueConversation: cont,
        conversationId: askId.current,
        onText,
        onEvent,
      });
    } else {
      res = await runTeamRole(role, request, {
        continueConversation: cont,
        planId: askId.current,
        onText,
        onEvent,
      });
    }
    if (alive.current) {
      setBusy(false);
      setSoFar("");
    }
    // A hand-off with no answer when the run ended (Stop, quit): stopped,
    // never a spinner forever.
    const settle = (m) => withStopped(m, `${seq}:`);
    if (alive.current) setMessages(settle);
    else messagesRef.current = settle(messagesRef.current);
    if (res.status === "stopped" || res.status === "interrupted") {
      note("Stopped.");
      return;
    }
    if (res.skipped) {
      const why = teamSkipText(res.reason, to ? to.leadName || "lead" : name);
      if (!to) setRoleBusy(why.busy);
      // A lead's reason is already written for the user ("… is paused —
      // resume it in the Bots view"); only busy needs saying differently.
      note(to && !why.busy ? res.reason : why.text);
      return;
    }
    if (!to) setRoleBusy(false);
    if (res.status === "failed") {
      note(
        to
          ? readableError(String(res.error || "")) ||
              `${to.leadName} couldn't answer.`
          : `The ${name} couldn't answer: ${res.error || "unknown error"}`,
      );
      return;
    }
    if (other) {
      add({
        who: "role",
        // Who answered, kept with it (release 6b): a conversation can be
        // carried on with someone else (the Dash Lead).
        by: name,
        text: res.output || "(no answer)",
        meta: runCostLabel(res),
      });
      return;
    }
    if (to) {
      const handoff = extractHandoff(res.output);
      add({
        who: "lead",
        by: to.leadName,
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
    // An answer that plans (or asks what a plan needs) moves on to the
    // host's plan (onOpenPlan), where its questions are taps.
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
            if (conv.about && typeof conv.about === "object") {
              aboutRef.current = conv.about;
              if (onAbout) onAbout(conv.about);
            }
            firstAsked.current = (entry && entry.prompt) || "";
            const was = conv.recipient || {};
            setSavedLabel(was.leadName || was.roleName || "Planner");
            // Carried on with whoever the host says (the lead workspace:
            // an older Dash team question goes on with the Dash Lead,
            // release 6b); else with whoever it was saved with.
            if (!recipient && leadOf(conv.recipient)) {
              leadRef.current = conv.recipient;
              setLead(conv.recipient);
            } else if (!recipient && roleOf(conv.recipient)) {
              teamRoleRef.current = conv.recipient;
              setTeamRole(conv.recipient);
            }
            let loadedMessages =
              Array.isArray(conv.messages) && conv.messages.length
                ? conv.messages
                : [{ who: "you", text: firstAsked.current }];
            // The app's hand-off to the Planner, saved while it ran: still
            // running here — its answer comes to this copy — or not (a
            // restart): stopped, so nothing spins forever.
            const run = directRuns.get(recentId);
            for (const m of loadedMessages) {
              if (!m || m.who !== "step" || !m.direct) continue;
              if (m.status !== "asking") continue;
              if (run && run.id === m.id) {
                setPlannerBusy(true);
                run.result.then((apply) => {
                  if (!alive.current) return;
                  setPlannerBusy(false);
                  setMessages(apply);
                });
              } else {
                loadedMessages = withStopped(loadedMessages, m.id);
              }
            }
            setMessages(loadedMessages);
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
                ...(recipient || about
                  ? {
                      conversation: {
                        ...(recipient ? { recipient } : {}),
                        ...(about ? { about } : {}),
                      },
                    }
                  : {}),
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
          .then(() => ask(withAbout(question), false, []));
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

  useEffect(() => {
    if (onMessagesChange) onMessagesChange(messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    if (onBusyChange) onBusyChange(busy || plannerBusy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, plannerBusy]);

  // Reopened while an earlier copy of this conversation is still being
  // answered (switched away mid-run): take the saved conversation when it
  // grows, so the answer isn't lost — or overwritten by this older copy.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const bots = window.mainApi && window.mainApi.bots;
    if (!recentId || !bots || !bots.onCreateRecent || !bots.getCreateRecent) {
      return undefined;
    }
    const id = bots.onCreateRecent(() => {
      if (busyRef.current) return;
      Promise.resolve(bots.getCreateRecent(recentId))
        .then((entry) => {
          const saved =
            entry && entry.conversation && entry.conversation.messages;
          if (
            alive.current &&
            Array.isArray(saved) &&
            saved.length > messagesRef.current.length
          ) {
            setMessages(saved);
          }
        })
        .catch(() => {});
    });
    return () => {
      if (id != null && bots.removeListener) bots.removeListener(id);
    };
  }, [recentId]);

  // Stop: the lead (and the bots it's waiting on), or the Dash team role.
  const stopNow = async () => {
    const bots = window.mainApi && window.mainApi.bots;
    if (leadRef.current) {
      if (bots && bots.stop) await bots.stop(leadRef.current.botId);
      return;
    }
    // Only this role (and the roles it asked) — not the whole Dash team,
    // which may be building something elsewhere.
    const bot = await findTeamRole(
      teamRoleRef.current ? teamRoleRef.current.role : "planner",
    );
    if (bot && bots && bots.stop) await bots.stop(bot.id);
  };

  /**
   * The app's own hand-off to the Planner — the user's answer to the plan's
   * questions, Decide for me, Ask again — with no lead in between, so it
   * never depends on a lead passing it on. Shown and saved as a step, like
   * the lead's; its plan becomes the conversation's plan.
   * @param {string} shown    what the user said (shown as theirs), or ""
   * @param {string|() => string} request  what the Planner is sent — a
   *   function is called only once it's asked (it may take the plan's edits)
   * @param {string} [label]  the step's label
   * @returns {boolean} false when something is already answering
   */
  const askPlanner = (
    shown,
    request,
    label = "Sent your answer to the Planner",
  ) => {
    if (!request || busy || plannerBusy || working) return false;
    const text = typeof request === "function" ? request() : request;
    if (!text) return false;
    askSeq.current += 1;
    const id = `${askSeq.current}:planner`;
    setReply("");
    setPlannerBusy(true);
    setMessages((m) => [
      ...m,
      ...(String(shown || "").trim()
        ? [{ who: "you", text: String(shown).trim() }]
        : []),
      {
        who: "step",
        id,
        bot: "the Planner",
        label,
        request: text,
        status: "asking",
        direct: true,
      },
    ]);
    const conversationId = askId.current;
    let settle = null;
    if (conversationId) {
      directRuns.set(conversationId, {
        id,
        result: new Promise((resolve) => {
          settle = resolve;
        }),
      });
    }
    (async () => {
      let res;
      try {
        res = await runTeamRole("planner", text, {
          planId: conversationId,
        });
      } catch (err) {
        res = { status: "failed", error: (err && err.message) || "" };
      }
      const stopped =
        res && (res.status === "stopped" || res.status === "interrupted");
      const failed = !res || !!res.skipped || res.status === "failed";
      const output =
        res && res.skipped
          ? teamSkipText(res.reason, "Planner").text
          : failed
            ? `The Planner couldn't answer: ${(res && res.error) || "unknown error"}`
            : res.output || "";
      const apply = (m) =>
        stopped
          ? withStopped(m, id)
          : withResult(m, {
              type: "tool_result",
              id,
              output,
              isError: failed,
            });
      if (conversationId) {
        const run = directRuns.get(conversationId);
        if (run && run.id === id) directRuns.delete(conversationId);
      }
      if (settle) settle(apply);
      if (alive.current) {
        setPlannerBusy(false);
        setMessages(apply);
        return;
      }
      // Closed meanwhile: saved, so the answer isn't lost.
      messagesRef.current = apply(messagesRef.current);
      const bots = window.mainApi && window.mainApi.bots;
      if (askId.current && bots && bots.saveCreateRecent) {
        Promise.resolve(
          bots.saveCreateRecent({
            id: askId.current,
            conversation: { messages: messagesRef.current },
          }),
        ).catch(() => {});
      }
    })();
    return true;
  };
  // Stop: only the Planner — the rest of the team may be busy elsewhere
  // (a build in another conversation).
  const stopPlanner = async () => {
    const last = messagesRef.current[messagesRef.current.length - 1];
    const asking =
      plannerBusy ||
      !!(
        last &&
        last.who === "step" &&
        last.direct &&
        last.status === "asking"
      );
    if (!asking) return;
    const bots = window.mainApi && window.mainApi.bots;
    const bot = await findTeamRole("planner");
    if (bot && bots && bots.stop) await bots.stop(bot.id);
  };
  if (controlRef) controlRef.current = { askPlanner, stopPlanner };

  // `details` go to the lead with it but aren't shown (e.g. the plan's
  // problems behind "Ask the Planner to fix it").
  const send = (text, details = "") => {
    const t = String(text || "").trim();
    if (!t || busy || plannerBusy || working) return;
    if (!details && takeReply && takeReply(t)) {
      setReply("");
      return;
    }
    const history = messages;
    setReply("");
    setMessages((m) => [...m, { who: "you", text: t }]);
    const full = details ? `${t}\n\n${details}` : t;
    ask(prepareSend ? prepareSend(full) : full, true, history);
  };

  // The reply box, for Change something.
  const root = useRef(null);
  const focusReply = () => {
    const boxes =
      root.current && root.current.querySelectorAll("textarea, input");
    const box = boxes && boxes.length ? boxes[boxes.length - 1] : null;
    if (box) box.focus();
  };
  // The conversation follows its newest message (and what shows after it:
  // the plan's card, the reply choices).
  const scroller = useRef(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy, follow]);
  const after = (m, i) =>
    renderAfter
      ? renderAfter(m, i, {
          send,
          focusReply,
          busy: busy || plannerBusy,
          askPlanner,
        })
      : null;

  return (
    <div
      ref={root}
      className="flex-1 min-h-0 flex flex-col"
      data-testid="ask-step"
    >
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-3 px-3 py-3">
          {messages.map((m, i) => (
            <React.Fragment key={m.who === "step" && m.id ? m.id : i}>
              {m.who === "you" ? (
                <ChatMessage key={i} role="you">
                  {m.text}
                </ChatMessage>
              ) : m.who === "note" ? (
                <ChatMessage key={i} role="note">
                  {m.text}
                </ChatMessage>
              ) : m.who === "step" ? (
                <HandoffStep key={m.id || i} step={m} />
              ) : (
                <ChatMessage
                  key={i}
                  role="reply"
                  label={
                    m.by ||
                    (m.who === "lead" || m.who === "role"
                      ? savedLabel || replyLabel
                      : "Planner")
                  }
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
                                dashboardName:
                                  lead.dashboardLabel ||
                                  lead.dashboardName ||
                                  "",
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
              )}
              {after(m, i)}
            </React.Fragment>
          ))}
          <DashTeamApprovals compact bots={approvalBots} />
          {roleBusy ? (
            <div
              className="flex flex-row flex-wrap items-center gap-2 text-sm"
              data-testid="planner-busy"
            >
              <span className={muted}>
                The {roleName} is still working on an earlier request.
              </span>
              <Button3
                title={`Stop the ${roleName}`}
                size="sm"
                onClick={async () => {
                  await stopTeamRole(teamRole ? teamRole.role : "planner");
                  setRoleBusy(false);
                }}
              />
            </div>
          ) : null}
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
        busy={busy || plannerBusy || !!working}
        onStop={
          plannerBusy && !busy
            ? stopPlanner
            : busy || !working
              ? stopNow
              : working.onStop
        }
        placeholder={
          working && !busy
            ? working.text
            : busy
              ? `${replyName.charAt(0).toUpperCase()}${replyName.slice(1)} is looking…`
              : placeholder
                ? placeholder
                : lead
                  ? `Ask ${lead.leadName} a follow-up…`
                  : teamRole
                    ? `Ask the ${roleName} a follow-up…`
                    : "Ask a follow-up…"
        }
        above={
          !hideTo && (lead || teamRole) ? (
            <span className={`text-xs ${muted}`} data-testid="ask-to">
              To: {lead ? leadLabel(lead) : `${roleName} · Dash team`}
            </span>
          ) : null
        }
        {...(hint !== undefined ? { hint } : {})}
        // Same word as the dock's first question (one label per action).
        sendLabel="Ask"
        className="flex-shrink-0"
      />
    </div>
  );
};

export default AskStep;
