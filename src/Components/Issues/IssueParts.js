import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Button2, Button3, useStatusTokens } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import {
  argsText,
  callText,
  countText,
  errorText,
  rawErrorText,
  whenLongText,
  whenText,
} from "./issueText";
import {
  fixWithAi,
  hasDebugConsole,
  openDebugConsole,
  openProvider,
  providerOf,
  retryWidget,
} from "./issueActions";

/**
 * Retry with feedback: `retry()` runs this copy again (or opens its
 * dashboard) and `note` says what happened — "Retrying…" — for a few
 * seconds.
 */
export function useRetryWidget(issue, { workspaces = [], onOpen = null } = {}) {
  const [note, setNote] = useState("");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const retry = useCallback(() => {
    const res = retryWidget(issue, { workspaces, onOpen });
    setNote(res.message || "");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(""), 4000);
    return res;
  }, [issue, workspaces, onOpen]);
  return { retry, note };
}

/** A severity dot: red for a problem, amber for a warning, green for fine. */
export const IssueDot = ({ severity = "problem", className = "" }) => {
  const status = useStatusTokens();
  const tone =
    severity === "warning"
      ? status.warning.solidBg
      : severity === "ok"
        ? status.success.solidBg
        : status.error.solidBg;
  return (
    <span
      aria-hidden="true"
      className={`inline-block flex-shrink-0 h-2 w-2 rounded-full ${tone} ${className}`}
    />
  );
};

/** Label / value lines (Call, Asked with, Error, …). */
export const IssueFacts = ({ rows = [] }) => {
  const { muted } = useConfigTokens();
  const status = useStatusTokens();
  const shown = rows.filter((r) => r && r.value);
  if (!shown.length) return null;
  return (
    <dl className="flex flex-col gap-1.5 text-xs" data-testid="issue-facts">
      {shown.map((r) => (
        <div key={r.label} className="flex flex-row gap-3 min-w-0">
          <dt className={`w-24 flex-shrink-0 ${muted}`}>{r.label}</dt>
          <dd
            className={`flex-1 min-w-0 break-words ${
              r.mono ? "font-mono" : ""
            } ${r.bad ? status.error.text : ""}`}
          >
            {r.value}
            {r.raw ? <RawToggle raw={r.raw} /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
};

/**
 * The error as it came back (a provider's JSON), hidden behind "Show raw":
 * the readable message is what people see first.
 */
const RawToggle = ({ raw }) => {
  const [open, setOpen] = useState(false);
  const { muted, hairline } = useConfigTokens();
  return (
    <span className="flex flex-col gap-1 pt-1">
      <span>
        <Button3
          title={open ? "Hide raw" : "Show raw"}
          size="xs"
          onClick={() => setOpen((o) => !o)}
        />
      </span>
      {open ? (
        <pre
          data-testid="issue-raw-error"
          className={`p-2 rounded-lg border whitespace-pre-wrap break-all font-mono ${hairline} ${muted}`}
        >
          {raw}
        </pre>
      ) : null}
    </span>
  );
};

/** The facts of an issue's call. */
export function callRows(issue, { withProvider = false, now } = {}) {
  const call = (issue && issue.call) || null;
  return [
    withProvider && call && call.provider
      ? { label: "Provider", value: call.provider }
      : null,
    {
      label: "Call",
      value: withProvider ? call && call.tool : callText(call),
      mono: true,
    },
    { label: "Asked with", value: call ? argsText(call.args) : "", mono: true },
    {
      label: "Error",
      value: errorText(issue),
      raw: rawErrorText(issue),
      mono: true,
      bad: true,
    },
  ].filter(Boolean);
}

/**
 * A widget's open issues, in its panel (the "Problems" section): what went
 * wrong (the call, what it was asked with, the error, when), the likely
 * cause, and Retry / Open <provider> / Fix with AI / Show in Debug Console;
 * earlier problems below.
 */
export const WidgetProblems = ({ issues = [], now = new Date() }) => {
  const { muted, strong } = useConfigTokens();
  const status = useStatusTokens();
  const issue = issues[0];
  const { retry, note } = useRetryWidget(issue);
  if (!issue) return null;
  const provider = providerOf(issue);
  const count = countText(issue, now);
  const earlier = [
    ...(issue.recent || []).slice(1).map((r, i) => ({
      key: `r${i}`,
      when: whenText(r.at, now),
      what: r.message,
    })),
    ...issues.slice(1).map((i) => ({
      key: i.id,
      when: whenText(i.lastAt, now),
      what: i.title,
    })),
  ].filter((e) => e.what);
  return (
    <div className="flex flex-col gap-3" data-testid="widget-problems">
      <div
        className={`flex flex-col gap-2.5 p-3 rounded-lg border ${status.error.border} ${status.error.bg}`}
      >
        <span className="flex flex-row items-center gap-2">
          <IssueDot severity={issue.severity} />
          <span className={`text-sm font-semibold ${strong}`}>
            What went wrong
          </span>
          <span className="flex-1" />
          {count ? <span className={`text-xs ${muted}`}>{count}</span> : null}
        </span>
        <span className={`text-sm ${strong}`}>{issue.title}</span>
        {issue.message && !(issue.call && issue.call.error) ? (
          <span className={`text-xs font-mono ${status.error.text}`}>
            {issue.message}
          </span>
        ) : null}
        <IssueFacts
          rows={[
            ...(issue.call ? callRows(issue) : []),
            issue.shown ? { label: "Widget showed", value: issue.shown } : null,
            { label: "Last", value: whenLongText(issue.lastAt, now) },
          ]}
        />
        {issue.hint ? (
          <span className={`text-xs ${muted}`}>
            {`Likely cause: ${issue.hint}`}
          </span>
        ) : null}
        <span className="flex flex-row flex-wrap items-center gap-2">
          <Button title="Retry" size="sm" onClick={() => retry()} />
          {provider ? (
            <Button2
              title={`Open ${provider}`}
              size="sm"
              onClick={() => openProvider(provider)}
            />
          ) : null}
          <Button2
            title="Fix with AI"
            size="sm"
            onClick={() => fixWithAi(issue)}
          />
          {hasDebugConsole() ? (
            <Button3
              title="Show in Debug Console"
              size="sm"
              onClick={() => openDebugConsole()}
            />
          ) : null}
        </span>
        {note ? (
          <span role="status" className={`text-xs ${muted}`}>
            {note}
          </span>
        ) : null}
      </div>
      {earlier.length ? (
        <div className="flex flex-col gap-1">
          <span className={`text-xs font-semibold ${muted}`}>Earlier</span>
          {earlier.map((e) => (
            <span key={e.key} className="flex flex-row gap-2 text-xs">
              <span className={`w-20 flex-shrink-0 ${muted}`}>{e.when}</span>
              <span className={`min-w-0 ${strong}`}>{e.what}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};
