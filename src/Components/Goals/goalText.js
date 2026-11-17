/**
 * goalText — the words the Goals tab uses for goals, tasks and done records
 * (goals-ledger PRD). Pure, so it's tested on its own.
 */

export const GOALS_CHANGED = "goals:changed";

const GOAL_LABEL = {
  open: "No tasks yet",
  working: "Working",
  "needs-you": "Needs you",
  ready: "Ready",
  done: "Done",
  closed: "Closed",
};

// StatusBadge states: the colour reads the same in every theme.
const GOAL_STATE = {
  open: "neutral",
  working: "info",
  "needs-you": "warning",
  ready: "warning",
  done: "success",
  closed: "neutral",
};

const TASK_LABEL = {
  new: "Waiting",
  claimed: "Working",
  built: "Built",
  checked: "Checked",
  ready: "Ready",
  done: "Done",
  "needs-you": "Needs you",
  closed: "Closed",
};

const TASK_STATE = {
  new: "neutral",
  claimed: "info",
  built: "info",
  checked: "info",
  ready: "warning",
  done: "success",
  "needs-you": "warning",
  closed: "neutral",
};

export const goalLabel = (status) => GOAL_LABEL[status] || "Working";
export const goalState = (status) => GOAL_STATE[status] || "info";
export const taskLabel = (status) => TASK_LABEL[status] || status || "";
export const taskState = (status) => TASK_STATE[status] || "neutral";

/** Which filter a goal falls under: needs-you, working or done. */
export function goalBucket(goal) {
  const s = goal && goal.status;
  if (s === "needs-you" || s === "ready") return "needs-you";
  if (s === "done" || s === "closed") return "done";
  return "working";
}

/** "Ticket DASH-123", "Conversation", "Started by Builder". */
export function sourceText(goal) {
  if (!goal) return "";
  const src = goal.source || {};
  if (src.kind && src.kind !== "bot") {
    const kind = src.kind.charAt(0).toUpperCase() + src.kind.slice(1);
    return src.label ? `${kind} ${src.label}` : kind;
  }
  if (goal.conversationId) return "Conversation";
  const by = goal.createdBy && (goal.createdBy.botName || goal.createdBy.botId);
  return by ? `Started by ${by}` : "Started by a bot";
}

/** A source link a person can open (a ticket URL), or null. */
export function sourceLink(goal) {
  const ref = goal && goal.source && goal.source.ref;
  return typeof ref === "string" && /^https?:\/\//.test(ref) ? ref : null;
}

/** The newest done record across a goal's tasks, with its task. */
export function latestRecord(goal) {
  let best = null;
  for (const task of (goal && goal.tasks) || []) {
    for (const r of task.history || []) {
      if (!best || (r.at || 0) >= (best.record.at || 0)) {
        best = { task, record: r };
      }
    }
  }
  return best;
}

/** Who wrote a record: "you", the bot's name, or "a bot". */
export function recordBy(record) {
  if (!record) return "";
  if (record.by === "you") return "You";
  return record.botName || record.botId || "A bot";
}

const USER_ACTION = {
  done: "marked it done",
  "one-more-round": "gave it one more round",
  close: "closed it",
  "send-back": "sent it back",
};

/** One line for a done record: "Builder: passed — Opened the PR". */
export function recordText(record) {
  if (!record) return "";
  if (record.by === "you") {
    const did = USER_ACTION[record.status] || record.status;
    return record.status === "send-back" && record.summary
      ? `You ${did}: ${record.summary}`
      : `You ${did}`;
  }
  const what =
    record.status === "passed"
      ? "passed"
      : record.status === "failed"
        ? "failed"
        : "needs you";
  return `${recordBy(record)}: ${what}${record.summary ? ` — ${record.summary}` : ""}`;
}

/** The line under a goal's title in the list. */
export function goalLine(goal) {
  if (!goal) return "";
  const tasks = goal.tasks || [];
  if (!tasks.length) return "No tasks yet";
  const stopped = tasks.find((t) => t.status === "needs-you");
  if (stopped) {
    const last = (stopped.history || [])[stopped.history.length - 1];
    if (last && last.stopped) {
      return `Stopped after ${last.round} ${last.round === 1 ? "round" : "rounds"}: ${stopped.title}`;
    }
    return `Waiting for you: ${(last && last.summary) || stopped.title}`;
  }
  const ready = tasks.filter((t) => t.status === "ready");
  if (ready.length && goal.status === "ready") {
    return ready.length === 1
      ? `Ready for you: ${ready[0].title}`
      : `${ready.length} tasks ready for you`;
  }
  const latest = latestRecord(goal);
  return latest ? recordText(latest.record) : "Not started yet";
}

/** "Round 2 of 3" for the task furthest into its rounds, or "". */
export function roundText(goal) {
  let best = null;
  for (const t of (goal && goal.tasks) || []) {
    if (t.status === "done" || t.status === "closed") continue;
    if (!best || (t.round || 1) > (best.round || 1)) best = t;
  }
  return best ? `Round ${best.round || 1} of ${best.maxRounds || 3}` : "";
}

/** The rounds a stopped task went through, one line each. */
export function roundLines(task) {
  const rounds = new Map();
  for (const r of (task && task.history) || []) {
    if (r.by === "you") continue;
    const list = rounds.get(r.round) || [];
    list.push(recordText(r));
    rounds.set(r.round, list);
  }
  return [...rounds.entries()].map(([round, lines]) => ({
    round,
    text: lines.join(" · "),
  }));
}

/** How many of each filter, for the switch: { all, needsYou, working, done }. */
export function goalCounts(goals = []) {
  const out = { all: goals.length, "needs-you": 0, working: 0, done: 0 };
  for (const g of goals) out[goalBucket(g)] += 1;
  return out;
}
