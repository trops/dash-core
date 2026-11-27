/**
 * needsYouView.js — what the needs-you cards read (DASH-124). Pure: no
 * React, no IPC.
 *
 * There is no separate "approver": a step waits on you because one of its
 * bot's checks is a "You approve" check. These helpers name that check,
 * say when another bot passed a check instead, and pick a team's jobs that
 * wait on you, so the same card shows on the job, the team page and the
 * conversation.
 */
import { WORK_STEP, isBotJob, jobBot, jobTimeline } from "../Goals/jobTimeline";
import { canAlwaysAllow as canRemember } from "../Bots/alwaysAllow";

/** The check a bot's job waits on you at: { id, name } or null. */
export function youCheckOf(goal) {
  if (!isBotJob(goal) || goal.closed) return null;
  const task = (goal.tasks || [])[0] || null;
  if (!task || task.status !== "ready") return null;
  const step = (goal.flow.steps || []).find((s) => s && s.id === task.stepId);
  if (!step || step.kind !== "you" || step.id === WORK_STEP) return null;
  return { id: step.id, name: step.name || "You approve" };
}

/** "Your check: is Planner's work right?" — the card's heading. */
export function youCheckTitle(botName) {
  return `Your check: is ${botName || "the bot"}'s work right?`;
}

/** `Planner's check "Plan approved"` — the line under it. */
export function youCheckLine(botName, checkName) {
  if (!checkName) return "";
  return `${botName || "The bot"}'s check "${checkName}"`;
}

/**
 * The checks another bot passed on its latest try ("A bot reviews"), when
 * nothing waits on you: [{ name, reviewer, said }]. Shown as a compact
 * green line in place of a card.
 */
export function botPassesOf(goal) {
  const rows = jobTimeline(goal);
  if (!rows.length) return [];
  const now = rows[rows.length - 1];
  if (now.state === "waiting" || now.state === "needs-you") return [];
  let lastTry = -1;
  rows.forEach((r, i) => {
    if (r.type === "try") lastTry = i;
  });
  if (lastTry < 0) return [];
  const out = [];
  for (const r of rows.slice(lastTry + 1)) {
    if (r.type !== "passed") continue;
    for (const n of r.names || []) {
      if (n && n.reviewer) {
        out.push({ name: n.name, reviewer: n.reviewer, said: n.said || "" });
      }
    }
  }
  return out;
}

/** "Plan approved: Reviewer passed Planner's check". */
export function botPassText(pass, botName) {
  if (!pass) return "";
  return `${pass.name}: ${pass.reviewer} passed ${botName || "the bot"}'s check`;
}

/** The bot whose checks a goal is (for the "Edit <bot>'s checks" link). */
export const checksBotOf = (goal) => (goal ? jobBot(goal) : null);

/**
 * Can "Always allow for <bot>" be offered for this tool approval? What
 * alwaysAllow.js says, minus the Dash team's build tools (nothing shows
 * their grants to undo).
 */
export function canAlwaysAllow(request) {
  const r = request || {};
  if (r.serverName === "dash-team-build") return false;
  return canRemember(r);
}

/**
 * A team's jobs that wait on you, oldest first, each with the step that
 * waits: [{ job, step }]. `leadId`: only that lead's jobs (its
 * conversation).
 */
export function jobsNeedingYou(jobs, { leadId = null } = {}) {
  return (jobs || [])
    .filter(
      (j) =>
        j &&
        j.status === "needs-you" &&
        (leadId == null || String(j.leadId) === String(leadId)),
    )
    .map((job) => ({
      job,
      step: (job.steps || []).find((s) => s && s.status === "needs-you"),
    }))
    .filter((x) => !!x.step)
    .sort((a, b) =>
      String(a.job.createdAt || "").localeCompare(
        String(b.job.createdAt || ""),
      ),
    );
}

/**
 * The tool approvals of these bots that no shown job step already holds:
 * a step's card shows its own bot's approvals.
 */
export function looseApprovals(approvals, botIds, stepBotIds = []) {
  const team = new Set((botIds || []).map(String));
  const held = new Set((stepBotIds || []).map(String));
  return (approvals || []).filter(
    (a) =>
      a &&
      a.request &&
      team.has(String(a.request.botId)) &&
      !held.has(String(a.request.botId)),
  );
}
