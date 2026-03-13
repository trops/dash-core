import { useContext, useEffect, useState, useRef, useCallback } from "react";
import { WidgetContext } from "../Context/WidgetContext";
import { WorkspaceContext } from "../Context/WorkspaceContext";

/**
 * useScheduler Hook
 *
 * Provides scheduled task functionality for widgets.
 * The widget provides handler functions keyed by the task handler names
 * declared in the widget's .dash.js config (scheduledTasks[].handler).
 *
 * Tasks are registered/configured via the settings panel (PanelEditItemSchedule).
 * This hook listens for task-fired events and calls the matching handler.
 *
 * @param {Object} handlers - { [handlerName]: async () => void }
 * @returns {Object}
 *   - tasks: TaskEntry[] — current schedule state
 *   - lastFire: { taskId, taskKey, firedAt } | null — latest fire event
 *   - pendingResults: fires that happened while widget was unmounted
 */
export const useScheduler = (handlers = {}) => {
  const widgetContext = useContext(WidgetContext);
  const workspaceContext = useContext(WorkspaceContext);

  if (!widgetContext) {
    throw new Error(
      "useScheduler must be used within a Widget component. " +
        "Make sure your component is rendered inside <Widget> and within a DashboardWrapper.",
    );
  }

  const { componentName, uuid, scheduledTasks } =
    widgetContext.widgetData || {};
  const widgetId = uuid;
  const workspaceId = workspaceContext?.workspaceData?.id;

  const [tasks, setTasks] = useState([]);
  const [lastFire, setLastFire] = useState(null);
  const [pendingResults, setPendingResults] = useState([]);

  // Keep handlers in a ref so the event listener always has the latest
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Validate handler keys against widget's declared scheduledTasks
  useEffect(() => {
    if (!scheduledTasks || scheduledTasks.length === 0) return;
    const declaredHandlers = scheduledTasks.map((t) => t.handler);
    for (const key of Object.keys(handlers)) {
      if (!declaredHandlers.includes(key)) {
        console.warn(
          `[useScheduler] Handler "${key}" not declared in ${componentName}'s scheduledTasks config. ` +
            `Declared handlers: ${declaredHandlers.join(", ")}`,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentName, scheduledTasks]);

  // Load existing tasks and pending results on mount
  useEffect(() => {
    if (!widgetId || !window.mainApi?.scheduler) return;

    window.mainApi.scheduler.getTasks(widgetId).then((existingTasks) => {
      setTasks(existingTasks || []);
    });

    window.mainApi.scheduler.getPending(widgetId).then((pending) => {
      if (pending && pending.length > 0) {
        setPendingResults(pending);
        // Call handlers for each pending result
        for (const result of pending) {
          const handlerFn = handlersRef.current[result.taskKey];
          if (handlerFn) {
            try {
              handlerFn();
            } catch (err) {
              console.error(
                `[useScheduler] Error running pending handler "${result.taskKey}":`,
                err,
              );
            }
          }
        }
      }
    });
  }, [widgetId]);

  // Subscribe to task-fired events
  useEffect(() => {
    if (!widgetId || !window.mainApi?.scheduler?.onTaskFired) return;

    const removeListener = window.mainApi.scheduler.onTaskFired((data) => {
      if (data.widgetId !== widgetId) return;

      setLastFire({
        taskId: data.taskId,
        taskKey: data.taskKey,
        firedAt: data.firedAt,
      });

      // Refresh tasks to get updated lastFiredAt / fireCount
      window.mainApi.scheduler.getTasks(widgetId).then((updated) => {
        setTasks(updated || []);
      });

      // Call the matching handler
      const handlerFn = handlersRef.current[data.taskKey];
      if (handlerFn) {
        try {
          handlerFn();
        } catch (err) {
          console.error(
            `[useScheduler] Error running handler "${data.taskKey}":`,
            err,
          );
        }
      }
    });

    return removeListener;
  }, [widgetId]);

  const refreshTasks = useCallback(() => {
    if (!widgetId || !window.mainApi?.scheduler) return;
    window.mainApi.scheduler.getTasks(widgetId).then((updated) => {
      setTasks(updated || []);
    });
  }, [widgetId]);

  return {
    tasks,
    lastFire,
    pendingResults,
    refreshTasks,
  };
};
