import { useState, useEffect, useCallback } from "react";

/**
 * useWidgetSchedulerStatus
 *
 * Display-only hook for reading scheduler task state outside WidgetContext.
 * Used by WidgetCardStatusBar to show live timer status in the widget footer.
 *
 * Unlike useScheduler, this hook:
 * - Does NOT require WidgetContext (works outside the widget tree)
 * - Does NOT execute handlers — purely for display
 * - Calls mainApi.scheduler.getTasks() directly
 *
 * @param {string} widgetId - The widget instance UUID
 * @returns {{ tasks: Array, isLoading: boolean }}
 */
export const useWidgetSchedulerStatus = (widgetId) => {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTasks = useCallback(() => {
    if (!widgetId || !window.mainApi?.scheduler) {
      setIsLoading(false);
      return;
    }
    window.mainApi.scheduler.getTasks(widgetId).then((result) => {
      setTasks(result || []);
      setIsLoading(false);
    });
  }, [widgetId]);

  // Load tasks on mount
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Subscribe to task-fired events to auto-refresh
  useEffect(() => {
    if (!widgetId || !window.mainApi?.scheduler?.onTaskFired) return;

    const removeListener = window.mainApi.scheduler.onTaskFired((data) => {
      if (data.widgetId !== widgetId) return;
      fetchTasks();
    });

    return removeListener;
  }, [widgetId, fetchTasks]);

  return { tasks, isLoading };
};
