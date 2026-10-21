import { useState, useEffect, useContext } from "react";
import { Switch } from "@trops/dash-react";
import { ComponentManager } from "../../../../../ComponentManager";
import {
  PendingSettingsContext,
  stageOrApply,
} from "../../../../Dashboard/pendingSettings";
import { useConfigTokens } from "../../../../Dashboard/ConfigListRow";

export const PanelEditItemNotifications = ({ item, workspace, onUpdate }) => {
  const widgetConfig = item
    ? ComponentManager.config(item.component, item)
    : null;
  const notificationDefs = widgetConfig?.notifications || [];

  const [notifPrefs, setNotifPrefs] = useState({});
  // While editing, a change waits for the dashboard's Save (Phase 3P).
  const pending = useContext(PendingSettingsContext);
  const { muted } = useConfigTokens();
  const widgetUuid = item?.uuid || item?.uuidString;

  useEffect(() => {
    if (
      notificationDefs.length > 0 &&
      widgetUuid &&
      window.mainApi?.notifications?.getPreferences
    ) {
      window.mainApi.notifications.getPreferences().then((result) => {
        setNotifPrefs(result.instances?.[widgetUuid] || {});
      });
    }
  }, [widgetUuid, notificationDefs.length]);

  function handleNotifToggle(typeKey, value) {
    const updated = { ...notifPrefs, [typeKey]: value };
    setNotifPrefs(updated);
    if (!window.mainApi?.notifications?.setPreferences || !widgetUuid) return;
    stageOrApply(pending, `notifications:${widgetUuid}:${typeKey}`, () =>
      window.mainApi.notifications.setPreferences(widgetUuid, {
        [typeKey]: value,
      }),
    );
  }

  function getNotifEnabled(typeKey, defaultEnabled) {
    if (typeof notifPrefs[typeKey] === "boolean") return notifPrefs[typeKey];
    return defaultEnabled;
  }

  if (!item || notificationDefs.length === 0) return null;

  return (
    // Under the widget panel's own "Notifications" heading (Phase 3P).
    <div className="flex flex-col">
      <div className="flex flex-col space-y-1">
        {notificationDefs.map((notif) => (
          <div
            key={notif.key}
            className="flex flex-row items-center justify-between py-1"
          >
            <div className="flex flex-col">
              <span className="text-sm">{notif.displayName}</span>
              {notif.description && (
                <span className={`text-xs ${muted}`}>{notif.description}</span>
              )}
            </div>
            <Switch
              checked={getNotifEnabled(notif.key, notif.defaultEnabled)}
              onChange={(value) => handleNotifToggle(notif.key, value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default PanelEditItemNotifications;
