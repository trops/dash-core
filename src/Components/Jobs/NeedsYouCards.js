/**
 * NeedsYouCards — what a job's step needs from you, as a card with its
 * action (DASH-113). One set of cards for both job views — the Jobs page's
 * step timeline (JobsPage) and a bot's job opened from its activity
 * (BotJobDetail) — so they can't drift apart:
 *
 *   ApproveCard       a "You approve" check: its work, Approve / Send back
 *                     (a note), Edit <bot>'s checks (DASH-124)
 *   AskCard           a handoff "ask": the question and an answer box
 *   CameCard          checks that need a look: Send it back / Close
 *   ToolApprovalCard  a tool approval: Allow once / Always allow / Deny
 *   PausedCard        a paused bot: Resume
 *   GoalNeedsYouCard  a bot's checks job (a goal): whichever of the first
 *                     three it waits on, or nothing
 *   BotApprovals      a bot's pending tool approvals, live
 *   BlockedCard       a run its setup refused a command or tool: what,
 *                     why, the fix, and its settings at that section
 *                     (DASH-115)
 *   BotPassedLine     another bot passed the check: a green line, no card
 *   StepNeedsYou      a job step's cards (DASH-124: job, team, conversation)
 *   TeamNeedsYouCards a team's waiting jobs and tool approvals as cards
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
import { jobTitleText, refusalSectionText } from "./jobText";
import { useGoal } from "../../hooks/useGoals";
import { useJobs } from "../../hooks/useJobs";
import { JobChecksWindow } from "./JobChecksWindow";
import {
  botPassText,
  botPassesOf,
  canAlwaysAllow,
  jobsNeedingYou,
  looseApprovals,
  youCheckLine,
  youCheckOf,
  youCheckTitle,
} from "./needsYouView";

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

/**
 * A "you" check (DASH-124): there's no separate approver — the bot's
 * check whose Who decides is "You approve" waits here. Its work, a note for
 * the bot if you send it back, Approve / Send back, and "Edit <bot>'s
 * checks ›" (the checks window over this page).
 */
export const ApproveCard = ({
  botName,
  work,
  since,
  now,
  checkName = null,
  busy = false,
  onApprove,
  onSendBack,
  onEditChecks = null,
}) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const [reason, setReason] = useState("");
  const line = [
    youCheckLine(botName, checkName),
    since ? `waiting since ${whenText(since, now)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Box testId="job-waiting">
      <div className="flex flex-col gap-0.5">
        <Head>{youCheckTitle(botName)}</Head>
        {line ? (
          <span className={`text-xs ${muted}`} data-testid="job-waiting-check">
            {line}
          </span>
        ) : null}
      </div>
      <div
        data-testid="job-work"
        className={`max-h-72 overflow-y-auto p-3 rounded-md border text-sm whitespace-pre-wrap ${hairline} ${fieldBg} ${strong}`}
      >
        {work || <span className={muted}>Its answer was empty.</span>}
      </div>
      <TextArea
        label={`Note for ${botName} if you send it back`}
        rows={2}
        value={reason}
        onChange={(v) => setReason(v)}
      />
      <div className="flex flex-row flex-wrap items-center gap-2">
        {onEditChecks ? (
          <Button3
            title={`Edit ${botName}'s checks ›`}
            size="sm"
            onClick={() => onEditChecks()}
          />
        ) : null}
        <span className="flex-1" />
        <Button3
          title="Send back"
          size="sm"
          disabled={busy || !reason.trim()}
          onClick={() => onSendBack(reason.trim())}
        />
        <Button
          title="Approve"
          size="sm"
          disabled={busy}
          onClick={() => onApprove()}
        />
      </div>
    </Box>
  );
};

/**
 * Another bot passed the check ("A bot reviews"): a compact green line in
 * place of a card — nothing needed from you.
 */
export const BotPassedLine = ({ goal }) => {
  const { muted } = useConfigTokens();
  const status = useStatusTokens();
  const passes = botPassesOf(goal);
  if (!passes.length) return null;
  const botName = jobBot(goal).name;
  return (
    <div className="flex flex-col gap-1" data-testid="job-bot-passed">
      {passes.map((p, i) => (
        <div
          key={i}
          className={`flex flex-col gap-0.5 px-3 py-2 rounded-md border ${status.success.border} ${status.success.bg}`}
        >
          <span className={`text-sm ${status.success.text}`}>
            {`✓ ${botPassText(p, botName)}`}
          </span>
          {p.said ? <span className={`text-xs ${muted}`}>{p.said}</span> : null}
        </div>
      ))}
    </div>
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

/**
 * A bot waiting on a tool approval: what it wants, Allow once, Always allow
 * for <bot> (when it can be remembered), or Deny.
 */
export const ToolApprovalCard = ({
  approval,
  botName,
  busy = false,
  allowAlways = true,
  onAnswer,
}) => {
  const { muted } = useConfigTokens();
  const request = (approval && approval.request) || {};
  const always = allowAlways && canAlwaysAllow(request);
  const who = botName || "it";
  return (
    <Box testId="job-approval">
      <Head>{approvalText(request, botName)}</Head>
      <ApprovalPreview request={request} />
      <span className={`text-xs ${muted}`} data-testid="approval-means">
        {`Its run waits for your answer. Allow once lets ${who} do this now${always ? `; Always allow lets ${who} do it again without asking` : ""}; Deny and it's told no.`}
      </span>
      <div className="flex flex-row flex-wrap items-center justify-end gap-2">
        <Button3
          title="Deny"
          size="sm"
          disabled={busy}
          onClick={() => onAnswer({ allow: false })}
        />
        {always ? (
          <Button3
            title={`Always allow for ${botName || "this bot"}`}
            size="sm"
            disabled={busy}
            onClick={() => onAnswer({ allow: true, remember: true })}
          />
        ) : null}
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
    return { kind: "approve", now, task, bot, tries, check: youCheckOf(goal) };
  if (now.state === "needs-you" && now.asks)
    return { kind: "ask", now, task, bot, tries };
  if (now.state === "needs-you") return { kind: "came", now, task, bot, tries };
  return null;
}

/**
 * The card a bot's checks job waits on you with, or nothing. `onAction`
 * (taskId, action) is the goals' task move (goals.taskAction).
 */
export const GoalNeedsYouCard = ({
  goal,
  busy = false,
  onAction,
  now,
  editChecks = true,
}) => {
  const [editing, setEditing] = useState(false);
  const need = goalNeedsYou(goal);
  if (!need) return null;
  const { task, bot, tries } = need;
  if (need.kind === "approve") {
    return (
      <>
        <ApproveCard
          botName={bot.name}
          work={need.now.work}
          since={need.now.since}
          now={now}
          checkName={need.check ? need.check.name : null}
          busy={busy}
          onApprove={() => onAction(task.id, "done")}
          onSendBack={(reason) =>
            onAction(task.id, { type: "send-back", reason })
          }
          onEditChecks={editChecks && bot.id ? () => setEditing(true) : null}
        />
        {/* Over this page; closing leaves you on the same step (4b). */}
        {editing ? (
          <JobChecksWindow botId={bot.id} onClose={() => setEditing(false)} />
        ) : null}
      </>
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

/** Open a bot's settings at a section ("commands", "folders", …). */
export function openBotSettings(botId, section = null) {
  if (typeof window === "undefined" || !botId) return;
  window.dispatchEvent(
    new CustomEvent("dash:open-bot", {
      detail: {
        botId,
        tab: "settings",
        ...(section ? { focus: section } : {}),
      },
    }),
  );
}

/**
 * Its setup refused a command or tool, so the run failed (DASH-115): the
 * exact command or tool, why, the fix, and a way to the bot's settings at
 * that section. Nothing to approve: the bot's setup is the answer.
 */
export const BlockedCard = ({ refusal, botId, botName }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const status = useStatusTokens();
  if (!refusal) return null;
  return (
    <div
      data-testid="job-blocked"
      className={`flex flex-col gap-2 p-4 rounded-lg border ${status.error.accentBorder} ${status.error.bg}`}
    >
      <span className={`text-sm font-semibold ${status.error.text}`}>
        {`Blocked: ${botName || "the bot"} can't ${refusal.kind === "command" ? "run this command" : "use this tool"}`}
      </span>
      <div
        data-testid="job-blocked-what"
        className={`rounded-md border px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-all select-text ${hairline} ${fieldBg} ${strong}`}
      >
        {refusal.what}
      </div>
      <span className={`text-sm ${strong}`} data-testid="job-blocked-why">
        {`Why: ${refusal.why}.`}
      </span>
      <span className={`text-sm ${muted}`} data-testid="job-blocked-fix">
        {refusal.fix}
      </span>
      <div>
        <Button2
          title={`Open ${botName || "the bot"}'s ${refusalSectionText(refusal.section)}`}
          size="sm"
          onClick={() => openBotSettings(botId, refusal.section)}
        />
      </div>
    </div>
  );
};

const goalsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.goals) ||
  null;

const resume = (botId) => {
  const api = botsApi();
  if (api && api.resumeBot) return api.resumeBot(botId);
  return null;
};

const ACTIVE_STEP = new Set(["running", "checking"]);

/**
 * What a job's step waits on you for, with its action (DASH-113/124): a
 * "you" check, a handoff's question or checks that need a look (its goal,
 * read live), a tool approval, or a paused bot. The same cards on the job,
 * the team page and the conversation. `withApprovals`: false when the
 * caller shows the tool approvals itself.
 */
export const StepNeedsYou = ({
  step,
  goal,
  approvals,
  refreshGoal,
  withApprovals = true,
}) => {
  const { muted } = useConfigTokens();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (r && r.error) setError(r.error);
    } catch (e) {
      setError((e && e.message) || "That didn't work.");
    } finally {
      setBusy(false);
      // It updates in place: read its goal again (its change also comes
      // over goals:changed and the job's own change).
      if (refreshGoal) refreshGoal();
    }
  };
  const cards = [];
  if (step.status === "needs-you" && step.waiting === "paused") {
    cards.push(
      <PausedCard
        key="paused"
        title={`${step.botName} is paused, so it hasn't started`}
        resumeTitle={`Resume ${step.botName}`}
        busy={busy}
        onResume={() => act(() => resume(step.botId))}
      />,
    );
  }
  if (goal && goalNeedsYou(goal)) {
    cards.push(
      <GoalNeedsYouCard
        key="goal"
        goal={goal}
        busy={busy}
        onAction={(taskId, action) =>
          act(() => {
            const api = goalsApi();
            return api && api.taskAction
              ? api.taskAction(taskId, action)
              : null;
          })
        }
      />,
    );
  }
  if (
    withApprovals &&
    (ACTIVE_STEP.has(step.status) || step.status === "needs-you")
  ) {
    cards.push(
      <BotApprovals
        key="approvals"
        botId={step.botId}
        botName={step.botName}
        approvals={approvals}
      />,
    );
  }
  if (!cards.length) return null;
  return (
    <div className="flex flex-col gap-2 pt-1" data-testid="job-step-needs-you">
      {cards}
      {error ? (
        <span className={`text-xs ${muted}`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
};

/** One job's needs-you step, away from the job: its title, then its cards. */
const JobNeedsYouCard = ({ job, step, approvals, withApprovals }) => {
  const { muted } = useConfigTokens();
  const { goal, refresh } = useGoal(step.goalId || null);
  useEffect(() => {
    if (step.goalId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.status, step.summary]);
  return (
    <div className="flex flex-col gap-1" data-testid="needs-you-job">
      <span className="flex flex-row flex-wrap items-center gap-2 text-xs">
        <span
          className={muted}
        >{`${jobTitleText(job)} · ${step.botName}`}</span>
        <Button3
          title="Open the job"
          size="sm"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("dash:open-page", {
                detail: { page: "jobs", jobId: job.id },
              }),
            )
          }
        />
      </span>
      <StepNeedsYou
        step={step}
        goal={goal}
        approvals={approvals}
        refreshGoal={refresh}
        withApprovals={withApprovals}
      />
    </div>
  );
};

/**
 * Everything a team waits on you for, as cards with their buttons
 * (DASH-124): its jobs' needs-you steps (a "You approve" check, a
 * question, a paused bot) and its bots' tool approvals. Renders nothing
 * when nothing waits. Used by the team page banner and a lead's
 * conversation.
 *
 * @param {string|number} [workspaceId]  the team's dashboard (its jobs)
 * @param {string} [leadId]  only this lead's jobs
 * @param {object[]} bots   the team's bots ({ id, name }), for approvals
 * @param {object[]} [approvals]  every pending tool approval, when the
 *   caller already reads them (else this reads them, live)
 */
export const TeamNeedsYouCards = ({
  workspaceId = null,
  leadId = null,
  bots = [],
  approvals: given = null,
  testId = "team-needs-you",
}) => {
  const { jobs } = useJobs(workspaceId, {
    open: true,
    skip: workspaceId == null,
  });
  const own = useApprovals({ skip: !!given });
  const approvals = given || own.approvals;
  const reload = given ? () => {} : own.reload;
  const [busy, setBusy] = useState(null);
  const waiting = jobsNeedingYou(jobs, { leadId });
  const loose = looseApprovals(
    approvals,
    (bots || []).map((b) => b && b.id),
    waiting.map((w) => w.step.botId),
  );
  if (!waiting.length && !loose.length) return null;
  const nameOf = (id) =>
    ((bots || []).find((b) => b && String(b.id) === String(id)) || {}).name;
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {waiting.map(({ job, step }) => (
        <JobNeedsYouCard
          key={job.id}
          job={job}
          step={step}
          approvals={approvals}
          withApprovals
        />
      ))}
      {loose.map((a) => (
        <ToolApprovalCard
          key={a.id}
          approval={a}
          botName={nameOf(a.request.botId)}
          busy={busy === a.id}
          onAnswer={async (decision) => {
            setBusy(a.id);
            try {
              await answerApproval(a.id, decision);
            } finally {
              setBusy(null);
              reload();
            }
          }}
        />
      ))}
    </div>
  );
};
