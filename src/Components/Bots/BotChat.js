import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Button3,
  ChatComposer,
  ChatMessage,
  ChatToolCall,
  EmptyState,
  FontAwesomeIcon,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import {
  buildConversation,
  errorNextSteps,
  skipNotice,
  toPlainText,
  waitingText,
} from "./botConversation";
import { appendAnswerText } from "../../utils/answerText";
import { runCostLabel } from "../../utils/runCostLabel";

/**
 * BotChat — a bot's conversation in the Bots view and the Bots dock
 * (bot-teams PRD TEAM-011, TEAM-015). Drawn with dash-react's shared chat
 * (ChatMessage, ChatToolCall, ChatComposer), so it looks like every other
 * chat in Dash (TEAM-015 AC8).
 *
 * History comes from the bot's runs (bots.getRuns); the run in progress
 * streams in live (onStream). The composer is pinned to the bottom and the
 * thread scrolls above it, newest last: it follows new messages unless the
 * user has scrolled up, in which case a "New messages" pill appears.
 *
 * Sending: the first message (or after "New conversation") starts a fresh
 * conversation; later ones reply within it (continueConversation). A team
 * lead is asked (askLead) rather than run. Pending approvals for this bot
 * show inline. Answers are plain text — never HTML.
 *
 * @param {object} bot
 * @param {boolean} [isLead]
 * @param {object[]} [approvals]  this bot's pending approvals
 * @param {(id: string, decision: object) => void} [onApprove]
 * @param {(botId: string) => string} [nameOf]  bot names for trigger chains
 * @param {(section: string) => void} [onOpenSettings]  error next steps
 * @param {() => void} [onChangeModel]  "Change AI model" — opens the bot's Settings
 * @param {object[]} [drafts]  a lead's drafts awaiting review (TEAM-005)
 * @param {(draftId: string) => void} [onOpenDraft]
 * @param {boolean} [paused]  the bot is paused: it says so and the box waits
 * @param {() => void} [onResume]  Resume, shown with the paused note
 * @param {string} [overBudget]  the limit it's over ("its $5.00 monthly
 *   budget") — it won't run; the box waits (US-019)
 * @param {() => void} [onKeepRunning]  Keep running this month
 * @param {number} [queuedEvents]  events kept for it while it's held — the
 *   paused / over-budget note says so (US-011 AC8)
 *
 * A message the runner skips (paused, busy) stays in the box with why
 * (TEAM-015) — never silently dropped.
 */
const EMPTY = [];
const NEAR_BOTTOM_PX = 32;

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/** "2:39 PM" for a run time, or "" when it's missing / unreadable. */
function timeOf(at) {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export const BotChat = ({
  bot,
  isLead = false,
  approvals = EMPTY,
  onApprove = null,
  nameOf = undefined,
  onOpenSettings = null,
  onChangeModel = null,
  drafts = EMPTY,
  onOpenDraft = null,
  paused = false,
  queuedEvents = 0,
  onResume = null,
  overBudget = null,
  onKeepRunning = null,
}) => {
  // The box waits while the bot can't run.
  const blocked = paused || !!overBudget;
  // "2 events waiting" while it's held (US-011 AC8).
  const waiting = waitingText(queuedEvents);
  const currentTheme = (useContext(ThemeContext) || {}).currentTheme || {};
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";
  const strong = currentTheme["text-neutral-light"] || "text-gray-200";
  const statusTokens = useStatusTokens();
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";

  const [runs, setRuns] = useState(null);
  const [live, setLive] = useState(null);
  const [draft, setDraft] = useState("");
  const [freshNext, setFreshNext] = useState(false);
  // Why the last message didn't start a run (it's back in the box).
  const [notice, setNotice] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const scrollRef = useRef(null);
  const liveRef = useRef(null);

  const loadRuns = useCallback(async () => {
    const bots = api();
    if (!bots || !bots.getRuns || !bot) return;
    try {
      const list = await bots.getRuns(bot.id, 50);
      setRuns(Array.isArray(list) ? list : EMPTY);
    } catch (_e) {
      setRuns((prev) => prev || EMPTY);
    }
  }, [bot]);

  useEffect(() => {
    setRuns(null);
    setLive(null);
    setFreshNext(false);
    setNotice(null);
    loadRuns();
  }, [loadRuns]);

  // The run in progress, streamed live (also runs started elsewhere).
  useEffect(() => {
    const bots = api();
    if (!bots || !bots.onStream || !bot) return undefined;
    const id = bots.onStream(({ botId, event }) => {
      if (botId !== bot.id || !event) return;
      // A run this chat didn't start (Run now, a trigger, a schedule) is
      // its own run — not a continuation of the last one.
      const cur = liveRef.current || {
        trigger: "running",
        text: "",
        toolCalls: [],
        continued: false,
      };
      let next = cur;
      if (event.type === "text") {
        next = {
          ...cur,
          // The next attempt is answering: the retry note goes.
          retry: null,
          text: appendAnswerText(cur.text, event.text, {
            afterTool: cur.afterTool,
          }),
          afterTool: false,
        };
      } else if (event.type === "tool_call") {
        next = {
          ...cur,
          // The next text starts a new paragraph.
          afterTool: true,
          toolCalls: [
            ...cur.toolCalls,
            {
              id: event.id,
              tool: String(event.name || "").replace(
                /^mcp__[^_]+(?:-[^_]+)*__/,
                "",
              ),
              provider: null,
              ok: null,
            },
          ],
        };
      } else if (event.type === "tool_result") {
        next = {
          ...cur,
          toolCalls: cur.toolCalls.map((c) =>
            c.id === event.id ? { ...c, ok: !event.isError } : c,
          ),
        };
      } else if (event.type === "retrying") {
        // Trying again after temporary trouble (US-023): the failed
        // attempt's words go; the note says when the next try starts.
        next = {
          ...cur,
          text: "",
          afterTool: false,
          retry: {
            reason: event.reason,
            attempt: event.attempt,
            of: event.of,
            delayMs: event.delayMs,
          },
        };
      } else if (
        event.type === "done" ||
        event.type === "error" ||
        event.type === "skipped"
      ) {
        liveRef.current = null;
        setLive(null);
        loadRuns();
        return;
      } else {
        return;
      }
      liveRef.current = next;
      setLive(next);
    });
    return () => {
      if (bots.removeListener) bots.removeListener(id);
    };
  }, [bot, loadRuns]);

  const turns = useMemo(
    () => buildConversation(runs || EMPTY, { live, nameOf }),
    [runs, live, nameOf],
  );

  // Follow new messages when at the bottom; otherwise offer the pill.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
      setUnseen(false);
    } else {
      setUnseen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    setAtBottom(near);
    if (near) setUnseen(false);
  };

  const jumpToNewest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setUnseen(false);
  };

  const send = () => {
    const text = draft.trim();
    // Keep the draft while a run is in progress (Enter mid-run).
    if (!text || liveRef.current || blocked) return;
    const continueConversation = !freshNext && (runs || EMPTY).length > 0;
    setDraft("");
    setFreshNext(false);
    startRun(text, continueConversation);
  };

  // A run (or a question to the lead), streamed into the thread.
  const startRun = async (text, continueConversation) => {
    const bots = api();
    if (!bots || !bot || liveRef.current) return;
    setAtBottom(true);
    const pending = {
      trigger: isLead ? "ask" : "manual",
      prompt: text,
      text: "",
      toolCalls: [],
      continued: continueConversation,
    };
    liveRef.current = pending;
    setLive(pending);
    setNotice(null);
    try {
      const res = isLead
        ? await bots.askLead(bot.id, text, continueConversation)
        : await bots.run(bot.id, text, continueConversation);
      if (res && res.skipped) {
        // Nothing ran: the message goes back in the box, with why.
        setDraft((d) => d || text);
        setNotice(skipNotice(bot.name, res.reason));
      }
    } catch (_e) {
      // The run's error is recorded in history.
    } finally {
      liveRef.current = null;
      setLive(null);
      loadRuns();
    }
  };

  // Stop the run in progress (the composer's Send becomes Stop).
  const stop = () => {
    const bots = api();
    if (bots && bots.stop && bot) bots.stop(bot.id);
  };

  const renderTurn = (t, i) => {
    switch (t.kind) {
      case "divider":
        return (
          <ChatMessage key={i} role="note">
            {t.text}
          </ChatMessage>
        );
      case "system":
        return (
          <ChatMessage key={i} role="note">
            {t.text}
            {timeOf(t.at) ? ` · ${timeOf(t.at)}` : ""}
          </ChatMessage>
        );
      case "user":
        return (
          <ChatMessage key={i} role="you">
            {t.text}
          </ChatMessage>
        );
      case "tools":
        return (
          <div key={i} className="flex flex-col gap-1">
            {t.calls.map((c, j) => (
              <ChatToolCall
                key={j}
                name={c.tool}
                status={
                  c.ok === false
                    ? "error"
                    : c.ok
                      ? "done"
                      : t.live
                        ? "running"
                        : "error"
                }
                source={
                  [
                    c.provider,
                    c.ok === false ? "failed" : null,
                    c.ok == null && !t.live ? "didn't finish" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || null
                }
              />
            ))}
          </div>
        );
      case "error": {
        if (t.stale) {
          // A later run exists — this failure is history (the bot may already
          // be fixed), so no Run again / Change AI model here.
          return (
            <div
              key={i}
              className={`rounded-md border px-3 py-2 text-sm flex flex-col gap-1 ${hairline} ${muted}`}
            >
              <span className="text-xs">
                {`Earlier run failed${timeOf(t.at) ? ` · ${timeOf(t.at)}` : ""}`}
              </span>
              <span>{t.text}</span>
            </div>
          );
        }
        const steps = errorNextSteps(t.text, { isLead });
        return (
          <div
            key={i}
            className="rounded-md border border-red-800 px-3 py-2 text-sm text-red-300 flex flex-col gap-2"
          >
            <span>{t.text}</span>
            <div className="flex flex-row flex-wrap gap-2">
              {steps.map((step) =>
                step.action === "run-again" ? (
                  <Button3
                    key={step.action}
                    title={step.label}
                    size="sm"
                    onClick={() => startRun(t.prompt || "", false)}
                  />
                ) : step.action === "change-model" ? (
                  onChangeModel ? (
                    <Button3
                      key={step.action}
                      title={step.label}
                      size="sm"
                      onClick={() => onChangeModel()}
                    />
                  ) : null
                ) : onOpenSettings ? (
                  <Button3
                    key={step.action}
                    title={step.label}
                    size="sm"
                    onClick={() => onOpenSettings(step.section)}
                  />
                ) : null,
              )}
            </div>
          </div>
        );
      }
      case "bot": {
        // Drafts this lead made while writing this answer (TEAM-005 5b).
        const madeHere =
          isLead && onOpenDraft && t.startedAt && !t.pending
            ? drafts.filter((d) => {
                const c = Date.parse(d.createdAt);
                const from = Date.parse(t.startedAt) - 1000;
                const to = t.endedAt ? Date.parse(t.endedAt) + 5000 : Infinity;
                return d.leadId === bot.id && c >= from && c <= to;
              })
            : EMPTY;
        return (
          <ChatMessage
            key={i}
            role="reply"
            label={bot.name}
            meta={t.pending ? null : runCostLabel(t) || null}
            streaming={!!t.pending}
            testId="answer-bubble"
            footer={
              madeHere.length ? (
                <div className="flex flex-row flex-wrap gap-2">
                  {madeHere.map((d) => (
                    <Button3
                      key={d.id}
                      title={`Review draft: ${d.definition && d.definition.name}`}
                      size="sm"
                      onClick={() => onOpenDraft(d.id)}
                    />
                  ))}
                </div>
              ) : null
            }
          >
            {t.unavailable ? (
              <span className={muted}>
                Answer unavailable — it was stored encrypted with a key this app
                can&apos;t read.
              </span>
            ) : (
              <span className="whitespace-pre-wrap">
                {t.text ? toPlainText(t.text) : t.pending ? "Working…" : ""}
              </span>
            )}
          </ChatMessage>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className={`flex flex-col flex-1 min-h-0 ${strong}`}>
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto px-5 pt-4 pb-6 flex flex-col gap-3"
          data-testid="bot-chat-thread"
        >
          {runs !== null && !turns.length ? (
            <EmptyState
              icon={<FontAwesomeIcon icon="comments" className="h-6 w-6" />}
              title="No conversation yet"
              description={
                isLead
                  ? "Ask the lead what the team is doing — the box is below."
                  : `Send ${bot.name} a message below to start a run.`
              }
              className="my-auto"
            />
          ) : null}
          {turns.map(renderTurn)}
          {approvals.map((a) => (
            <div
              key={a.id}
              className={`rounded-md border px-3 py-3 flex flex-col gap-2 ${statusTokens.warning.bg} ${statusTokens.warning.border}`}
            >
              <span
                className={`text-sm font-medium ${statusTokens.warning.text}`}
              >
                Needs your approval
              </span>
              <span className={`text-xs ${muted}`}>
                <span className="font-mono">
                  {(a.request && a.request.toolName) || "tool"}
                </span>
                {a.request && a.request.serverName
                  ? ` on ${a.request.serverName}`
                  : " (built-in)"}
              </span>
              <div className="flex flex-row flex-wrap gap-2">
                <Button3
                  title="Allow once"
                  size="sm"
                  onClick={() => onApprove && onApprove(a.id, { allow: true })}
                />
                {a.request && a.request.serverName ? (
                  <Button
                    title="Always allow"
                    size="sm"
                    onClick={() =>
                      onApprove &&
                      onApprove(a.id, { allow: true, remember: true })
                    }
                  />
                ) : null}
                <Button3
                  title="Deny"
                  size="sm"
                  onClick={() => onApprove && onApprove(a.id, { allow: false })}
                />
              </div>
            </div>
          ))}
        </div>
        {unseen ? (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center">
            <Button3 title="↓ New messages" size="sm" onClick={jumpToNewest} />
          </div>
        ) : null}
      </div>
      <ChatComposer
        value={draft}
        onChange={(v) => setDraft(v)}
        onSend={send}
        onStop={stop}
        busy={!!live}
        disabled={blocked}
        ariaLabel="Message"
        sendLabel={isLead ? "Ask" : "Send"}
        placeholder={
          paused
            ? `Turn on ${bot.name} to message it`
            : overBudget
              ? `Keep ${bot.name} running to message it`
              : isLead
                ? "Ask the lead about this team…"
                : (runs || EMPTY).length && !freshNext
                  ? `Reply to ${bot.name}…`
                  : `Message ${bot.name}…`
        }
        above={
          paused || overBudget || notice ? (
            <div className="flex flex-col gap-2">
              {overBudget && !paused ? (
                <div
                  className={`rounded-lg border px-3 py-2 flex flex-col gap-2 text-xs ${statusTokens.warning.bg} ${statusTokens.warning.border}`}
                  data-testid="bot-chat-over-budget"
                >
                  <span className="flex flex-row items-start gap-2">
                    <FontAwesomeIcon
                      icon="triangle-exclamation"
                      className={`h-3 w-3 mt-0.5 flex-shrink-0 ${statusTokens.warning.text}`}
                    />
                    <span className={statusTokens.warning.text}>
                      Over {overBudget} — it won&apos;t run until you keep it
                      running this month or raise the budget.
                      {waiting ? ` ${waiting} — they'll run when it can.` : ""}
                    </span>
                  </span>
                  {onKeepRunning ? (
                    <div>
                      <Button
                        title="Keep running this month"
                        size="sm"
                        onClick={() => onKeepRunning()}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {paused ? (
                <div
                  className={`rounded-lg border px-3 py-2 flex flex-row items-center gap-3 text-xs ${hairline}`}
                  data-testid="bot-chat-paused"
                >
                  <FontAwesomeIcon
                    icon="pause"
                    className={`h-3 w-3 ${muted}`}
                  />
                  <span className="flex-1">
                    Paused — it won&apos;t answer until you turn it on.
                    {waiting
                      ? ` ${waiting} — they'll run when you turn it on.`
                      : ""}
                  </span>
                  {onResume ? (
                    <Button
                      title="Turn on"
                      size="sm"
                      onClick={() => onResume()}
                    />
                  ) : null}
                </div>
              ) : null}
              {notice ? (
                <span
                  role="status"
                  className={`text-xs ${statusTokens.warning.text}`}
                  data-testid="bot-chat-notice"
                >
                  {notice}
                </span>
              ) : null}
            </div>
          ) : null
        }
        hint={
          <span className="flex flex-row items-center justify-between gap-2">
            <span>Enter to send · Shift+Enter for a new line</span>
            {(runs || EMPTY).length ? (
              <Button3
                title="New conversation"
                size="sm"
                onClick={() => setFreshNext(true)}
              />
            ) : null}
          </span>
        }
      />
    </div>
  );
};
