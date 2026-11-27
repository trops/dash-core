/**
 * jobText.js — a job in words (DASH-31): a chain of work through a team
 * lead, as electron/jobs/jobTracker.js keeps it. Pure.
 */

export const JOB_STATUS = {
  // Waiting for its team's job before it (one at a time, DASH-81).
  queued: "Queued",
  running: "Running",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

export const STEP_STATUS = {
  queued: "Waiting to start",
  running: "Running",
  checking: "Being checked",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  skipped: "Didn't run",
};

/** The status roles a job's dot and pill use (dash-react status tokens). */
export function statusTone(status) {
  if (status === "done") return "success";
  if (status === "failed") return "error";
  if (status === "needs-you") return "warning";
  if (status === "running" || status === "checking") return "info";
  return null; // queued, stopped, skipped: muted
}

/** 2 → "2nd", 11 → "11th". */
export function ordinalText(n) {
  const v = n % 100;
  const suffix =
    v >= 11 && v <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
}

/**
 * A queued job's place (DASH-81): "Next in line · after “Spool holder”",
 * "2nd in line · after “Spool holder”, which needs you". "" when it isn't
 * queued.
 */
export function queueText(job) {
  if (!job || job.status !== "queued") return "";
  const q = job.queue || {};
  const place =
    !q.position || q.position === 1
      ? "Next in line"
      : `${ordinalText(q.position)} in line`;
  const w = q.waitingFor;
  if (!w) return place;
  return `${place} · after “${w.title}”${w.status === "needs-you" ? ", which needs you" : ""}`;
}

/** Under a lead's answer: "Queued · 1 ahead" (the running job counts). */
export function aheadText(job) {
  if (!job || job.status !== "queued") return "";
  const n = (job.queue && job.queue.position) || 1;
  return `Queued · ${n} ahead`;
}

/** Who started the job: "Task from slack", "You, in Woodworking Lead". */
export function startedByText(job) {
  const by = (job && job.startedBy) || {};
  const lead = (job && job.leadName) || "its team lead";
  // A team's self-test (DASH-109, DASH-123).
  if (job && job.test) return "Self-test started by you";
  if (by.kind === "task") return `Task from ${by.label || "MCP"}`;
  if (by.kind === "mcp") return `Asked over MCP, in ${lead}`;
  // A chain that starts from one of the team's bots (DASH-70).
  if (by.kind === "schedule") return `${by.label || lead} on its schedule`;
  if (by.kind === "trigger") return `${by.label || lead}, from a trigger`;
  if (job && !job.leadId && by.label) return `You ran ${by.label}`;
  return `You, in ${lead}`;
}

/**
 * Why a step started, in a few words. `job`: a self-test's first step was
 * started by the self-test, not asked by you (DASH-123).
 */
export function whyText(why, job = null) {
  const w = why || {};
  if (w.kind === "task")
    return `Got the task${w.label ? ` from ${w.label}` : ""}`;
  if (w.kind === "mcp") return "Asked over MCP";
  if ((w.kind === "you" || w.kind === "manual") && job && job.test) {
    return "Started by the self-test";
  }
  if (w.kind === "you") return "You asked";
  if (w.kind === "asked") return `Asked by ${w.by || "its team lead"}`;
  if (w.kind === "schedule" || w.kind === "catch-up") return "On its schedule";
  if (w.kind === "manual") return "You ran it";
  if (w.kind === "handon") return `Handed on by ${w.by || "a bot"}`;
  return "";
}

/**
 * A job's start line (DASH-123): "Self-test started by you · 7:56 AM ·
 * running 7 min", "Started by you, in Woodworking Lead · Tue 9:41 · 2 h".
 */
export function startLineText(job, now = Date.now()) {
  if (!job) return "";
  const by = startedByText(job);
  const who = /^You, in /.test(by)
    ? `Started by you, in ${by.slice("You, in ".length)}`
    : by;
  const took = tookText(job, now);
  return [
    who,
    whenText(job.createdAt, now),
    took && job.status === "running" ? `running ${took}` : took,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "9:41", or "Tue 16:20" before today, or "Nov 3" before this week. */
export function whenText(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const today = new Date(now);
  const hm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return hm;
  if (now - t < 6 * 24 * 3600 * 1000) {
    return `${d.toLocaleDateString([], { weekday: "short" })} ${hm}`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** "1 min", "2 h", "3 days": how long it ran (or has been running). */
export function tookText(job, now = Date.now()) {
  const a = Date.parse((job && job.createdAt) || "");
  const b = job && job.endedAt ? Date.parse(job.endedAt) : now;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  const s = Math.max(0, Math.round((b - a) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

/** How many are running and how many need you. */
export function jobCounts(jobs) {
  const out = {
    running: 0,
    queued: 0,
    needsYou: 0,
    failed: 0,
    done: 0,
    all: 0,
  };
  for (const j of jobs || []) {
    out.all += 1;
    if (j.status === "running") out.running += 1;
    else if (j.status === "queued") out.queued += 1;
    else if (j.status === "needs-you") out.needsYou += 1;
    else if (j.status === "failed") out.failed += 1;
    else if (j.status === "done") out.done += 1;
  }
  return out;
}

/** A filter of the Jobs list: all, running, needs-you, failed, done. */
export function filterJobs(jobs, filter) {
  if (!filter || filter === "all") return jobs || [];
  return (jobs || []).filter((j) =>
    filter === "failed"
      ? j.status === "failed" || j.status === "stopped"
      : j.status === filter,
  );
}

/** Jobs grouped by dashboard, in order of their newest job. */
export function groupByDashboard(jobs, dashboards = []) {
  const name = (id) => {
    const d = (dashboards || []).find((w) => String(w.id) === String(id));
    return d ? d.name : id == null ? "On no dashboard" : "A deleted dashboard";
  };
  const groups = [];
  const at = new Map();
  for (const j of jobs || []) {
    const key = j.workspaceId == null ? "" : String(j.workspaceId);
    if (!at.has(key)) {
      at.set(key, groups.length);
      groups.push({
        workspaceId: j.workspaceId,
        name: name(j.workspaceId),
        jobs: [],
      });
    }
    groups[at.get(key)].jobs.push(j);
  }
  return groups;
}

/** Jobs whose title, lead or bots match what's typed. */
/**
 * A job's title (DASH-100): "DASH-93 · Slugs drop accented letters" when it
 * has a work item, else what was asked.
 */
export function jobTitleText(job) {
  const item = job && job.item;
  // A team's self-test (DASH-109) says so first.
  const test = job && job.test ? "Test · " : "";
  if (!item || !item.id) return `${test}${(job && job.title) || ""}`;
  return `${test}${item.id} · ${item.title || job.title || ""}`.replace(
    / · $/,
    "",
  );
}

/**
 * A self-test's skipped outward actions (DASH-109), one line each:
 * "Reporter: addOrEditJiraIssueComment on Atlassian MCP {…}".
 */
export function skippedLines(job) {
  return ((job && job.test && job.skippedInTest) || []).map((s) =>
    // A command its test blocked (DASH-115).
    s.command
      ? `${s.botName ? `${s.botName}: ` : ""}\`${s.command}\` (blocked in a test)`
      : `${s.botName ? `${s.botName}: ` : ""}${s.tool} on ${s.server} ${s.args || ""}`.trim(),
  );
}

/** Where a job's files are (DASH-100): "~/DashFactory/DASH-93 on fix/…". */
export function workspaceText(job) {
  const ws = job && job.workspace;
  if (!ws || !ws.dir) return "";
  return ws.branch ? `${ws.dir} on ${ws.branch}` : ws.dir;
}

export function searchJobs(jobs, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return jobs || [];
  return (jobs || []).filter((j) =>
    [
      j.title,
      j.item && j.item.id,
      j.item && j.item.title,
      j.leadName,
      ...(j.steps || []).map((s) => s.botName),
    ]
      .filter(Boolean)
      .some((t) => String(t).toLowerCase().includes(q)),
  );
}

/** Can it be run again: it ended without finishing, and we know what was asked. */
export function canRunAgain(job) {
  return (
    !!job &&
    (job.status === "failed" || job.status === "stopped") &&
    !!job.leadId &&
    !!String(job.request || "").trim()
  );
}

/** The step a "Needs you" job waits on, and what turns it on. */
export function waitingStep(job) {
  return (
    ((job && job.steps) || []).find((s) => s.status === "needs-you") || null
  );
}

const approvalOfStep = (step, approvals) =>
  (approvals || []).find(
    (a) =>
      a &&
      a.request &&
      step &&
      ["running", "checking", "needs-you"].includes(step.status) &&
      String(a.request.botId) === String(step.botId),
  ) || null;

/**
 * The step a job waits on you at (DASH-113): one that needs you, or one
 * whose bot waits on a tool approval (its step still runs). null if none.
 */
export function needsYouStep(job, approvals = []) {
  const steps = (job && job.steps) || [];
  return (
    steps.find((s) => s.status === "needs-you") ||
    steps.find((s) => approvalOfStep(s, approvals)) ||
    null
  );
}

/** The header's words for it: "Drafter asks you a question". */
export function needsYouText(step, approvals = []) {
  if (!step) return "";
  const bot = step.botName || "A bot";
  if (approvalOfStep(step, approvals)) return `${bot} asks to use a tool`;
  if (step.waiting === "paused") return `${bot} is paused`;
  if (/^It asks:/.test(String(step.summary || ""))) {
    return `${bot} asks you a question`;
  }
  return `${bot} is waiting for you`;
}

const SECTION_WORDS = {
  commands: "Commands",
  folders: "Folders",
  tools: "Built-in tools",
  providers: "Providers",
};

/** A refusal's settings section, in words: "Commands" (DASH-115). */
export function refusalSectionText(section) {
  return SECTION_WORDS[section] || "settings";
}
