/**
 * Event Constants File - Scheduler Events
 *
 * IPC channel constants for the widget scheduled tasks system.
 */
const SCHEDULER_REGISTER_TASK = "scheduler-register-task";
const SCHEDULER_REMOVE_TASK = "scheduler-remove-task";
const SCHEDULER_REMOVE_TASKS = "scheduler-remove-tasks";
const SCHEDULER_GET_TASKS = "scheduler-get-tasks";
const SCHEDULER_UPDATE_TASK = "scheduler-update-task";
const SCHEDULER_ENABLE_TASK = "scheduler-enable-task";
const SCHEDULER_DISABLE_TASK = "scheduler-disable-task";
const SCHEDULER_GET_PENDING = "scheduler-get-pending";
const SCHEDULER_TASK_FIRED = "scheduler:task-fired";

module.exports = {
  SCHEDULER_REGISTER_TASK,
  SCHEDULER_REMOVE_TASK,
  SCHEDULER_REMOVE_TASKS,
  SCHEDULER_GET_TASKS,
  SCHEDULER_UPDATE_TASK,
  SCHEDULER_ENABLE_TASK,
  SCHEDULER_DISABLE_TASK,
  SCHEDULER_GET_PENDING,
  SCHEDULER_TASK_FIRED,
};
