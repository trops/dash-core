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
import { keyLabel, splitStepText } from "./stepView";

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

/*
 * What a "You approve" card shows of the bot's work (DASH-124 follow-up):
 * the handoff's own fields as labelled rows (mockup 6: Repo, The problem,
 * Done when, Steps …), the prose as Markdown, never the raw JSON block.
 * Generic: any key the bot hands on, a few known ones labelled and put
 * first, the rest by keyLabel in the bot's order.
 */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isPlain = (v) =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

// Dash's own handoff keys: shown elsewhere (the handoff card), not here.
const DASH_KEYS = new Set([
  "status",
  "item",
  "workspace",
  "question",
  "items",
  "summary",
  "picks",
  "clipped",
]);

/** Known keys' labels, in the order they're shown. */
export const APPROVAL_LABELS = [
  ["repo", "Repo"],
  ["repository", "Repo"],
  ["problem", "The problem"],
  ["cause", "Cause"],
  ["fix", "Fix"],
  ["steps", "Steps"],
  ["files", "Files"],
  ["test", "Test"],
  ["tests", "Tests"],
  ["acceptance", "Done when"],
  ["acceptance_criteria", "Done when"],
  ["acceptanceCriteria", "Done when"],
  ["done_when", "Done when"],
];
const LABEL = new Map(APPROVAL_LABELS);
const ORDER = new Map(APPROVAL_LABELS.map(([k], i) => [k, i]));

// An object that names one thing (a repo, a file): its name, and why.
const NAME_KEYS = ["name", "title", "path", "file", "id", "url"];
const WHY_KEYS = ["why", "reason", "because"];
const nameOf = (o) => {
  for (const k of NAME_KEYS) {
    if (isPlain(o[k]) && String(o[k]).trim()) return String(o[k]).trim();
  }
  return "";
};
const whyOf = (o) => {
  for (const k of WHY_KEYS) {
    if (typeof o[k] === "string" && o[k].trim()) return o[k].trim();
  }
  return "";
};
const entryText = (v) => {
  if (isPlain(v)) return String(v).trim();
  if (isObject(v)) {
    const n = nameOf(v);
    const why = whyOf(v);
    return n && why ? `${n}: ${why}` : n;
  }
  return "";
};

// One key's row, or null: { key, label, text?, list?, note? }.
const rowOf = (key, v, keyLabel) => {
  const label = LABEL.get(key) || keyLabel(key);
  if (isPlain(v)) {
    const text = String(v).trim();
    return text ? { key, label, text } : null;
  }
  if (Array.isArray(v)) {
    const list = v.map(entryText).filter(Boolean);
    return list.length ? { key, label, list } : null;
  }
  if (isObject(v)) {
    const text = nameOf(v);
    if (!text) return null;
    const note = whyOf(v);
    return note ? { key, label, text, note } : { key, label, text };
  }
  return null;
};

/**
 * A handoff's fields for the approve card, as rows: [{ key, label,
 * text? | list?, note? }]. Known keys first (APPROVAL_LABELS' order), the
 * rest as the bot wrote them. An object that names nothing (`plan: {cause,
 * fix, test}`) is opened: its keys are rows of their own. Dash's own keys
 * (status, summary, item …) are left out. `keyLabel`: stepView's.
 */
export function approvalRows(handoff) {
  if (!isObject(handoff)) return [];
  const rows = [];
  const seen = new Set();
  const add = (key, v) => {
    if (seen.has(key)) return;
    const row = rowOf(key, v, keyLabel);
    if (!row) return;
    // Two keys with one label (acceptance, acceptance_criteria): the first.
    if (rows.some((r) => r.label === row.label)) return;
    seen.add(key);
    rows.push(row);
  };
  for (const [key, v] of Object.entries(handoff)) {
    if (DASH_KEYS.has(key)) continue;
    if (isObject(v) && !nameOf(v)) {
      for (const [k, w] of Object.entries(v)) add(k, w);
    } else {
      add(key, v);
    }
  }
  const at = (r) => (ORDER.has(r.key) ? ORDER.get(r.key) : ORDER.size);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => at(a.r) - at(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * The approve card's parts from the bot's answer: { prose, handoff, rows,
 * cut }. `work`: the answer as text (its json block taken out and read,
 * never shown as text). `handoff`: the step's saved handoff, used when
 * the text's block is missing or cut off.
 */
export function approvalView(work, handoff = null) {
  const parts = splitStepText(work);
  const h = parts.handoff || (isObject(handoff) ? handoff : null);
  return {
    prose: parts.prose,
    handoff: h,
    rows: approvalRows(h),
    cut: parts.cut && !h,
  };
}
