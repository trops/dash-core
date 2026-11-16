/**
 * goalsApi.js
 *
 * Preload-side IPC bindings for the goals ledger (goals-ledger PRD). Exposed
 * to the renderer as mainApi.goals. Changes arrive on "goals:changed"
 * ({ type, goalId, taskId?, workspaceId? }) via mainApi.on.
 */
const { ipcRenderer } = require("electron");
const {
  GOALS_LIST,
  GOALS_GET,
  GOALS_FOR_CONVERSATION,
  GOALS_TASK_ACTION,
  GOALS_CLOSE,
  GOALS_DELETE,
} = require("../events");

const goalsApi = {
  /** A dashboard's goals, newest first, each with its status and tasks. */
  list: (workspaceId) => ipcRenderer.invoke(GOALS_LIST, { workspaceId }),

  /** One goal with its tasks and the runs that worked on it. */
  get: (goalId) => ipcRenderer.invoke(GOALS_GET, { goalId }),

  /** Goals a conversation started (offered when it's deleted). */
  forConversation: (conversationId) =>
    ipcRenderer.invoke(GOALS_FOR_CONVERSATION, { conversationId }),

  /** The user's move on a task: "done", "one-more-round" or "close". */
  taskAction: (taskId, action) =>
    ipcRenderer.invoke(GOALS_TASK_ACTION, { taskId, action }),

  close: (goalId) => ipcRenderer.invoke(GOALS_CLOSE, { goalId }),

  /** Delete goals: their tasks, runs, evidence and work files. */
  delete: (goalIds) => ipcRenderer.invoke(GOALS_DELETE, { goalIds }),
};

module.exports = goalsApi;
