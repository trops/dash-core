/**
 * WidgetCardStatusBar
 *
 * Shows live countdown timers for scheduled tasks in the widget footer area.
 * Renders in both edit and preview modes when a widget has configured scheduled tasks.
 *
 * Collapsed: compact single-line strip with live countdown
 * Expanded: per-task detail with schedule description, last-fire time, fire count
 */

import React, { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@trops/dash-react";
import { ComponentManager } from "../../../../ComponentManager";
import { useWidgetSchedulerStatus } from "../../../../hooks/useWidgetSchedulerStatus";

// ── Format Helpers ──────────────────────────────────────────────────

/**
 * Format milliseconds as a human-readable countdown.
 * @param {number} ms - milliseconds remaining
 * @returns {string} e.g. "3m 42s", "1h 23m", "< 1s", "--"
 */
function formatCountdown(ms) {
  if (ms == null || ms < 0) return "--";
  if (ms < 1000) return "< 1s";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format a timestamp as relative time ago.
 * @param {number|string} timestamp - epoch ms or ISO string
 * @returns {string} e.g. "2m ago", "1h ago", "just now"
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return null;
  const ts =
    typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  const diff = Date.now() - ts;

  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Format a task's schedule as a human-readable description.
 * @param {Object} task - scheduler task object
 * @returns {string} e.g. "Every 5 min", "Mon, Wed at 09:00"
 */
function formatScheduleDescription(task) {
  if (task.scheduleType === "interval" && task.intervalMs) {
    const totalSeconds = Math.floor(task.intervalMs / 1000);
    if (totalSeconds < 60) return `Every ${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `Every ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMin = minutes % 60;
    if (remainingMin === 0) return `Every ${hours} hr`;
    return `Every ${hours}h ${remainingMin}m`;
  }

  if (task.scheduleType === "dayTime") {
    const dayMap = {
      mon: "Mon",
      tue: "Tue",
      wed: "Wed",
      thu: "Thu",
      fri: "Fri",
      sat: "Sat",
      sun: "Sun",
    };
    const days = (task.days || []).map((d) => dayMap[d] || d);
    const time = task.time || "00:00";

    if (days.length === 7) return `Daily at ${time}`;
    if (
      days.length === 5 &&
      ["mon", "tue", "wed", "thu", "fri"].every((d) =>
        (task.days || []).includes(d),
      )
    ) {
      return `Mon\u2013Fri at ${time}`;
    }
    return `${days.join(", ")} at ${time}`;
  }

  return "Scheduled";
}

// ── Component ───────────────────────────────────────────────────────

export const WidgetCardStatusBar = ({ item, className = "" }) => {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Check if widget declares scheduledTasks in its config
  const widgetConfig = item?.component
    ? ComponentManager.config(item.component, item)
    : null;
  const declaredTasks = widgetConfig?.scheduledTasks || [];

  // Fetch live task state from the scheduler
  const { tasks, isLoading } = useWidgetSchedulerStatus(item?.uuid);

  // Tick every second for live countdowns
  useEffect(() => {
    if (tasks.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [tasks.length]);

  // Don't render if widget doesn't declare scheduled tasks or none are configured
  if (declaredTasks.length === 0) return null;
  if (isLoading) return null;
  if (tasks.length === 0) return null;

  const enabledTasks = tasks.filter((t) => t.enabled);
  const allPaused = enabledTasks.length === 0;

  // Find soonest countdown among enabled tasks
  let soonestMs = null;
  for (const task of enabledTasks) {
    if (task.nextFireAt) {
      const remaining = task.nextFireAt - now;
      if (soonestMs === null || remaining < soonestMs) {
        soonestMs = remaining;
      }
    }
  }

  // Collapsed summary text
  let summaryText;
  if (allPaused) {
    summaryText = `${tasks.length} timer${tasks.length > 1 ? "s" : ""} (paused)`;
  } else if (tasks.length === 1) {
    const task = tasks[0];
    const label = task.displayName || task.taskKey;
    if (task.enabled && soonestMs != null) {
      summaryText = `${label} \u00b7 ${formatCountdown(soonestMs)}`;
    } else {
      summaryText = `${label} (paused)`;
    }
  } else {
    summaryText = `${tasks.length} timers \u00b7 next in ${formatCountdown(soonestMs)}`;
  }

  return (
    <div
      className={`border-t border-gray-700/50 bg-gray-900/30 select-none ${className}`}
    >
      {/* Collapsed strip */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center w-full px-3 py-1 text-xs gap-2 cursor-pointer transition-colors hover:bg-gray-800/40 ${
          allPaused ? "text-gray-500" : "text-blue-400"
        }`}
      >
        <FontAwesomeIcon icon="clock" className="text-[10px] shrink-0" />
        <span className="truncate flex-1 text-left">{summaryText}</span>
        <FontAwesomeIcon
          icon={expanded ? "chevron-up" : "chevron-down"}
          className="text-[10px] text-gray-500 shrink-0"
        />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-2 pt-1 space-y-2">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Scheduled Tasks
          </div>
          {tasks.map((task) => {
            const remaining =
              task.enabled && task.nextFireAt ? task.nextFireAt - now : null;
            const lastFiredText = formatRelativeTime(task.lastFiredAt);

            return (
              <div key={task.taskId} className="flex flex-col gap-0.5">
                {/* Task name + schedule */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        task.enabled ? "bg-green-500" : "bg-gray-600"
                      }`}
                    />
                    <span
                      className={
                        task.enabled ? "text-gray-200" : "text-gray-500"
                      }
                    >
                      {task.displayName || task.taskKey}
                    </span>
                    {!task.enabled && (
                      <span className="text-gray-600 text-[10px]">
                        (paused)
                      </span>
                    )}
                  </div>
                  <span className="text-gray-500 text-[10px]">
                    {formatScheduleDescription(task)}
                  </span>
                </div>

                {/* Detail line */}
                {task.enabled && (
                  <div className="text-[10px] text-gray-500 pl-4 flex items-center gap-1.5">
                    <span>Next in {formatCountdown(remaining)}</span>
                    {lastFiredText && (
                      <>
                        <span className="text-gray-700">&middot;</span>
                        <span>Last: {lastFiredText}</span>
                      </>
                    )}
                    {task.fireCount > 0 && (
                      <>
                        <span className="text-gray-700">&middot;</span>
                        <span>#{task.fireCount}</span>
                      </>
                    )}
                  </div>
                )}

                {/* Paused detail: show schedule only */}
                {!task.enabled && (
                  <div className="text-[10px] text-gray-600 pl-4">
                    {formatScheduleDescription(task)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WidgetCardStatusBar;
