/**
 * mcpTaskText.js — how a task given via MCP reads in Dash (bot-teams
 * TEAM-016): a team's "Tasks via MCP" rows, the Dash Lead's "Routed via MCP"
 * rows, and the passphrase's "Set Nov 1".
 *
 * Pure, so the wording is tested without the screens.
 */
import { toPlainText } from "./botConversation";

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

/** "via MCP · ha-bridge", plus "· confirmed with passphrase" once it is. */
function metaText(task, now) {
  const by =
    task.routedBy === "dash-team"
      ? `routed by Dash team${task.from ? ` for ${task.from}` : ""}`
      : task.from;
  return [
    "via MCP",
    by || null,
    task.confirmedAt ? "confirmed with passphrase" : null,
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
 * @returns {{ taskId: string, text: string, id: string } | null}  id: the
 *   approval's, for Allow / Deny
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
  return a ? { taskId: task.id, text: describe(a), id: a.id } : null;
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
