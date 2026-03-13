/**
 * schedulerController.js
 *
 * Main process controller for widget scheduled tasks.
 * Manages a tick loop (1s resolution), persistence (electron-store),
 * and dispatching task-fired events to renderer windows.
 */
const Store = require("electron-store");
const { Cron } = require("croner");

const store = new Store({ name: "dash-scheduler" });

// --- In-memory state ---
const tasks = new Map(); // taskId -> task object
const pendingResults = new Map(); // widgetId -> Array<{ taskId, taskKey, firedAt }>

const MAX_TASKS_PER_WIDGET = 20;
const MAX_PENDING_PER_WIDGET = 100;
const PERSIST_DEBOUNCE_MS = 30_000;

let tickInterval = null;
let persistTimeout = null;
let deps = {
  getWindows: null,
  notificationController: null,
  getMainWindow: null,
};

// --- Day name to cron day number ---
const DAY_MAP = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/**
 * Build a cron expression from days + time for use with croner.
 * @param {string[]} days - ["mon","wed","fri"] or ["every"]
 * @param {string} time - "09:00" (HH:mm)
 * @returns {string} cron expression
 */
function buildCronExpression(days, time) {
  const [hours, minutes] = time.split(":").map(Number);
  if (days.includes("every")) {
    return `${minutes} ${hours} * * *`;
  }
  const dayNums = days.map((d) => DAY_MAP[d]).filter((n) => n !== undefined);
  return `${minutes} ${hours} * * ${dayNums.join(",")}`;
}

/**
 * Compute the next fire timestamp for a task.
 * @param {Object} task
 * @param {number} now - current timestamp in ms
 * @returns {number} next fire timestamp in ms
 */
function computeNextFire(task, now) {
  if (task.scheduleType === "interval") {
    return now + (task.intervalMs || 60000);
  }

  if (task.scheduleType === "dayTime" && task.days && task.time) {
    try {
      const cronExpr = buildCronExpression(task.days, task.time);
      const job = new Cron(cronExpr);
      const next = job.nextRun();
      if (next) {
        return next.getTime();
      }
    } catch (err) {
      console.error(
        `[schedulerController] Error computing next fire for ${task.taskId}:`,
        err,
      );
    }
    // Fallback: 1 hour from now
    return now + 3600000;
  }

  // Unknown schedule type — default 1 hour
  return now + 3600000;
}

/**
 * Fire a task: broadcast to renderer windows, queue pending, send notification if no windows.
 */
function fireTask(task) {
  const payload = {
    taskId: task.taskId,
    widgetId: task.widgetId,
    taskKey: task.taskKey,
    handler: task.handler,
    firedAt: Date.now(),
  };

  console.log(
    `[schedulerController] Fired: ${task.widgetName}.${task.taskKey} (${task.displayName})`,
  );

  // Add to pending results queue
  let queue = pendingResults.get(task.widgetId) || [];
  queue.push({
    taskId: task.taskId,
    taskKey: task.taskKey,
    firedAt: payload.firedAt,
  });
  if (queue.length > MAX_PENDING_PER_WIDGET) {
    queue = queue.slice(-MAX_PENDING_PER_WIDGET);
  }
  pendingResults.set(task.widgetId, queue);

  // Broadcast to all windows
  const windows = deps.getWindows ? deps.getWindows() : [];
  if (windows.length > 0) {
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("scheduler:task-fired", payload);
      }
    }
  } else {
    // No windows open — send native OS notification
    if (deps.notificationController && deps.getMainWindow) {
      deps.notificationController.send(deps.getMainWindow(), {
        widgetName: task.widgetName,
        widgetId: task.widgetId,
        workspaceId: task.workspaceId || "",
        type: "scheduled-task",
        title: task.displayName || task.taskKey,
        body: `Scheduled task "${task.displayName}" fired`,
        silent: false,
      });
    }
  }
}

/**
 * Main tick — runs every 1s, checks all enabled tasks.
 */
function tick() {
  const now = Date.now();
  for (const [, task] of tasks) {
    if (!task.enabled || !task.nextFireAt || task.nextFireAt > now) continue;
    fireTask(task);
    task.nextFireAt = computeNextFire(task, now);
    task.lastFiredAt = now;
    task.fireCount = (task.fireCount || 0) + 1;
  }
  debouncedPersist();
}

/**
 * Persist tasks to electron-store (debounced).
 */
function debouncedPersist() {
  if (persistTimeout) return;
  persistTimeout = setTimeout(() => {
    persistTimeout = null;
    persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

function persistNow() {
  try {
    const data = {};
    for (const [taskId, task] of tasks) {
      data[taskId] = { ...task };
    }
    store.set("tasks", data);
  } catch (err) {
    console.error("[schedulerController] Error persisting tasks:", err);
  }
}

/**
 * Load persisted tasks from electron-store.
 */
function loadFromStore() {
  try {
    const data = store.get("tasks", {});
    const now = Date.now();
    for (const [taskId, task] of Object.entries(data)) {
      // Recompute nextFireAt if it's in the past
      if (task.nextFireAt && task.nextFireAt <= now && task.enabled) {
        task.nextFireAt = computeNextFire(task, now);
      }
      tasks.set(taskId, task);
    }
    console.log(`[schedulerController] Loaded ${tasks.size} tasks from store`);
  } catch (err) {
    console.error("[schedulerController] Error loading tasks:", err);
  }
}

/**
 * Count tasks for a given widget instance.
 */
function countTasksForWidget(widgetId) {
  let count = 0;
  for (const [, task] of tasks) {
    if (task.widgetId === widgetId) count++;
  }
  return count;
}

const schedulerController = {
  /**
   * Wire dependencies from the Electron main process.
   */
  init({ getWindows, notificationController, getMainWindow }) {
    deps.getWindows = getWindows;
    deps.notificationController = notificationController;
    deps.getMainWindow = getMainWindow;
  },

  /**
   * Start the tick loop and load persisted tasks.
   */
  start() {
    loadFromStore();
    if (!tickInterval) {
      tickInterval = setInterval(tick, 1000);
      console.log("[schedulerController] Tick loop started");
    }
  },

  /**
   * Stop the tick loop and persist immediately.
   */
  stop() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = null;
    }
    persistNow();
    console.log("[schedulerController] Stopped");
  },

  /**
   * Register or update a scheduled task.
   *
   * @param {Object} payload
   * @param {string} payload.widgetId - widget instance UUID
   * @param {string} payload.widgetName - component name
   * @param {string} [payload.workspaceId]
   * @param {string} payload.taskKey - key from .dash.js
   * @param {string} payload.handler - handler function name
   * @param {string} payload.displayName - human-readable name
   * @param {string} payload.scheduleType - "interval" | "dayTime"
   * @param {number} [payload.intervalMs] - for interval type
   * @param {string[]} [payload.days] - for dayTime type
   * @param {string} [payload.time] - for dayTime type (HH:mm)
   * @param {boolean} [payload.enabled] - defaults to true
   * @returns {{ success: boolean, taskId?: string, error?: string }}
   */
  registerTask(payload) {
    try {
      const {
        widgetId,
        widgetName,
        workspaceId,
        taskKey,
        handler,
        displayName,
        scheduleType,
        intervalMs,
        days,
        time,
      } = payload;

      const taskId = `${widgetId}:${taskKey}`;
      const existing = tasks.get(taskId);

      // Rate limit: max tasks per widget
      if (!existing && countTasksForWidget(widgetId) >= MAX_TASKS_PER_WIDGET) {
        return { success: false, error: "max_tasks_reached" };
      }

      const now = Date.now();
      const task = {
        taskId,
        widgetId,
        widgetName: widgetName || existing?.widgetName || "",
        workspaceId: workspaceId || existing?.workspaceId || "",
        taskKey,
        handler: handler || existing?.handler || taskKey,
        displayName: displayName || existing?.displayName || taskKey,
        scheduleType: scheduleType || existing?.scheduleType || "interval",
        intervalMs:
          intervalMs !== undefined ? intervalMs : existing?.intervalMs || null,
        days: days !== undefined ? days : existing?.days || null,
        time: time !== undefined ? time : existing?.time || null,
        enabled:
          payload.enabled !== undefined
            ? payload.enabled
            : existing?.enabled !== undefined
              ? existing.enabled
              : true,
        nextFireAt: 0,
        lastFiredAt: existing?.lastFiredAt || null,
        fireCount: existing?.fireCount || 0,
        createdAt: existing?.createdAt || new Date().toISOString(),
      };

      // Compute next fire
      task.nextFireAt = task.enabled ? computeNextFire(task, now) : 0;

      tasks.set(taskId, task);
      debouncedPersist();

      console.log(
        `[schedulerController] Registered: ${taskId} (${task.scheduleType})`,
      );

      return { success: true, taskId };
    } catch (error) {
      console.error("[schedulerController] Error registering task:", error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Remove a single task.
   * @param {string} taskId
   * @returns {{ success: boolean }}
   */
  removeTask(taskId) {
    const deleted = tasks.delete(taskId);
    if (deleted) {
      debouncedPersist();
      console.log(`[schedulerController] Removed: ${taskId}`);
    }
    return { success: deleted };
  },

  /**
   * Remove all tasks for a widget instance.
   * @param {string} widgetId
   * @returns {{ success: boolean, count: number }}
   */
  removeTasks(widgetId) {
    let count = 0;
    for (const [taskId, task] of tasks) {
      if (task.widgetId === widgetId) {
        tasks.delete(taskId);
        count++;
      }
    }
    if (count > 0) {
      debouncedPersist();
      pendingResults.delete(widgetId);
    }
    console.log(
      `[schedulerController] Removed ${count} tasks for widget ${widgetId}`,
    );
    return { success: true, count };
  },

  /**
   * Get all tasks for a widget instance.
   * @param {string} widgetId
   * @returns {Object[]}
   */
  getTasks(widgetId) {
    const result = [];
    for (const [, task] of tasks) {
      if (task.widgetId === widgetId) {
        result.push({ ...task });
      }
    }
    return result;
  },

  /**
   * Update a task's schedule configuration.
   * @param {string} taskId
   * @param {Object} updates
   * @returns {{ success: boolean }}
   */
  updateTask(taskId, updates) {
    const task = tasks.get(taskId);
    if (!task) {
      return { success: false, error: "task_not_found" };
    }

    const allowedFields = [
      "scheduleType",
      "intervalMs",
      "days",
      "time",
      "displayName",
      "enabled",
    ];
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        task[key] = updates[key];
      }
    }

    // Recompute next fire
    if (task.enabled) {
      task.nextFireAt = computeNextFire(task, Date.now());
    } else {
      task.nextFireAt = 0;
    }

    debouncedPersist();
    console.log(`[schedulerController] Updated: ${taskId}`);
    return { success: true };
  },

  /**
   * Enable a task.
   * @param {string} taskId
   * @returns {{ success: boolean }}
   */
  enableTask(taskId) {
    const task = tasks.get(taskId);
    if (!task) return { success: false, error: "task_not_found" };
    task.enabled = true;
    task.nextFireAt = computeNextFire(task, Date.now());
    debouncedPersist();
    console.log(`[schedulerController] Enabled: ${taskId}`);
    return { success: true };
  },

  /**
   * Disable a task.
   * @param {string} taskId
   * @returns {{ success: boolean }}
   */
  disableTask(taskId) {
    const task = tasks.get(taskId);
    if (!task) return { success: false, error: "task_not_found" };
    task.enabled = false;
    task.nextFireAt = 0;
    debouncedPersist();
    console.log(`[schedulerController] Disabled: ${taskId}`);
    return { success: true };
  },

  /**
   * Drain pending fire results for a widget.
   * @param {string} widgetId
   * @returns {Object[]}
   */
  getPendingResults(widgetId) {
    const queue = pendingResults.get(widgetId) || [];
    pendingResults.delete(widgetId);
    return queue;
  },

  /**
   * Handle system suspend — stop tick loop.
   */
  handleSuspend() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
      console.log("[schedulerController] Suspended (tick stopped)");
    }
  },

  /**
   * Handle system resume — fire missed tasks, restart tick.
   */
  handleResume() {
    const now = Date.now();
    for (const [, task] of tasks) {
      if (task.enabled && task.nextFireAt && task.nextFireAt <= now) {
        fireTask(task);
        task.nextFireAt = computeNextFire(task, now);
        task.lastFiredAt = now;
        task.fireCount = (task.fireCount || 0) + 1;
      }
    }
    debouncedPersist();
    if (!tickInterval) {
      tickInterval = setInterval(tick, 1000);
      console.log("[schedulerController] Resumed (tick restarted)");
    }
  },

  /**
   * Remove all tasks for a widget name (used on widget uninstall).
   * @param {string} widgetName - component name
   */
  cleanupWidget(widgetName) {
    let count = 0;
    for (const [taskId, task] of tasks) {
      if (task.widgetName === widgetName) {
        tasks.delete(taskId);
        pendingResults.delete(task.widgetId);
        count++;
      }
    }
    if (count > 0) {
      debouncedPersist();
      console.log(
        `[schedulerController] Cleaned up ${count} tasks for widget "${widgetName}"`,
      );
    }
  },
};

module.exports = schedulerController;
