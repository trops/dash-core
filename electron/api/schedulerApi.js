/**
 * schedulerApi.js
 *
 * Preload-side IPC bindings for the widget scheduled tasks system.
 * Exposed to the renderer via mainApi.scheduler.
 */
const { ipcRenderer } = require("electron");
const {
  SCHEDULER_REGISTER_TASK,
  SCHEDULER_REMOVE_TASK,
  SCHEDULER_REMOVE_TASKS,
  SCHEDULER_GET_TASKS,
  SCHEDULER_UPDATE_TASK,
  SCHEDULER_ENABLE_TASK,
  SCHEDULER_DISABLE_TASK,
  SCHEDULER_GET_PENDING,
  SCHEDULER_TASK_FIRED,
} = require("../events");

const schedulerApi = {
  /**
   * Register or update a scheduled task.
   *
   * @param {Object} payload - { widgetId, widgetName, workspaceId, taskKey, handler, displayName, scheduleType, intervalMs?, days?, time?, enabled? }
   * @returns {Promise<{ success: boolean, taskId?: string, error?: string }>}
   */
  registerTask: (payload) =>
    ipcRenderer.invoke(SCHEDULER_REGISTER_TASK, payload),

  /**
   * Remove a single task.
   *
   * @param {string} taskId - "widgetUuid:taskKey"
   * @returns {Promise<{ success: boolean }>}
   */
  removeTask: (taskId) => ipcRenderer.invoke(SCHEDULER_REMOVE_TASK, taskId),

  /**
   * Remove all tasks for a widget instance.
   *
   * @param {string} widgetId - widget instance UUID
   * @returns {Promise<{ success: boolean, count: number }>}
   */
  removeTasks: (widgetId) =>
    ipcRenderer.invoke(SCHEDULER_REMOVE_TASKS, widgetId),

  /**
   * Get all tasks for a widget instance.
   *
   * @param {string} widgetId - widget instance UUID
   * @returns {Promise<Object[]>}
   */
  getTasks: (widgetId) => ipcRenderer.invoke(SCHEDULER_GET_TASKS, widgetId),

  /**
   * Update a task's schedule configuration.
   *
   * @param {string} taskId - "widgetUuid:taskKey"
   * @param {Object} updates - { scheduleType?, intervalMs?, days?, time?, displayName?, enabled? }
   * @returns {Promise<{ success: boolean }>}
   */
  updateTask: (taskId, updates) =>
    ipcRenderer.invoke(SCHEDULER_UPDATE_TASK, { taskId, updates }),

  /**
   * Enable a task.
   *
   * @param {string} taskId - "widgetUuid:taskKey"
   * @returns {Promise<{ success: boolean }>}
   */
  enableTask: (taskId) => ipcRenderer.invoke(SCHEDULER_ENABLE_TASK, taskId),

  /**
   * Disable a task.
   *
   * @param {string} taskId - "widgetUuid:taskKey"
   * @returns {Promise<{ success: boolean }>}
   */
  disableTask: (taskId) => ipcRenderer.invoke(SCHEDULER_DISABLE_TASK, taskId),

  /**
   * Drain pending fire results for a widget.
   *
   * @param {string} widgetId - widget instance UUID
   * @returns {Promise<Object[]>}
   */
  getPending: (widgetId) => ipcRenderer.invoke(SCHEDULER_GET_PENDING, widgetId),

  /**
   * Listen for task-fired events from the main process.
   *
   * @param {Function} callback - ({ taskId, widgetId, taskKey, handler, firedAt }) => void
   * @returns {Function} removeListener function
   */
  onTaskFired: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(SCHEDULER_TASK_FIRED, handler);
    return () => ipcRenderer.removeListener(SCHEDULER_TASK_FIRED, handler);
  },
};

module.exports = schedulerApi;
