import { useContext, useCallback } from "react";
import { WidgetContext } from "../Context/WidgetContext";
import { WorkspaceContext } from "../Context/WorkspaceContext";

/**
 * useNotifications Hook
 *
 * Provides notification methods for widgets.
 * Validates that the notification type matches the widget's
 * declared notifications[] config before sending.
 *
 * @returns {Object}
 *   - notify({ type, title, body, data?, silent?, urgency? }) — send a notification
 *   - notificationTypes — array of notification configs from .dash.js
 */
export const useNotifications = () => {
  const widgetContext = useContext(WidgetContext);
  const workspaceContext = useContext(WorkspaceContext);

  if (!widgetContext) {
    throw new Error(
      "useNotifications must be used within a Widget component. " +
        "Make sure your component is rendered inside <Widget> and within a DashboardWrapper.",
    );
  }

  const { componentName, uuid, notifications } = widgetContext.widgetData || {};

  const workspaceId = workspaceContext?.workspaceData?.id;

  const notify = useCallback(
    ({ type, title, body, data, silent, urgency }) => {
      if (!window.mainApi || !window.mainApi.notifications) {
        console.warn("[useNotifications] mainApi.notifications not available");
        return Promise.resolve({ success: false, reason: "no_api" });
      }

      // Validate type against widget's declared notifications
      const declaredTypes = notifications || [];
      const isValid = declaredTypes.some((n) => n.key === type);
      if (!isValid) {
        console.warn(
          `[useNotifications] Type "${type}" not declared in ${componentName}'s notifications config. ` +
            `Declared types: ${declaredTypes.map((n) => n.key).join(", ")}`,
        );
        return Promise.resolve({
          success: false,
          reason: "invalid_type",
        });
      }

      return window.mainApi.notifications.send({
        widgetName: componentName,
        widgetId: uuid,
        workspaceId,
        type,
        title,
        body,
        data,
        silent,
        urgency,
      });
    },
    [componentName, uuid, workspaceId, notifications],
  );

  return {
    notify,
    notificationTypes: notifications || [],
  };
};
