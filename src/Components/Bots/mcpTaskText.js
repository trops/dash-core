/**
 * mcpTaskText.js — how a task given via MCP reads in Dash (bot-teams
 * TEAM-016): a team's "Tasks via MCP" rows, the Dash Lead's "Routed via MCP"
 * rows, and the passphrase's "Set Nov 1".
 *
 * Pure, so the wording is tested without the screens.
 */
import {
  INTERRUPTED_TEXT,
  askedText,
  mcpViaLabel,
  readableError,
  toPlainText,
  triggerLabel,
} from "./botConversation";

// A team bot's approval belongs to a finished task only if it was asked
// while the task ran (a bot the lead asked can still be waiting a little
// after the lead answered) — not by a later run of that bot.
const APPROVAL_GRACE_MS = 2 * 60 * 1000;

const clock = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "9:04 AM" today, "yesterday 7:40 PM", else "Oct 30, 7:40 PM". */
export function whenText(iso, now = Date.now()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date(now);
  if (sameDay(d, today)) return clock(iso);
  const yesterday = new Date(now - 24 * 60 * 60 * 1000);
  if (sameDay(d, yesterday)) return `yesterday ${clock(iso)}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock(iso)}`;
}

/** "Set Nov 1" — when the passphrase was set. */
export function setOnText(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return `Set ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

/** "via MCP · voice-assistant", plus "· confirmed with passphrase" once it is. */
function metaText(task, now) {
  const by =
    task.routedBy === "dash-team"
      ? `routed by Dash team${task.from ? ` for ${task.from}` : ""}`
      : task.from;
  return [
    "via MCP",
    by || null,
    task.confirmedAt && task.needsPassphrase !== false
      ? "confirmed with passphrase"
      : null,
    whenText(task.createdAt, now),
  ]
    .filter(Boolean)
    .join(" · ");
}

const oneLine = (s, max = 220) => {
  const text = String(s || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * A team's task as a row.
 * @param {object} task  from listMcpTasks
 * @param {{ approval?: string|null, now?: number }} [opts]  approval: what a
 *   bot on this team is waiting for the user to allow (the newest task's)
 * @returns {{ title, meta, summary, tag, state, open }}  state is a
 *   StatusBadge state; `open` = the row's Open button (it needs the user)
 */
export function taskRow(task, { approval = null, now = Date.now() } = {}) {
  const base = {
    title: oneLine(task.task, 120),
    meta: metaText(task, now),
    open: false,
  };
  if (approval && (task.status === "running" || task.status === "done")) {
    return {
      ...base,
      summary: oneLine(approval),
      tag: "Waiting for your approval",
      state: "warning",
      open: true,
    };
  }
  switch (task.status) {
    case "waiting":
      return {
        ...base,
        summary: "Waiting for the passphrase. Nothing has started.",
        tag: `Waiting for passphrase · expires ${clock(task.expiresAt)}`,
        state: "pending",
      };
    case "running":
      return {
        ...base,
        summary: "The team is working on it.",
        tag: "Running",
        state: "info",
      };
    case "done":
      return task.needsYou
        ? {
            ...base,
            summary: oneLine(task.needsYou),
            tag: "Needs you",
            state: "warning",
            open: true,
          }
        : {
            ...base,
            summary: oneLine(toPlainText(task.summary)) || "Done.",
            tag: "Done",
            state: "success",
          };
    case "failed":
      return {
        ...base,
        summary: oneLine(task.error) || "It didn't finish.",
        tag: "Didn't finish",
        state: "error",
      };
    case "expired":
    default:
      return {
        ...base,
        summary: "No passphrase within 10 minutes, so it never started.",
        tag: "Expired — no passphrase",
        state: "neutral",
      };
  }
}

/** The Dash Lead's routing log entry as a row. */
export function routeRow(route, now = Date.now()) {
  const task = oneLine(route.task, 60);
  const meta = ["via MCP", route.from || null, whenText(route.at, now)]
    .filter(Boolean)
    .join(" · ");
  if (route.team) {
    return {
      title: `Sent '${task}' to ${route.team.name}`,
      meta,
      summary: `${route.team.name} was the team that fits.`,
      tag: "Sent",
      state: "success",
    };
  }
  if (route.ambiguous) {
    return {
      title: `Asked back: ${route.ambiguous.join(" or ")}?`,
      meta: `${meta} · '${task}'`,
      summary: "More than one team fits, so the agent asked which.",
      tag: "Asked back",
      state: "info",
    };
  }
  if (route.none) {
    return {
      title: `No team takes tasks like '${task}'`,
      meta,
      summary:
        "Replied that no team does this. A team takes tasks after you turn on 'Takes tasks via MCP' in its Bots view.",
      tag: "Not sent",
      state: "neutral",
    };
  }
  return {
    title: `Couldn't route '${task}'`,
    meta,
    summary: `${oneLine(route.error) || "Something went wrong."} The agent asked which team instead.`,
    tag: "Not sent",
    state: "neutral",
  };
}

/**
 * The newest running-or-done task gets the team's waiting approval: the
 * approval's text, if a bot on this team is waiting on one asked after the
 * task was confirmed.
 * @param {object[]} tasks  newest first
 * @param {object[]} approvals  [{ request: { botId, ... }, createdAt }]
 * @param {Set<string>} teamBotIds
 * @param {(a) => string} describe  approvalText
 * @returns {{ taskId: string, text: string, id: string, request: object } | null}
 *   id: the approval's, for Allow / Deny; request: what it asks to do
 */
export function approvalForTasks(tasks, approvals, teamBotIds, describe) {
  const task = (tasks || []).find(
    (t) => (t.status === "running" || t.status === "done") && t.confirmedAt,
  );
  if (!task) return null;
  const since = Date.parse(task.confirmedAt);
  const until =
    task.status === "done" && task.endedAt
      ? Date.parse(task.endedAt) + APPROVAL_GRACE_MS
      : Infinity;
  const a = (approvals || []).find((x) => {
    if (!x || !x.request || !teamBotIds.has(x.request.botId)) return false;
    if (!x.createdAt) return task.status === "running";
    const at = new Date(x.createdAt).getTime();
    return at >= since && at <= until;
  });
  return a
    ? { taskId: task.id, text: describe(a), id: a.id, request: a.request }
    : null;
}

/** "Started 9:04 AM · Done 9:11 AM" — an opened task's times. */
export function taskTimesText(task, now = Date.now()) {
  const ended = {
    done: "Done",
    failed: "Ended",
    expired: "Expired",
  }[task.status];
  return [
    task.confirmedAt ? `Started ${whenText(task.confirmedAt, now)}` : null,
    ended && task.endedAt ? `${ended} ${whenText(task.endedAt, now)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---- A lead's Activity: one list of runs and tasks (round 2) -------------

/** Where a task via MCP came from: "via MCP · voice-assistant". */
export function mcpSource(task) {
  if (task && task.routedBy === "dash-team") {
    return "via MCP · routed by Dash team";
  }
  return task && task.from ? `via MCP · ${task.from}` : "via MCP";
}

const isTaskRun = (run) =>
  /^mcp-task(:|$)/.test(String((run && run.via) || ""));
const timeOf = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isNaN(t) ? null : t;
};

/**
 * Which run did each task? A finished task names its run's start
 * (runAt); one still going is the task run that started closest after it
 * was confirmed (within a minute). → Map taskId → run
 */
export function matchTaskRuns(tasks, runs) {
  const taskRuns = (runs || []).filter(isTaskRun);
  const used = new Set();
  const out = new Map();
  const take = (t, run) => {
    used.add(run);
    out.set(t.id, run);
  };
  // First every task that names its run, so none of those runs is taken by
  // a task nearby in time.
  for (const t of tasks || []) {
    if (!t.runAt) continue;
    const run = taskRuns.find((r) => !used.has(r) && r.startedAt === t.runAt);
    if (run) take(t, run);
  }
  // Then the rest, oldest first: the first free task run that started
  // after it was confirmed, within a minute (a run starts after its task).
  const rest = (tasks || [])
    .filter((t) => !out.has(t.id) && t.confirmedAt)
    .sort(
      (a, b) => (timeOf(a.confirmedAt) || 0) - (timeOf(b.confirmedAt) || 0),
    );
  for (const t of rest) {
    const from = timeOf(t.confirmedAt);
    let best = null;
    for (const r of taskRuns) {
      if (used.has(r)) continue;
      const at = timeOf(r.startedAt);
      if (at === null || from === null) continue;
      const gap = at - from;
      if (gap >= 0 && gap <= 60000 && (!best || gap < best.gap)) {
        best = { r, gap };
      }
    }
    if (best) take(t, best.r);
  }
  return out;
}

const RUN_STATE = {
  completed: ["Completed", "success"],
  running: ["Running", "info"],
  failed: ["Failed", "error"],
  stopped: ["Stopped", "neutral"],
  interrupted: ["Interrupted", "neutral"],
  skipped: ["Skipped", "neutral"],
};

/** What started a run that isn't a task via MCP, in a few words. */
function runSource(run, nameOf) {
  // A catch-up run makes up a scheduled one missed while Dash was closed.
  if (run.trigger === "schedule" || run.trigger === "catch-up") {
    return "On its schedule";
  }
  if (run.trigger === "event")
    return triggerLabel(run, nameOf) || "On an event";
  if (run.via === "assistant") return "Asked via the AI Assistant";
  if (run.via === "mcp") return "Asked through Dash's MCP server";
  if (mcpViaLabel(run.via)) return mcpViaLabel(run.via);
  return run.prompt ? "You asked" : "Run now";
}

function runLine(run) {
  if (run.status === "failed" && run.error) return readableError(run.error);
  if (run.outputUnavailable) return "Answer unavailable";
  if (run.status === "interrupted" && !run.output) return INTERRUPTED_TEXT;
  const first = toPlainText(run.output || "")
    .split("\n")
    .find((l) => l.trim());
  return oneLine(first || "");
}

/**
 * A lead's Activity as one list, newest first: every run, with the ones
 * that did a task via MCP tagged and showing the task; tasks that never
 * ran (waiting for the passphrase, expired, refused) in their place.
 * @param {object[]} runs   newest first
 * @param {object[]} tasks  newest first
 * @param {{ filter?: "all"|"mcp"|"asked"|"scheduled",
 *           approval?: { taskId, text, id } | null, now?: number,
 *           nameOf?: (id) => string }} [opts]
 * @returns {object[]} rows: { key, at, mcp, source, title, line, tag,
 *   state, open, run?, task? }
 */
export function leadTimeline(
  runs,
  tasks,
  {
    filter = "all",
    approval = null,
    now = Date.now(),
    nameOf = (id) => id,
  } = {},
) {
  const byTask = matchTaskRuns(tasks, runs);
  const taskOfRun = new Map([...byTask].map(([id, run]) => [run, id]));
  const taskById = new Map((tasks || []).map((t) => [t.id, t]));
  const rows = [];
  for (const run of runs || []) {
    const taskId = taskOfRun.get(run);
    const task = taskId ? taskById.get(taskId) : null;
    const at = run.startedAt || run.at || run.endedAt || null;
    if (task) {
      const tr = taskRow(task, {
        approval:
          approval && approval.taskId === task.id ? approval.text : null,
        now,
      });
      rows.push({
        key: `run:${run.startedAt || task.id}`,
        at,
        mcp: true,
        source: mcpSource(task),
        title: tr.title,
        line: tr.summary,
        tag: tr.tag,
        state: tr.state,
        open: tr.open,
        run,
        task,
      });
      continue;
    }
    const [tag, state] = RUN_STATE[run.status] || [
      run.status
        ? run.status.charAt(0).toUpperCase() + run.status.slice(1)
        : "Unknown",
      "neutral",
    ];
    const asked = askedText(run);
    rows.push({
      key: `run:${at || rows.length}`,
      at,
      mcp: isTaskRun(run),
      source: isTaskRun(run) ? mcpViaLabel(run.via) : runSource(run, nameOf),
      title: oneLine(asked, 120) || runSource(run, nameOf),
      line: runLine(run),
      tag,
      state,
      open: false,
      run,
    });
  }
  // Tasks no run did: still waiting, expired, or refused before starting.
  for (const task of tasks || []) {
    if (byTask.has(task.id)) continue;
    const tr = taskRow(task, {
      approval: approval && approval.taskId === task.id ? approval.text : null,
      now,
    });
    rows.push({
      key: `task:${task.id}`,
      at: task.createdAt,
      mcp: true,
      source: mcpSource(task),
      title: tr.title,
      line: tr.summary,
      tag: tr.tag,
      state: tr.state,
      open: tr.open,
      task,
    });
  }
  rows.sort((a, b) => (timeOf(b.at) || 0) - (timeOf(a.at) || 0));
  if (filter === "mcp") return rows.filter((r) => r.mcp);
  if (filter === "asked") {
    return rows.filter(
      (r) =>
        !r.mcp &&
        r.run &&
        ["ask", "manual", "reply"].includes(r.run.trigger) &&
        r.run.prompt,
    );
  }
  if (filter === "scheduled") {
    return rows.filter(
      (r) =>
        r.run && (r.run.trigger === "schedule" || r.run.trigger === "catch-up"),
    );
  }
  return rows;
}

/** "Takes tasks via MCP · asks for a passphrase first" — how a team is set. */
export function taskSettingLine({ takes, asks }) {
  if (!takes) return "Doesn't take tasks via MCP";
  return asks
    ? "Takes tasks via MCP · asks for a passphrase first"
    : "Takes tasks via MCP · starts them without a passphrase";
}
