/**
 * goalController.js
 *
 * The goals ledger (goals-ledger PRD): one folder per goal under
 * `<userData>/goals/`, told to every window when it changes (GOALS_CHANGED).
 * Bots reach it through their goal tools (botController → goalTools.js);
 * the renderer reads it and makes the user's moves through IPC.
 *
 * Runs aren't kept here. botController hands in how to find a goal's runs
 * and remove them (useRuns), so deleting a goal removes everything tied to
 * it.
 */
"use strict";

const path = require("path");
const { createGoalStore } = require("../goals/goalStore");
const { GOALS_CHANGED } = require("../events/goalEvents");

const DIR = "goals";

let store = null;
let getWindows = () => [];
let box = null;
let runs = { runsFor: () => [], removeRuns: () => 0, forget: () => {} };

function defaultBox() {
  try {
    const { createSecretBox } = require("../bots/secretBox");
    return createSecretBox(require("electron").safeStorage);
  } catch (_e) {
    return null;
  }
}

function broadcast(payload) {
  for (const win of getWindows() || []) {
    try {
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send(GOALS_CHANGED, payload);
      }
    } catch (_e) {
      // A closing window.
    }
  }
}

/**
 * A goal was deleted: runs still going forget it first (so the records they
 * save and the events they send don't carry its id), then its saved runs go.
 */
function gone(goalId) {
  try {
    runs.forget(goalId);
  } catch (_e) {
    // A run left holding the id only shows it.
  }
  try {
    runs.removeRuns(goalId);
  } catch (_e) {
    // The goal is gone; a run left behind only shows its id.
  }
}

// In-process listeners (the flow runner moves work on as the ledger changes).
const listeners = new Set();

function open(root) {
  store = createGoalStore({
    root,
    box,
    onChange: (change) => {
      broadcast(change);
      for (const fn of listeners) {
        try {
          fn(change);
        } catch (_e) {
          // A listener never breaks a write.
        }
      }
    },
  });
  return store;
}

function ensure() {
  if (store) return store;
  if (!box) box = defaultBox();
  let dir = null;
  try {
    dir = require("electron").app.getPath("userData");
  } catch (_e) {
    dir = null;
  }
  if (!dir) return null;
  return open(path.join(dir, DIR));
}

const goalController = {
  /** @param {{ getWindows?: () => BrowserWindow[], dataDir?: string, secretBox?: object }} deps */
  init(deps = {}) {
    if (typeof deps.getWindows === "function") getWindows = deps.getWindows;
    box = deps.secretBox || box || defaultBox();
    if (deps.dataDir) open(path.join(deps.dataDir, DIR));
    ensure();
  },

  /** The store itself, for the bot goal tools. */
  store() {
    return ensure();
  },

  /** Hear every ledger change in the main process. Returns how to stop. */
  onChange(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /**
   * How to find and remove a goal's runs (they live with the bots' runs),
   * and tell runs still going that their goal is gone (`forget`), so their
   * records and events don't carry its id.
   * @param {{ runsFor: (goalId: string) => object[],
   *           removeRuns: (goalId: string) => number,
   *           forget?: (goalId: string) => void }} hooks
   */
  useRuns(hooks = {}) {
    runs = {
      runsFor: typeof hooks.runsFor === "function" ? hooks.runsFor : () => [],
      removeRuns:
        typeof hooks.removeRuns === "function" ? hooks.removeRuns : () => 0,
      forget: typeof hooks.forget === "function" ? hooks.forget : () => {},
    };
  },

  list(workspaceId) {
    const s = ensure();
    if (!s || workspaceId == null || workspaceId === "") return [];
    return s.listGoals({ workspaceId });
  },

  get(goalId) {
    const s = ensure();
    const goal = s && s.getGoal(goalId);
    if (!goal) return null;
    let goalRuns = [];
    try {
      goalRuns = runs.runsFor(goalId) || [];
    } catch (_e) {
      goalRuns = [];
    }
    return { ...goal, runs: goalRuns };
  },

  forConversation(conversationId) {
    const s = ensure();
    return s ? s.goalsForConversation(conversationId) : [];
  },

  taskAction(taskId, action) {
    const s = ensure();
    if (!s) return { error: "The goals ledger isn't available." };
    const r = s.userAction(taskId, action);
    return r.error ? { error: r.error } : { ok: true, task: r.task };
  },

  close(goalId) {
    const s = ensure();
    if (!s) return { error: "The goals ledger isn't available." };
    const r = s.closeGoal(goalId);
    return r.error ? { error: r.error } : { ok: true };
  },

  /**
   * Delete goals and everything tied to them: tasks, evidence, work files
   * and the runs that worked on them. A goal a bot is working on is kept.
   */
  delete(goalIds) {
    const s = ensure();
    if (!s) return { error: "The goals ledger isn't available." };
    const ids = Array.isArray(goalIds) ? goalIds : [goalIds];
    const deleted = [];
    const kept = [];
    for (const id of ids) {
      const r = s.deleteGoal(id);
      if (r.ok) {
        deleted.push(id);
        gone(id);
      } else {
        kept.push({ goalId: id, error: r.error });
      }
    }
    return { deleted, kept };
  },

  /** A deleted dashboard: its goals go with it. */
  forgetWorkspace(workspaceId) {
    const s = ensure();
    if (!s || workspaceId == null) return [];
    const removed = s.deleteForWorkspace(workspaceId);
    for (const id of removed) gone(id);
    return removed;
  },

  /** A bot's run ended: what it held without a done record is let go. */
  release(botId) {
    const s = ensure();
    return s ? s.release(botId) : [];
  },
};

module.exports = goalController;
