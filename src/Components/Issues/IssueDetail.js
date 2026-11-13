import React, { useContext, useState } from "react";
import { Button, Button2, Button3, StatusBadge } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import {
  IssueDot,
  IssueFacts,
  MuteButton,
  callRows,
  useRetryWidget,
} from "./IssueParts";
import { IssueKindBadge } from "./IssueRow";
import {
  assetName,
  detailLine,
  firstLineClipped,
  isSignInIssue,
  mutedCountText,
  mutedSinceText,
  rawErrorText,
  whenText,
} from "./issueText";
import {
  fixWithAi,
  openBot,
  openProvider,
  openWidgetDashboard,
  providerOf,
  reconnectProvider,
  resolveIssue,
  signsInWithCommand,
  unmuteIssue,
} from "./issueActions";

const norm = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .replace(/[.…\s]+$/, "")
    .trim();

/**
 * The headline and the Error line, saying the message once: a bot warning's
 * title is often "<bot>: <the message>" — then the title is clipped to its
 * first line and the full message shows once, as the error (or not at all
 * when the title already says all of it).
 * → { title, error }
 */
export function headlineOf(issue) {
  if (!issue) return { title: "", error: "" };
  const title = String(issue.title || "");
  const message = String(issue.message || "");
  if (!message) return { title, error: "" };
  const name = assetName(issue);
  const rest = norm(
    title.startsWith(`${name}: `) ? title.slice(name.length + 2) : title,
  );
  const msg = norm(message);
  const repeats = !!rest && (msg === rest || msg.startsWith(rest));
  if (!repeats) return { title, error: message };
  if (msg === rest && title.length <= 120) return { title, error: "" };
  return { title: firstLineClipped(title, 90), error: message };
}

/** The issue's timeline, newest first: resolved, each time, the first time. */
export function timelineOf(issue, now = new Date()) {
  if (!issue) return [];
  const out = [];
  if (issue.status === "resolved" && issue.resolvedAt) {
    out.push({
      key: "resolved",
      when: whenText(issue.resolvedAt, now),
      what: "Resolved",
      tone: "ok",
    });
  }
  const recent = Array.isArray(issue.recent) ? issue.recent : [];
  // When it was muted, between the times it happened.
  const mutedAt = issue.status === "muted" ? Date.parse(issue.mutedAt) : NaN;
  let mutedShown = Number.isNaN(mutedAt);
  const mutedEntry = () => {
    mutedShown = true;
    out.push({
      key: "muted",
      when: whenText(issue.mutedAt, now),
      what: "You muted it",
      tone: "muted",
    });
  };
  const tool = issue.call && issue.call.tool;
  const known = [issue.message, issue.call && issue.call.error, issue.title]
    .filter(Boolean)
    .map((s) => String(s).trim());
  // The same thing again says so — short — never the whole error again.
  const said = (message) => {
    const m = String(message || "").trim();
    if (!m || known.includes(m))
      return tool ? `${tool} failed` : "Happened again";
    return firstLineClipped(m);
  };
  const firstShown = (issue.count || 1) <= recent.length;
  recent.forEach((r, i) => {
    if (!mutedShown && Date.parse(r.at) < mutedAt) mutedEntry();
    out.push({
      key: `r${i}`,
      when: whenText(r.at, now),
      what:
        firstShown && i === recent.length - 1
          ? tool
            ? `${tool} failed for the first time`
            : "It happened for the first time"
          : said(r.message),
      tone: issue.status === "muted" ? "muted" : issue.severity,
    });
  });
  if (!mutedShown) mutedEntry();
  if (!firstShown && issue.firstAt) {
    out.push({
      key: "first",
      when: whenText(issue.firstAt, now),
      what: tool
        ? `${tool} failed for the first time`
        : "It happened for the first time",
      tone: issue.severity,
    });
  }
  return out;
}

/**
 * IssueDetail — one issue on the Issues page: its title, where and when,
 * the provider, call, what it was asked with and the error, what the widget
 * showed, the likely cause, its timeline, and what to do — Reconnect /
 * Sign in, Retry, Fix with AI, Open the widget (or bot, or provider), Mark
 * resolved.
 */
export const IssueDetail = ({
  issue,
  dashApi = null,
  workspaces = [],
  onOpenWorkspace = null,
  onUnmuted = null,
  now = new Date(),
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const app = useContext(AppContext) || {};
  const providers = app.providers || {};
  const api = dashApi || app.dashApi || null;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const { retry, note: retryNote } = useRetryWidget(issue, {
    workspaces,
    onOpen: onOpenWorkspace,
  });
  if (!issue) return null;
  const a = issue.asset || {};
  const kind = a.kind;
  const providerName = providerOf(issue);
  const provider = providerName ? providers[providerName] : null;
  const isMcp = !!(provider && provider.providerClass === "mcp");
  // Reconnect only when the provider is what failed — not when a tool call
  // failed on what it was given (a bad address, a missing note).
  const providerAtFault =
    kind === "provider" ||
    !!(issue && issue.related && issue.related.provider) ||
    !!(issue && issue.call && issue.call.tool === "connect") ||
    (issue && ["start", "sign-in", "provider"].includes(issue.cause));
  const signIn = kind === "provider" && isSignInIssue(issue);
  // Sign in with its own command; without one (OAuth), Reconnect asks for
  // the sign-in again.
  const signInHere = signIn && signsInWithCommand(provider);
  const open = issue.status === "open";
  const isMuted = issue.status === "muted";
  const { title, error } = headlineOf(issue);

  const reconnect = async () => {
    setBusy(true);
    setNote("");
    const res = await reconnectProvider(api, providerName, provider);
    setBusy(false);
    setNote(
      res.ok
        ? `${providerName} started again.`
        : `${providerName} didn't start: ${res.message}`,
    );
  };

  const timeline = timelineOf(issue, now);

  return (
    <section
      aria-label="Issue"
      data-testid="issue-detail"
      className="flex flex-col gap-3 min-h-0"
    >
      <span className="flex flex-row items-center gap-2">
        <IssueDot severity={open ? issue.severity : isMuted ? "muted" : "ok"} />
        <h3 className={`text-lg font-semibold ${strong}`}>{title}</h3>
        <IssueKindBadge kind={kind} />
        {isMuted ? <StatusBadge state="neutral" label="Muted" /> : null}
      </span>
      <span className={`text-sm ${muted}`}>{detailLine(issue, now)}</span>

      <IssueFacts
        rows={[
          ...(issue.call
            ? callRows(issue, { withProvider: true })
            : [
                {
                  label: "Error",
                  value: error,
                  raw: rawErrorText(issue),
                  mono: true,
                  bad: true,
                },
              ]),
          issue.shown && kind === "widget"
            ? { label: "Widget showed", value: `"${issue.shown}"` }
            : null,
        ]}
      />

      {issue.hint ? (
        <div
          role="note"
          className={`p-3 rounded-lg border text-sm ${hairline} ${selectedBg} ${strong}`}
        >
          {`Likely cause: ${issue.hint}`}
        </div>
      ) : null}

      {isMuted ? (
        <div
          role="note"
          data-testid="issue-muted"
          className={`flex flex-col gap-1 p-3 rounded-lg border ${hairline}`}
        >
          <span className={`text-sm font-semibold ${strong}`}>
            {mutedSinceText(issue, now)}
          </span>
          <span className={`text-xs ${muted}`}>
            This error doesn&apos;t show on cards, in the menu count or in Open.
            Dash still counts it, and other errors still show.
          </span>
          <span className={`text-xs ${strong}`}>{mutedCountText(issue)}</span>
        </div>
      ) : null}

      {timeline.length ? (
        <div className="flex flex-col gap-1.5" data-testid="issue-timeline">
          <span className={`text-xs font-semibold ${muted}`}>Timeline</span>
          {timeline.map((t) => (
            <span
              key={t.key}
              className="flex flex-row items-center gap-2.5 text-xs"
            >
              <span className={`w-20 flex-shrink-0 ${muted}`}>{t.when}</span>
              <IssueDot severity={t.tone} />
              <span className={`min-w-0 ${strong}`}>{t.what}</span>
            </span>
          ))}
        </div>
      ) : null}

      {note || retryNote ? (
        <span role="status" className={`text-sm ${muted}`}>
          {note || retryNote}
        </span>
      ) : null}

      <span
        className={`flex flex-row flex-wrap items-center gap-2 pt-3 border-t ${hairline}`}
      >
        {isMcp && providerAtFault ? (
          signInHere ? (
            <Button
              title={`Sign in to ${providerName}`}
              onClick={() => openProvider(providerName)}
            />
          ) : (
            <Button
              title={busy ? "Reconnecting…" : `Reconnect ${providerName}`}
              disabled={busy}
              onClick={reconnect}
            />
          )
        ) : null}
        {kind === "widget" ? (
          <Button2 title="Retry the call" onClick={() => retry()} />
        ) : null}
        <Button2 title="Fix with AI" onClick={() => fixWithAi(issue)} />
        {kind === "widget" && a.workspaceId != null ? (
          <Button2
            title="Open the widget"
            onClick={() =>
              openWidgetDashboard(issue, {
                workspaces,
                onOpen: onOpenWorkspace,
              })
            }
          />
        ) : null}
        {kind === "bot" && a.botId ? (
          <Button2 title="Open the bot" onClick={() => openBot(issue)} />
        ) : null}
        {providerName && !isMcp ? (
          <Button2
            title={`Open ${providerName}`}
            onClick={() => openProvider(providerName)}
          />
        ) : null}
        <span className="flex-1" />
        {open ? <MuteButton issue={issue} /> : null}
        {open ? (
          <Button3 title="Mark resolved" onClick={() => resolveIssue(issue)} />
        ) : null}
        {isMuted ? (
          <Button3
            title="Unmute"
            onClick={async () => {
              const where = await unmuteIssue(issue);
              if (where && onUnmuted) onUnmuted(issue, where);
            }}
          />
        ) : null}
      </span>
    </section>
  );
};

export default IssueDetail;
