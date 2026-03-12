import { useState, useEffect } from "react";
import { SubHeading3, Switch } from "@trops/dash-react";
import { ComponentManager } from "../../../../../ComponentManager";

export const PanelEditItemNotifications = ({ item, workspace, onUpdate }) => {
  const widgetConfig = item
    ? ComponentManager.config(item.component, item)
    : null;
  const notificationDefs = widgetConfig?.notifications || [];

  const [notifPrefs, setNotifPrefs] = useState({});
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
    if (window.mainApi?.notifications?.setPreferences && widgetUuid) {
      window.mainApi.notifications.setPreferences(widgetUuid, {
        [typeKey]: value,
      });
    }
  }

  function getNotifEnabled(typeKey, defaultEnabled) {
    if (typeof notifPrefs[typeKey] === "boolean") return notifPrefs[typeKey];
    return defaultEnabled;
  }

  if (!item || notificationDefs.length === 0) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Notifications" padding={false} />
        {notificationDefs.map((notif) => (
          <div
            key={notif.key}
            className="flex flex-row items-center justify-between py-1"
          >
            <div className="flex flex-col">
              <span className="text-sm">{notif.displayName}</span>
              {notif.description && (
                <span className="text-xs opacity-50">{notif.description}</span>
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
