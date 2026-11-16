/**
 * Event Constants File - Goal Events
 *
 * IPC channel constants for the goals ledger: what a dashboard's bots are
 * working on (goals-ledger PRD).
 */
const GOALS_LIST = "goals-list";
const GOALS_GET = "goals-get";
const GOALS_FOR_CONVERSATION = "goals-for-conversation";
const GOALS_TASK_ACTION = "goals-task-action";
const GOALS_CLOSE = "goals-close";
const GOALS_DELETE = "goals-delete";

// Main → every window: { type, goalId, taskId?, workspaceId? }
const GOALS_CHANGED = "goals:changed";

module.exports = {
  GOALS_LIST,
  GOALS_GET,
  GOALS_FOR_CONVERSATION,
  GOALS_TASK_ACTION,
  GOALS_CLOSE,
  GOALS_DELETE,
  GOALS_CHANGED,
};
