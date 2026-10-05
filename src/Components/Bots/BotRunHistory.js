import React, { useCallback, useContext, useEffect, useState } from "react";
import { Button3, ThemeContext } from "@trops/dash-react";
import {
  errorNextSteps,
  readableError,
  toPlainText,
  triggerLabel,
} from "./botConversation";

/**
 * BotRunHistory — a bot's runs, newest first (Bots view › Activity,
 * bot-teams PRD TEAM-011). Each row: when, what started it, status, and the
 * answer's first line; opening a row shows the full answer, the prompt, the
 * tool calls and any error. Answers are plain text, never HTML.
 *
 * Details also show what triggered the run, its approval decisions, and next
 * steps for a failed run (Run again; Open Settings › Providers for provider
 * problems). Reloads when the bot's run finishes.
 */
const DECISION_TEXT = {
  allowed: "you allowed",
  "allowed-always": "you always allowed",
  denied: "you denied",
};

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}
const STATUS_DOT = {
  completed: "bg-green-400",
  failed: "bg-red-400",
  running: "bg-indigo-400",
  skipped: "bg-gray-500",
};

const TRIGGER_LABELS = {
  manual: "Manual",
  reply: "Reply",
  ask: "Asked",
  schedule: "Schedule",
  event: "Event",
};

function when(run) {
  const iso = run.startedAt || run.at || run.endedAt;
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (_e) {
    return iso;
  }
}

function statusLabel(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown";
}

function dotFor(status) {
  return STATUS_DOT[status] || "bg-gray-500";
}

function firstLine(run) {
  if (run.status === "failed" && run.error) return readableError(run.error);
  if (run.outputUnavailable) return "Answer unavailable";
  return toPlainText(run.output || "").split("\n")[0];
}

export const BotRunHistory = ({
  bot,
  isLead = false,
  nameOf = undefined,
  onOpenSettings = null,
  onChangeModel = null,
}) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";
  const strong = currentTheme["text-neutral-light"] || "text-gray-200";
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";
  const [runs, setRuns] = useState(null);
  const [open, setOpen] = useState(null);

  const loadRuns = useCallback(async () => {
    const bots = api();
    if (!bots || !bots.getRuns || !bot) return;
    try {
      const list = await bots.getRuns(bot.id, 50);
      setRuns(Array.isArray(list) ? [...list].reverse() : []);
    } catch (_e) {
      setRuns((prev) => prev || []);
    }
  }, [bot]);

  useEffect(() => {
    setRuns(null);
    setOpen(null);
    loadRuns();
  }, [loadRuns]);

  // Live: reload when this bot's run finishes.
  useEffect(() => {
    const bots = api();
    if (!bots || !bots.onStream || !bot) return undefined;
    const id = bots.onStream(({ botId, event }) => {
      const t = event && event.type;
      if (botId !== bot.id) return;
      if (t === "done" || t === "error" || t === "skipped") loadRuns();
    });
    return () => {
      if (bots.removeListener) bots.removeListener(id);
    };
  }, [bot, loadRuns]);

  const runAgain = (prompt) => {
    const bots = api();
    if (!bots || !bot) return;
    if (isLead) bots.askLead(bot.id, prompt || "", false);
    else bots.run(bot.id, prompt || "", false);
  };

  if (runs === null) return null;
  if (!runs.length) {
    return (
      <div className={`px-5 py-4 text-sm ${muted}`}>
        {bot.name} hasn&apos;t run yet.
      </div>
    );
  }

  return (
    <div className={`flex flex-col px-5 py-4 overflow-y-auto ${strong}`}>
      {runs.map((r, i) => (
        <div key={i} className={`border-b ${hairline}`}>
          <button
            type="button"
            data-testid="run-row"
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full text-left flex flex-row gap-3 items-center py-2.5 text-sm"
            aria-expanded={open === i}
          >
            <span className={`w-28 flex-shrink-0 ${muted}`}>{when(r)}</span>
            <span className={`w-20 flex-shrink-0 ${muted}`}>
              {TRIGGER_LABELS[r.trigger] || statusLabel(r.trigger)}
            </span>
            <span className="w-24 flex-shrink-0 flex flex-row items-center gap-1.5 text-xs">
              <span className={`h-2 w-2 rounded-full ${dotFor(r.status)}`} />
              {statusLabel(r.status)}
            </span>
            <span className="flex-1 min-w-0 truncate">{firstLine(r)}</span>
          </button>
          {open === i ? (
            <div className="flex flex-col gap-2 pb-3 text-sm">
              {triggerLabel(r, nameOf) ? (
                <div className={`text-xs ${muted}`}>
                  {triggerLabel(r, nameOf)}
                </div>
              ) : null}
              {r.prompt ? (
                <div>
                  <div className={`text-xs ${muted}`}>Asked</div>
                  <div className="whitespace-pre-wrap">{r.prompt}</div>
                </div>
              ) : null}
              {Array.isArray(r.toolCalls) && r.toolCalls.length ? (
                <div className={`text-xs ${muted} flex flex-col gap-0.5`}>
                  {r.toolCalls.map((c, j) => (
                    <span key={j} className="font-mono">
                      {[
                        c.tool,
                        c.provider,
                        c.ok === false ? "failed" : c.ok ? "ok" : "no result",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ))}
                </div>
              ) : null}
              {Array.isArray(r.approvals) && r.approvals.length ? (
                <div className={`text-xs ${muted} flex flex-col gap-0.5`}>
                  {r.approvals.map((a, j) => (
                    <span key={j}>
                      {`${a.tool}${a.provider ? ` on ${a.provider}` : " (built-in)"} · ${DECISION_TEXT[a.decision] || a.decision}`}
                    </span>
                  ))}
                </div>
              ) : null}
              {r.error ? (
                <div className="text-red-300">{readableError(r.error)}</div>
              ) : null}
              {r.status === "failed" ? (
                <div className="flex flex-row flex-wrap gap-2">
                  {errorNextSteps(readableError(r.error) || "failed", {
                    isLead,
                  }).map((step) =>
                    step.action === "run-again" ? (
                      <Button3
                        key={step.action}
                        title={step.label}
                        size="xs"
                        onClick={() => runAgain(r.prompt)}
                      />
                    ) : step.action === "change-model" ? (
                      onChangeModel ? (
                        <Button3
                          key={step.action}
                          title={step.label}
                          size="xs"
                          onClick={() => onChangeModel()}
                        />
                      ) : null
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
              ) : null}
              {r.outputUnavailable ? (
                <div className={muted}>
                  Answer unavailable — it was stored encrypted with a key this
                  app can&apos;t read.
                </div>
              ) : r.output ? (
                <div className="whitespace-pre-wrap leading-relaxed">
                  {toPlainText(r.output)}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
};
