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
  FontAwesomeIcon,
  TextArea,
  ThemeContext,
} from "@trops/dash-react";
import {
  buildConversation,
  errorNextSteps,
  toPlainText,
} from "./botConversation";

/**
 * BotChat — a bot's conversation in the Bots view (bot-teams PRD TEAM-011).
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
 * @param {object[]} [drafts]  a lead's drafts awaiting review (TEAM-005)
 * @param {(draftId: string) => void} [onOpenDraft]
 */
const EMPTY = [];
const NEAR_BOTTOM_PX = 32;

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

export const BotChat = ({
  bot,
  isLead = false,
  approvals = EMPTY,
  onApprove = null,
  nameOf = undefined,
  onOpenSettings = null,
  drafts = EMPTY,
  onOpenDraft = null,
}) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";
  const strong = currentTheme["text-neutral-light"] || "text-gray-200";
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";
  const bubble = currentTheme["bg-primary-very-dark"] || "bg-gray-800";
  const bubbleBorder = currentTheme["border-primary-dark"] || "border-gray-600";

  const [runs, setRuns] = useState(null);
  const [live, setLive] = useState(null);
  const [draft, setDraft] = useState("");
  const [freshNext, setFreshNext] = useState(false);
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
    loadRuns();
  }, [loadRuns]);

  // The run in progress, streamed live (also runs started elsewhere).
  useEffect(() => {
    const bots = api();
    if (!bots || !bots.onStream || !bot) return undefined;
    const id = bots.onStream(({ botId, event }) => {
      if (botId !== bot.id || !event) return;
      const cur = liveRef.current || {
        trigger: "running",
        text: "",
        toolCalls: [],
        continued: true,
      };
      let next = cur;
      if (event.type === "text") {
        next = { ...cur, text: (cur.text || "") + (event.text || "") };
      } else if (event.type === "tool_call") {
        next = {
          ...cur,
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
    if (!text || liveRef.current) return;
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
    try {
      if (isLead) {
        await bots.askLead(bot.id, text, continueConversation);
      } else {
        await bots.run(bot.id, text, continueConversation);
      }
    } catch (_e) {
      // The run's error is recorded in history.
    } finally {
      liveRef.current = null;
      setLive(null);
      loadRuns();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const renderTurn = (t, i) => {
    switch (t.kind) {
      case "divider":
        return (
          <div
            key={i}
            className={`flex flex-row items-center gap-3 text-xs ${muted}`}
          >
            <div className={`flex-1 border-t ${hairline}`} />
            {t.text}
            <div className={`flex-1 border-t ${hairline}`} />
          </div>
        );
      case "system":
        return (
          <div key={i} className={`text-xs ${muted}`}>
            {t.text}
          </div>
        );
      case "user":
        return (
          <div key={i} className="flex flex-row justify-end">
            <div
              className={`max-w-xl rounded-xl border px-3 py-2 text-sm whitespace-pre-wrap ${bubble} ${bubbleBorder}`}
            >
              {t.text}
            </div>
          </div>
        );
      case "tools":
        return (
          <div key={i} className="flex flex-col gap-1">
            {t.calls.map((c, j) => (
              <div
                key={j}
                className={`flex flex-row items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${hairline} ${muted}`}
              >
                <FontAwesomeIcon
                  icon={
                    c.ok === false ? "xmark" : c.ok ? "check" : "circle-notch"
                  }
                  className="h-3 w-3"
                />
                <span className="font-mono">{c.tool}</span>
                {c.provider ? <span>· {c.provider}</span> : null}
                {c.ok === false ? <span>· failed</span> : null}
              </div>
            ))}
          </div>
        );
      case "error": {
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
                    size="xs"
                    onClick={() => startRun(t.prompt || "", false)}
                  />
                ) : onOpenSettings ? (
                  <Button3
                    key={step.action}
                    title={step.label}
                    size="xs"
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
          <div key={i} className="flex flex-col gap-1 max-w-2xl">
            <span className={`text-xs ${muted}`}>{bot.name}</span>
            {t.unavailable ? (
              <span className={`text-sm ${muted}`}>
                Answer unavailable — it was stored encrypted with a key this app
                can&apos;t read.
              </span>
            ) : (
              <span className="text-sm whitespace-pre-wrap leading-relaxed">
                {t.text ? toPlainText(t.text) : t.pending ? "Working…" : ""}
              </span>
            )}
            {madeHere.map((d) => (
              <div key={d.id}>
                <Button3
                  title={`Review draft: ${d.definition && d.definition.name}`}
                  size="xs"
                  onClick={() => onOpenDraft(d.id)}
                />
              </div>
            ))}
          </div>
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
          className="h-full overflow-y-auto px-5 py-4 flex flex-col gap-3"
          data-testid="bot-chat-thread"
        >
          {runs !== null && !turns.length ? (
            <div className={`text-sm ${muted}`}>
              No conversation yet.{" "}
              {isLead
                ? "Ask the lead what the team is doing."
                : `Send ${bot.name} a message to start a run.`}
            </div>
          ) : null}
          {turns.map(renderTurn)}
          {approvals.map((a) => (
            <div
              key={a.id}
              className="rounded-md border border-amber-700 px-3 py-3 flex flex-col gap-2"
            >
              <span className="text-sm font-medium text-amber-300">
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
                  size="xs"
                  onClick={() => onApprove && onApprove(a.id, { allow: true })}
                />
                {a.request && a.request.serverName ? (
                  <Button
                    title="Always allow"
                    size="xs"
                    onClick={() =>
                      onApprove &&
                      onApprove(a.id, { allow: true, remember: true })
                    }
                  />
                ) : null}
                <Button3
                  title="Deny"
                  size="xs"
                  onClick={() => onApprove && onApprove(a.id, { allow: false })}
                />
              </div>
            </div>
          ))}
        </div>
        {unseen ? (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center">
            <Button3 title="↓ New messages" size="xs" onClick={jumpToNewest} />
          </div>
        ) : null}
      </div>
      <div
        className={`flex-shrink-0 border-t px-5 py-3 flex flex-col gap-2 ${hairline}`}
      >
        <div className="flex flex-row items-end gap-2">
          <div className="flex-1">
            <TextArea
              value={draft}
              onChange={setDraft}
              rows={2}
              placeholder={
                isLead
                  ? "Ask the lead about this team…"
                  : (runs || EMPTY).length && !freshNext
                    ? `Reply to ${bot.name}…`
                    : `Message ${bot.name}…`
              }
              aria-label="Message"
              onKeyDown={onKeyDown}
            />
          </div>
          <Button
            title={isLead ? "Ask" : "Send"}
            size="sm"
            onClick={send}
            disabled={!draft.trim() || !!live}
          />
        </div>
        <div
          className={`flex flex-row items-center justify-between text-xs ${muted}`}
        >
          <span>Enter to send · Shift+Enter for a new line</span>
          {(runs || EMPTY).length ? (
            <Button3
              title="New conversation"
              size="xs"
              onClick={() => setFreshNext(true)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};
