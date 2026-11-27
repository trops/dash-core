/**
 * NeedsYouCards — what a job's step needs from you, as a card with its
 * action (DASH-113). One set of cards for both job views — the Jobs page's
 * step timeline (JobsPage) and a bot's job opened from its activity
 * (BotJobDetail) — so they can't drift apart:
 *
 *   ApproveCard       a "you" check: its work, Approve / Send back (a note)
 *   AskCard           a handoff "ask": the question and an answer box
 *   CameCard          checks that need a look: Send it back / Close
 *   ToolApprovalCard  a tool approval: Allow once / Deny
 *   PausedCard        a paused bot: Resume
 *   GoalNeedsYouCard  a bot's checks job (a goal): whichever of the first
 *                     three it waits on, or nothing
 *   BotApprovals      a bot's pending tool approvals, live
 *
 *   useApprovals()    every pending tool approval, kept fresh on
 *                     onApprovalsChanged (no leaving or refreshing)
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Button2,
  Button3,
  TextArea,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { whenText } from "../Issues/issueText";
import { ApprovalPreview } from "../Bots/ApprovalPreview";
import { approvalText } from "../Bots/DashTeamApprovals";
import { jobBot, jobTimeline } from "../Goals/jobTimeline";

const botsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

/** The card's frame: a warning box. */
const Box = ({ testId, children }) => {
  const status = useStatusTokens();
  return (
    <div
      data-testid={testId}
      className={`flex flex-col gap-3 p-4 rounded-lg border ${status.warning.accentBorder} ${status.warning.bg}`}
    >
      {children}
    </div>
  );
};

const Head = ({ children }) => {
  const status = useStatusTokens();
  return (
    <span className={`text-sm font-semibold ${status.warning.strongText}`}>
      {children}
    </span>
  );
};

/** A "you" check: the work being approved, Approve or Send back (a note). */
export const ApproveCard = ({
  botName,
  work,
  since,
  now,
  busy = false,
  onApprove,
  onSendBack,
}) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const [sending, setSending] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Box testId="job-waiting">
      <Head>
        {`Waiting for you to approve${since ? ` · since ${whenText(since, now)}` : ""}`}
      </Head>
      {sending ? (
        <TextArea
          label={`Why? ${botName} gets this with its next try.`}
          rows={2}
          value={reason}
          onChange={(v) => setReason(v)}
        />
      ) : (
        <div
          data-testid="job-work"
          className={`max-h-72 overflow-y-auto p-3 rounded-md border text-sm whitespace-pre-wrap ${hairline} ${fieldBg} ${strong}`}
        >
          {work || <span className={muted}>Its answer was empty.</span>}
        </div>
      )}
      <div className="flex flex-row items-center justify-end gap-2">
        {sending ? (
          <>
            <Button3
              title="Cancel"
              size="sm"
              onClick={() => {
                setSending(false);
                setReason("");
              }}
            />
            <Button2
              title="Send back"
              size="sm"
              danger
              disabled={busy || !reason.trim()}
              onClick={() => onSendBack(reason.trim())}
            />
          </>
        ) : (
          <>
            <Button3
              title="Send back…"
              size="sm"
              disabled={busy}
              onClick={() => setSending(true)}
            />
            <Button
              title="Approve"
              size="sm"
              disabled={busy}
              onClick={() => onApprove()}
            />
          </>
        )}
      </div>
    </Box>
  );
};

/**
 * A handoff's question (DASH-101): the question, an answer box (the
 * answer goes back to the bot, which goes on), and Close.
 */
export const AskCard = ({
  botName,
  question,
  busy = false,
  onAnswer,
  onClose,
}) => {
  const [answer, setAnswer] = useState("");
  return (
    <Box testId="job-asking">
      <Head>{`${botName} asks you`}</Head>
      <span className="text-sm whitespace-pre-wrap" data-testid="job-question">
        {question}
      </span>
      <TextArea
        label={`Your answer. ${botName} gets it and goes on.`}
        rows={2}
        value={answer}
        onChange={(v) => setAnswer(v)}
      />
      <div className="flex flex-row items-center justify-end gap-2">
        <Button3
          title="Close it (it fails)"
          size="sm"
          disabled={busy}
          onClick={() => onClose()}
        />
        <Button
          title="Send answer"
          size="sm"
          disabled={busy || !answer.trim()}
          onClick={() => onAnswer(answer.trim())}
        />
      </div>
    </Box>
  );
};

/** Checks that need a look: send it back for one more try, or close it. */
export const CameCard = ({
  botName,
  title,
  busy = false,
  onRetry,
  onClose,
}) => (
  <Box testId="job-came-card">
    <Head>{title || "Waiting for you"}</Head>
    <div className="flex flex-row flex-wrap gap-2">
      <Button2
        title={`Send it back to ${botName}`}
        size="sm"
        disabled={busy}
        onClick={() => onRetry()}
      />
      <Button3
        title="Close it (it fails)"
        size="sm"
        disabled={busy}
        onClick={() => onClose()}
      />
    </div>
  </Box>
);

/** A bot waiting on a tool approval: what it wants, Allow once or Deny. */
export const ToolApprovalCard = ({
  approval,
  botName,
  busy = false,
  onAnswer,
}) => {
  const { muted } = useConfigTokens();
  const request = (approval && approval.request) || {};
  return (
    <Box testId="job-approval">
      <Head>{approvalText(request, botName)}</Head>
      <ApprovalPreview request={request} />
      <span className={`text-xs ${muted}`}>
        {`Its run waits for your answer. Allow once lets ${botName || "it"} do this now; Deny and it's told no.`}
      </span>
      <div className="flex flex-row flex-wrap items-center justify-end gap-2">
        <Button3
          title="Deny"
          size="sm"
          disabled={busy}
          onClick={() => onAnswer({ allow: false })}
        />
        <Button
          title="Allow once"
          size="sm"
          disabled={busy}
          onClick={() => onAnswer({ allow: true })}
        />
      </div>
    </Box>
  );
};

/** A paused bot holds the job: Resume. */
export const PausedCard = ({ title, resumeTitle, busy = false, onResume }) => (
  <Box testId="job-paused">
    <Head>{title}</Head>
    <div>
      <Button
        title={resumeTitle}
        size="sm"
        disabled={busy}
        onClick={() => onResume()}
      />
    </div>
  </Box>
);

/**
 * What a bot's checks job waits on you for, from its timeline's last row:
 * { kind: "approve"|"ask"|"came", now, task, bot, tries } or null.
 */
export function goalNeedsYou(goal) {
  if (!goal || goal.closed) return null;
  const rows = jobTimeline(goal);
  const now = rows[rows.length - 1];
  const task = (goal.tasks || [])[0] || null;
  if (!now || !task) return null;
  const tries = rows.filter((r) => r.type === "try").length;
  const bot = jobBot(goal);
  if (now.state === "waiting")
    return { kind: "approve", now, task, bot, tries };
  if (now.state === "needs-you" && now.asks)
    return { kind: "ask", now, task, bot, tries };
  if (now.state === "needs-you") return { kind: "came", now, task, bot, tries };
  return null;
}

/**
 * The card a bot's checks job waits on you with, or nothing. `onAction`
 * (taskId, action) is the goals' task move (goals.taskAction).
 */
export const GoalNeedsYouCard = ({ goal, busy = false, onAction, now }) => {
  const need = goalNeedsYou(goal);
  if (!need) return null;
  const { task, bot, tries } = need;
  if (need.kind === "approve") {
    return (
      <ApproveCard
        botName={bot.name}
        work={need.now.work}
        since={need.now.since}
        now={now}
        busy={busy}
        onApprove={() => onAction(task.id, "done")}
        onSendBack={(reason) =>
          onAction(task.id, { type: "send-back", reason })
        }
      />
    );
  }
  if (need.kind === "ask") {
    return (
      <AskCard
        botName={bot.name}
        question={need.now.asks}
        busy={busy}
        onAnswer={(reason) => onAction(task.id, { type: "answer", reason })}
        onClose={() => onAction(task.id, "close")}
      />
    );
  }
  return (
    <CameCard
      botName={bot.name}
      title={
        need.now.failed
          ? `Waiting for you · it didn't pass on try ${Math.max(1, tries)}`
          : "Waiting for you"
      }
      busy={busy}
      onRetry={() => onAction(task.id, "one-more-round")}
      onClose={() => onAction(task.id, "close")}
    />
  );
};

/** Every pending tool approval, kept fresh as they come and go. */
export function useApprovals({ skip = false } = {}) {
  const [approvals, setApprovals] = useState([]);
  const reload = useCallback(async () => {
    const b = botsApi();
    if (skip || !b || typeof b.listApprovals !== "function") return;
    try {
      const list = await b.listApprovals();
      setApprovals(Array.isArray(list) ? list : []);
    } catch (_e) {
      // keep what's shown on a transient IPC error
    }
  }, []);
  useEffect(() => {
    reload();
    const b = botsApi();
    if (skip || !b) return undefined;
    const ids = [];
    // A change carries the whole list; a new one alone means read again.
    if (typeof b.onApprovalsChanged === "function") {
      ids.push(
        b.onApprovalsChanged((payload) =>
          payload && Array.isArray(payload.approvals)
            ? setApprovals(payload.approvals)
            : reload(),
        ),
      );
    }
    if (typeof b.onApprovalPending === "function") {
      ids.push(b.onApprovalPending(() => reload()));
    }
    return () => {
      for (const id of ids) {
        try {
          if (typeof b.removeListener === "function") b.removeListener(id);
        } catch (_e) {
          // already gone
        }
      }
    };
  }, [reload, skip]);
  return { approvals, reload };
}

/** A bot's pending approvals, from the list. */
export const approvalsOf = (approvals, botId) =>
  (approvals || []).filter(
    (a) =>
      a &&
      a.request &&
      botId != null &&
      String(a.request.botId) === String(botId),
  );

/** Answer a tool approval in Dash. */
export async function answerApproval(id, decision) {
  const b = botsApi();
  if (!b || typeof b.approve !== "function") return null;
  return b.approve(id, decision);
}

/**
 * A bot's pending tool approvals as cards. `approvals`: the list, when the
 * caller already reads it (else this reads it, live).
 */
export const BotApprovals = ({ botId, botName, approvals = null }) => {
  const own = useApprovals({ skip: !!approvals });
  const list = approvalsOf(approvals || own.approvals, botId);
  const [busy, setBusy] = useState(null);
  if (!list.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="job-approvals">
      {list.map((a) => (
        <ToolApprovalCard
          key={a.id}
          approval={a}
          botName={botName}
          busy={busy === a.id}
          onAnswer={async (decision) => {
            setBusy(a.id);
            try {
              await answerApproval(a.id, decision);
            } finally {
              setBusy(null);
              if (!approvals) own.reload();
            }
          }}
        />
      ))}
    </div>
  );
};
