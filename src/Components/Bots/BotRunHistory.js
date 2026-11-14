import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  Button3,
  StatusBadge,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import {
  INTERRUPTED_TEXT,
  askedText,
  errorNextSteps,
  mcpViaLabel,
  readableError,
  toPlainText,
  triggerLabel,
} from "./botConversation";
import { runCostLabel, runCostShort } from "../../utils/runCostLabel";
import { openRunConversation, runConversation } from "./runConversation";
import { openProvider } from "../Issues/issueActions";
import { quotedError } from "../Issues/issueText";

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
  "read-only": "read-only, ran without asking",
};

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}
// A run's status as a pill (StatusBadge state).
const STATUS_STATE = {
  completed: "success",
  failed: "error",
  running: "info",
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

/**
 * A run's warnings (issues PRD): [{ message, provider, detail }]. The store
 * keeps them sealed as a JSON string; older runs have an array (strings
 * allowed).
 */
export function runWarningList(run) {
  let list = run && run.warnings;
  if (typeof list === "string") {
    try {
      list = list ? JSON.parse(list) : [];
    } catch (_e) {
      list = [];
    }
  }
  return (Array.isArray(list) ? list : [])
    .map((w) =>
      typeof w === "string"
        ? { message: w, provider: "", detail: "" }
        : w && typeof w === "object" && w.message
          ? {
              message: String(w.message),
              provider: w.provider ? String(w.provider) : "",
              detail: w.detail ? String(w.detail) : "",
            }
          : null,
    )
    .filter(Boolean);
}

/** A run's warnings, as their messages. */
export function runWarnings(run) {
  return runWarningList(run).map((w) => w.message);
}

/** The pill's state: a completed run with warnings is a warning. */
export function runStatusState(run) {
  const s = run && run.status;
  if (s === "completed" && runWarningList(run).length) return "warning";
  return STATUS_STATE[s] || "neutral";
}

/**
 * Why each failed tool call failed: run.toolErrors (a JSON string, or an
 * array) → { [index into run.toolCalls]: { args, error } }.
 */
export function runToolErrors(run) {
  let list = run && run.toolErrors;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch (_e) {
      list = [];
    }
  }
  const out = {};
  for (const e of Array.isArray(list) ? list : []) {
    if (e && Number.isInteger(e.call)) {
      out[e.call] = { args: e.args, error: e.error ? String(e.error) : "" };
    }
  }
  return out;
}

/** What a call was asked with, compact — or "". */
function askedWith(args) {
  if (args == null || args === "") return "";
  let v = args;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch (_e) {
      return v;
    }
  }
  if (v && typeof v === "object" && !Object.keys(v).length) return "";
  try {
    return JSON.stringify(v);
  } catch (_e) {
    return "";
  }
}

/** Fix with AI: Ask AI, with what went wrong in this run. */
function fixRunWithAi(bot, run, problem) {
  if (typeof window === "undefined" || !bot) return;
  const what = problem || readableError(run && run.error) || "";
  // The error is quoted and clipped: what it said, for the AI to read as data.
  const said = what
    ? ` The error said: ${quotedError(String(what).replace(/[.\s]+$/, ""))}.`
    : "";
  window.dispatchEvent(
    new CustomEvent("dash:open-workspace", {
      detail: {
        key: "role:dashlead",
        draft: `${bot.name || "A bot"} had a problem in a run.${said} Help me fix it.`,
      },
    }),
  );
}

/** "Completed", or "Completed · 1 warning". */
export function runStatusLabel(run) {
  const base = statusLabel(run && run.status);
  const n = runWarnings(run).length;
  return n ? `${base} · ${n} warning${n === 1 ? "" : "s"}` : base;
}

// What started it: a task via MCP (TEAM-016) says so, not just "Asked".
function startedBy(run) {
  if (mcpViaLabel(run.via)) return "via MCP";
  return TRIGGER_LABELS[run.trigger] || statusLabel(run.trigger);
}

/**
 * What went wrong in a run, shown on its row (not only when opened): a
 * warning box — each warning, "Check <provider>" for one about a provider,
 * Run again, Fix with AI — and each failed call with why and what it was
 * asked with.
 */
export const RunProblems = ({ run, bot, onRunAgain = null }) => {
  const status = useStatusTokens();
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const muted = `${currentTheme["text-neutral-medium"] || ""} dr-role-muted`;
  const warnings = runWarningList(run);
  const toolErrors = runToolErrors(run);
  const failed = (Array.isArray(run && run.toolCalls) ? run.toolCalls : [])
    .map((c, j) => ({ c, j, why: toolErrors[j] || null }))
    .filter((x) => x.c && x.c.ok === false);
  if (!warnings.length && !failed.length) return null;
  const providers = [
    ...new Set(warnings.map((w) => w.provider).filter(Boolean)),
  ];
  return (
    <div className="flex flex-col gap-1.5 pb-2.5 text-xs">
      {warnings.length ? (
        <div
          role="note"
          data-testid="run-warnings"
          className={`flex flex-col gap-1 px-3 py-2 rounded-lg border ${status.warning.border} ${status.warning.bg} ${status.warning.text}`}
        >
          {warnings.map((w, j) => (
            <span key={j} className="flex flex-col gap-0.5">
              <span>{w.message}</span>
              {w.detail && w.detail !== w.message ? (
                <span className="font-mono break-all">{w.detail}</span>
              ) : null}
            </span>
          ))}
          {bot ? (
            <span className="flex flex-row flex-wrap gap-2 pt-0.5">
              {providers.map((p) => (
                <Button3
                  key={p}
                  title={`Check ${p}`}
                  size="xs"
                  onClick={() => openProvider(p)}
                />
              ))}
              {onRunAgain ? (
                <Button3
                  title="Run again"
                  size="xs"
                  onClick={() => onRunAgain(run.prompt)}
                />
              ) : null}
              <Button3
                title="Fix with AI"
                size="xs"
                onClick={() => fixRunWithAi(bot, run, warnings[0].message)}
              />
            </span>
          ) : null}
        </div>
      ) : null}
      {failed.map(({ c, j, why }) => {
        const asked = why ? askedWith(why.args) : "";
        return (
          <span
            key={j}
            data-testid="run-failed-call"
            className="flex flex-col gap-0.5"
          >
            <span className={`font-mono ${status.error.text}`}>
              {[c.tool, c.provider, "failed"].filter(Boolean).join(" · ")}
            </span>
            {why && why.error ? (
              <span
                data-testid="tool-call-error"
                className={`pl-3 ${status.error.text}`}
              >
                {why.error}
              </span>
            ) : null}
            {asked ? (
              <span
                data-testid="tool-call-args"
                className={`pl-3 font-mono break-all ${muted}`}
              >
                {`Asked with ${asked}`}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
};

function firstLine(run) {
  if (run.status === "failed" && run.error) return readableError(run.error);
  if (run.outputUnavailable) return "Answer unavailable";
  if (run.status === "interrupted" && !run.output) return INTERRUPTED_TEXT;
  return toPlainText(run.output || "").split("\n")[0];
}

/**
 * An opened run: its cost, attempts, the conversation it came from, what
 * started it, the prompt, tool calls, approvals, an error with next steps,
 * and the answer. Shared by BotRunHistory and a lead's Activity list.
 */
export const RunDetails = ({
  run,
  bot,
  isLead = false,
  nameOf = undefined,
  onOpenSettings = null,
  onChangeModel = null,
  compact = false,
  // Its warnings and failed calls; off where the row already shows them.
  showProblems = true,
}) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const muted = `${currentTheme["text-neutral-medium"] || "text-gray-400"} dr-role-muted`;
  const status = useStatusTokens();
  const convo = runConversation(run, bot, nameOf);
  const runAgain = (prompt) => {
    const bots = api();
    if (!bots || !bot) return;
    if (isLead) bots.askLead(bot.id, prompt || "", false);
    else bots.run(bot.id, prompt || "", false);
  };
  return (
    <div className="flex flex-col gap-2 pb-3 text-sm">
      {showProblems ? (
        <RunProblems run={run} bot={bot} onRunAgain={runAgain} />
      ) : null}
      {runCostLabel(run) ? (
        <div className={`text-xs ${muted}`} data-testid="run-cost">
          {runCostLabel(run)}
        </div>
      ) : null}
      {run.attempts > 1 ? (
        <div className={`text-xs ${muted}`} data-testid="run-attempts">
          {`Took ${run.attempts} attempts — tried again after temporary trouble`}
        </div>
      ) : null}
      {convo ? (
        <div
          className={`flex flex-row items-center gap-2 text-xs ${muted}`}
          data-testid="run-conversation"
        >
          {convo.label}
          {compact ? (
            <Button3
              title="Open conversation"
              size="xs"
              onClick={() => openRunConversation(convo.open)}
            />
          ) : null}
        </div>
      ) : null}
      {triggerLabel(run, nameOf) ? (
        <div className={`text-xs ${muted}`}>{triggerLabel(run, nameOf)}</div>
      ) : null}
      {mcpViaLabel(run.via) ? (
        <div className={`text-xs ${muted}`}>{mcpViaLabel(run.via)}</div>
      ) : null}
      {run.prompt ? (
        <div>
          <div className={`text-xs ${muted}`}>Asked</div>
          <div className="whitespace-pre-wrap">{askedText(run)}</div>
        </div>
      ) : null}
      {Array.isArray(run.toolCalls) && run.toolCalls.length ? (
        <div className={`text-xs ${muted} flex flex-col gap-0.5`}>
          {/* Every call; why a failed one failed is above (RunProblems). */}
          {run.toolCalls.map((c, j) => (
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
      {Array.isArray(run.approvals) && run.approvals.length ? (
        <div className={`text-xs ${muted} flex flex-col gap-0.5`}>
          {run.approvals.map((a, j) => (
            <span key={j}>
              {`${a.tool}${a.provider ? ` on ${a.provider}` : " (built-in)"} · ${DECISION_TEXT[a.decision] || a.decision}`}
            </span>
          ))}
        </div>
      ) : null}
      {run.error ? (
        <div className={status.error.text}>{readableError(run.error)}</div>
      ) : null}
      {run.status === "failed" ? (
        <div className="flex flex-row flex-wrap gap-2">
          {errorNextSteps(readableError(run.error) || "failed", {
            isLead,
          }).map((step) =>
            step.action === "run-again" ? (
              <Button3
                key={step.action}
                title={step.label}
                size="xs"
                onClick={() => runAgain(run.prompt)}
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
          {bot ? (
            <Button3
              title="Fix with AI"
              size="xs"
              onClick={() => fixRunWithAi(bot, run)}
            />
          ) : null}
        </div>
      ) : null}
      {run.outputUnavailable ? (
        <div className={muted}>
          Answer unavailable — it was stored encrypted with a key this app
          can&apos;t read.
        </div>
      ) : run.output ? (
        <div className="whitespace-pre-wrap leading-relaxed">
          {toPlainText(run.output)}
        </div>
      ) : null}
    </div>
  );
};

export const BotRunHistory = ({
  bot,
  isLead = false,
  nameOf = undefined,
  onOpenSettings = null,
  onChangeModel = null,
  // The dock's narrow panel (TEAM-015): each run on two lines.
  compact = false,
}) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const muted = `${currentTheme["text-neutral-medium"] || "text-gray-400"} dr-role-muted`;
  const strong = `${currentTheme["text-neutral-light"] || "text-gray-200"} dr-role-text`;
  const hairline = `${currentTheme["border-neutral-dark"] || "border-gray-700"} dr-role-hairline`;
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
      {runs.map((r, i) => {
        // The conversation it came from (lead-workspace release 5).
        const convo = runConversation(r, bot, nameOf);
        return (
          <div key={i} className={`border-b ${hairline}`}>
            <div className="flex flex-row items-center gap-3">
              <button
                type="button"
                data-testid="run-row"
                onClick={() => setOpen(open === i ? null : i)}
                className={
                  compact
                    ? "flex-1 min-w-0 text-left flex flex-col gap-1 py-2.5 text-sm"
                    : "flex-1 min-w-0 text-left flex flex-row gap-3 items-center py-2.5 text-sm"
                }
                aria-expanded={open === i}
              >
                {compact ? (
                  <>
                    <span className="flex flex-row items-center gap-1.5 text-xs">
                      <StatusBadge
                        state={runStatusState(r)}
                        label={runStatusLabel(r)}
                      />
                      <span className={muted}>· {when(r)}</span>
                      <span className="flex-1" />
                      {runCostShort(r) ? (
                        <span className={muted}>{runCostShort(r)}</span>
                      ) : null}
                    </span>
                    <span className="min-w-0 truncate">
                      <span className={muted}>{startedBy(r)} · </span>
                      {firstLine(r)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={`w-28 flex-shrink-0 ${muted}`}>
                      {when(r)}
                    </span>
                    <span className={`w-20 flex-shrink-0 ${muted}`}>
                      {startedBy(r)}
                    </span>
                    <span
                      className={`${
                        runWarnings(r).length ? "w-40" : "w-28"
                      } flex-shrink-0 flex flex-row items-center text-xs`}
                    >
                      <StatusBadge
                        state={runStatusState(r)}
                        label={runStatusLabel(r)}
                      />
                    </span>
                    <span className="flex-1 min-w-0 truncate">
                      {firstLine(r)}
                    </span>
                    {runCostShort(r) ? (
                      <span className={`flex-shrink-0 text-xs ${muted}`}>
                        {runCostShort(r)}
                      </span>
                    ) : null}
                  </>
                )}
              </button>
              {convo && !compact ? (
                <span
                  className={`flex-shrink-0 text-xs ${muted}`}
                  data-testid="run-conversation-label"
                >
                  {convo.label}
                </span>
              ) : null}
              {convo && !compact ? (
                <Button3
                  title="Open conversation"
                  size="xs"
                  ariaLabel={`Open conversation — ${convo.label}`}
                  onClick={() => openRunConversation(convo.open)}
                />
              ) : null}
            </div>
            <RunProblems run={r} bot={bot} onRunAgain={runAgain} />
            {open === i ? (
              <RunDetails
                showProblems={false}
                run={r}
                bot={bot}
                isLead={isLead}
                nameOf={nameOf}
                onOpenSettings={onOpenSettings}
                onChangeModel={onChangeModel}
                compact={compact}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
