/**
 * StepMessage.js — a job step as its bot's message (DASH-123): the bot's
 * avatar and name, its prose as Markdown in a chat bubble, and its handoff
 * as a compact card (status, work item, summary, picks, details), the
 * pretty-printed JSON behind "Show handoff JSON". Both show, apart from
 * what the bot wrote, what Dash carries from the job to every bot (its
 * work item and workspace), marked "from the job".
 *
 *   StepProse      the prose as Markdown, long ones behind "Show more"
 *   HandoffCard    a handoff's card
 *   HandoffJson    the handoff's JSON, pretty-printed, monospace
 */
import React, { useState } from "react";
import { useStatusTokens } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { renderSafeMarkdown } from "../../utils/safeMarkdown";
import {
  carriedJson,
  handoffJson,
  shortenMarkdown,
  shortenText,
} from "./stepView";

const MAX_PROSE = 700;
const MAX_DETAIL = 280;

const openLink = (url) => {
  const shell = typeof window !== "undefined" && window.mainApi?.shell;
  if (shell && shell.openExternal) shell.openExternal(url);
};

/** A "Show more" / "Show less" link. */
const MoreLink = ({ open, onClick, testId }) => {
  const { muted } = useConfigTokens();
  return (
    <button
      type="button"
      className={`underline text-xs ${muted}`}
      onClick={onClick}
      data-testid={testId}
    >
      {open ? "Show less" : "Show more"}
    </button>
  );
};

/** The bot's prose, as Markdown; a long one shortened, never mid-block. */
export const StepProse = ({ text }) => {
  const [open, setOpen] = useState(false);
  const short = shortenMarkdown(text, MAX_PROSE);
  const shown = open || !short.cut ? text : short.text;
  return (
    <div className="flex flex-col items-start gap-1">
      <div
        data-testid="job-step-prose"
        className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 leading-relaxed break-words"
        // Sanitized: answers can quote untrusted content.
        dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(shown) }}
      />
      {short.cut ? (
        <MoreLink
          open={open}
          onClick={() => setOpen(!open)}
          testId="job-step-prose-more"
        />
      ) : null}
    </div>
  );
};

/** One detail of a handoff, shortened at a word with "Show more". */
const Detail = ({ text }) => {
  const [open, setOpen] = useState(false);
  const short = shortenText(text, MAX_DETAIL);
  return (
    <span className="whitespace-pre-wrap break-words">
      {open || !short.cut ? text : short.text}{" "}
      {short.cut ? (
        <MoreLink
          open={open}
          onClick={() => setOpen(!open)}
          testId="handoff-detail-more"
        />
      ) : null}
    </span>
  );
};

const Row = ({ label, children, testId, title }) => {
  const { muted } = useConfigTokens();
  return (
    <>
      <span className={`text-xs pt-0.5 ${muted}`}>{label}</span>
      <span
        className="min-w-0 text-sm break-words"
        data-testid={testId}
        title={title}
      >
        {children}
      </span>
    </>
  );
};

/** A work item: its id (a link when it has a url) and title. */
const ItemValue = ({ item, testId }) => (
  <>
    {item.url ? (
      <button
        type="button"
        className="underline"
        data-testid={testId}
        onClick={() => openLink(item.url)}
      >
        {item.id}
      </button>
    ) : (
      <span>{item.id}</span>
    )}
    {item.title ? <span>{` · ${item.title}`}</span> : null}
  </>
);

/** " · from the job", after a carried value. */
const FromJob = () => {
  const { muted } = useConfigTokens();
  return <span className={`text-xs ${muted}`}>{" · from the job"}</span>;
};

/** What the job carries to every bot, apart from the bot's own rows. */
const CarriedRows = ({ fromJob }) => {
  const { muted, hairline } = useConfigTokens();
  return (
    <div
      data-testid="handoff-from-job"
      className={`col-span-2 grid gap-x-3 gap-y-1.5 pt-1.5 mt-0.5 border-t border-dashed ${hairline}`}
      style={{ gridTemplateColumns: "auto minmax(0, 1fr)" }}
    >
      <span className={`col-span-2 text-xs ${muted}`}>
        From the job: Dash gives these to every bot in it
      </span>
      {fromJob.item ? (
        <Row label={fromJob.item.label} testId="handoff-job-item">
          <ItemValue item={fromJob.item} testId="handoff-job-item-link" />
          <FromJob />
        </Row>
      ) : null}
      {fromJob.workspace ? (
        <Row
          label="Workspace"
          testId="handoff-job-workspace"
          title={fromJob.workspace.dir}
        >
          <span className="font-mono text-xs">{fromJob.workspace.text}</span>
          <FromJob />
        </Row>
      ) : null}
    </div>
  );
};

/** A handoff's card (handoffCard's rows). */
export const HandoffCard = ({ card }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const tokens = useStatusTokens();
  if (!card) return null;
  const tone = card.status.tone ? tokens[card.status.tone] || {} : null;
  return (
    <div
      data-testid="handoff-card"
      className={`w-full grid gap-x-3 gap-y-1.5 px-3 py-2 rounded-md border ${hairline} ${fieldBg} ${strong}`}
      style={{ gridTemplateColumns: "auto minmax(0, 1fr)" }}
    >
      <Row label={card.status.label} testId="handoff-status">
        <span
          className={`font-semibold ${tone ? tone.strongText || tone.text : muted}`}
        >
          {card.status.word}
        </span>
      </Row>
      {card.item ? (
        <Row label={card.item.label} testId="handoff-item">
          <ItemValue item={card.item} testId="handoff-item-link" />
        </Row>
      ) : null}
      {card.workspace ? (
        <Row
          label="Workspace"
          testId="handoff-workspace"
          title={card.workspace.dir}
        >
          <span className="font-mono text-xs">{card.workspace.text}</span>
        </Row>
      ) : null}
      {card.summary ? (
        <Row label="Summary" testId="handoff-summary">
          <Detail text={card.summary} />
        </Row>
      ) : null}
      {card.question ? (
        <Row label="Question" testId="handoff-question">
          <Detail text={card.question} />
        </Row>
      ) : null}
      {card.items.length ? (
        <Row label="Split into" testId="handoff-items">
          {card.items.join(", ")}
        </Row>
      ) : null}
      {card.picks.length ? (
        <Row label="Picked" testId="handoff-picks">
          {card.picks.map((p) => `${p.name}: ${p.value}`).join(" · ")}
        </Row>
      ) : null}
      {card.details.map((d) => (
        <Row key={d.key} label={d.label} testId="handoff-detail">
          <Detail text={d.text} />
        </Row>
      ))}
      {card.clipped ? (
        <Row label="Note">
          <span className={muted}>
            Too big to keep whole; its activity has the full answer.
          </span>
        </Row>
      ) : null}
      {card.fromJob ? <CarriedRows fromJob={card.fromJob} /> : null}
    </div>
  );
};

/**
 * The handoff's JSON, pretty-printed: what the bot wrote, then (when the
 * job has any) what Dash carries from the job, in its own block.
 */
export const HandoffJson = ({ handoff, job = null }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const carried = carriedJson(job);
  const pre = `w-full max-h-80 overflow-auto p-3 rounded-md border font-mono text-xs whitespace-pre-wrap break-words ${hairline} ${fieldBg} ${strong}`;
  if (!carried) {
    return (
      <pre data-testid="handoff-json" className={pre}>
        {handoffJson(handoff)}
      </pre>
    );
  }
  return (
    <div className="w-full flex flex-col gap-1.5">
      <span className={`text-xs ${muted}`}>What the bot wrote</span>
      <pre data-testid="handoff-json" className={pre}>
        {handoffJson(handoff)}
      </pre>
      <span className={`text-xs ${muted}`}>
        From the job: Dash gives these to every bot in it
      </span>
      <pre
        data-testid="handoff-json-from-job"
        className={`${pre} border-dashed`}
      >
        {carried}
      </pre>
    </div>
  );
};
