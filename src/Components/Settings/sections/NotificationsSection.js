import React, { useState, useEffect, useContext } from "react";
import { Switch, SubHeading3 } from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { ComponentManager } from "../../../ComponentManager";

/**
 * NotificationsSection
 *
 * Global notification settings panel inside App Settings.
 * Shows all widget instances that declare notifications[],
 * grouped by widget type, with per-type toggles.
 */
export const NotificationsSection = ({ workspaces = [] }) => {
  const appContext = useContext(AppContext);
  const dashApi = appContext?.dashApi;

  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [doNotDisturb, setDoNotDisturb] = useState(false);
  const [instances, setInstances] = useState({});
  const [loading, setLoading] = useState(true);

  // Load preferences on mount
  useEffect(() => {
    if (!window.mainApi?.notifications?.getPreferences) {
      setLoading(false);
      return;
    }
    window.mainApi.notifications.getPreferences().then((prefs) => {
      setGlobalEnabled(prefs.globalEnabled);
      setDoNotDisturb(prefs.doNotDisturb);
      setInstances(prefs.instances || {});
      setLoading(false);
    });
  }, []);

  // Collect all widget instances with notifications from workspaces.
  // Route through `ComponentManager.resolve` so a legacy layout
  // referencing a bare component name still finds its registered
  // scoped form (post-v0.1.432). Direct `componentMap[item.component]`
  // returns undefined for bare names after the migration.
  const widgetInstances = [];

  workspaces.forEach((ws) => {
    const items = flattenLayout(ws.layout);
    items.forEach((item) => {
      const config = ComponentManager.resolve(item.component, item);
      if (config?.notifications?.length > 0) {
        widgetInstances.push({
          uuid: item.uuid || item.uuidString,
          componentName: item.component,
          title: item.userPrefs?.title || config.displayName || item.component,
          workspaceName: ws.name || ws.id,
          notifications: config.notifications,
          package: config.package,
        });
      }
    });
  });

  // Group by package
  const grouped = {};
  widgetInstances.forEach((wi) => {
    const pkg = wi.package || "Other";
    if (!grouped[pkg]) grouped[pkg] = [];
    grouped[pkg].push(wi);
  });

  function handleGlobalToggle(value) {
    setGlobalEnabled(value);
    window.mainApi?.notifications?.setGlobal({ globalEnabled: value });
  }

  function handleDndToggle(value) {
    setDoNotDisturb(value);
    window.mainApi?.notifications?.setGlobal({ doNotDisturb: value });
  }

  function handleTypeToggle(widgetUuid, typeKey, value) {
    const updated = {
      ...instances,
      [widgetUuid]: {
        ...(instances[widgetUuid] || {}),
        [typeKey]: value,
      },
    };
    setInstances(updated);
    window.mainApi?.notifications?.setPreferences(widgetUuid, {
      [typeKey]: value,
    });
  }

  function getTypeEnabled(widgetUuid, typeKey, defaultEnabled) {
    const prefs = instances[widgetUuid];
    if (prefs && typeof prefs[typeKey] === "boolean") {
      return prefs[typeKey];
    }
    return defaultEnabled;
  }

  if (loading) {
    return (
      <div className="flex-1 p-6 opacity-50 text-sm">
        Loading notification preferences...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex flex-col space-y-6">
        {/* Global toggles */}
        <div className="flex flex-col space-y-3">
          <SubHeading3 title="Global" padding={false} />
          <div className="flex flex-row items-center justify-between py-2">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Notifications Enabled</span>
              <span className="text-xs opacity-50">
                Master switch for all notifications
              </span>
            </div>
            <Switch checked={globalEnabled} onChange={handleGlobalToggle} />
          </div>
          <div className="flex flex-row items-center justify-between py-2">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Do Not Disturb</span>
              <span className="text-xs opacity-50">
                Temporarily silence all notifications
              </span>
            </div>
            <Switch checked={doNotDisturb} onChange={handleDndToggle} />
          </div>
        </div>

        {/* Per-widget-instance toggles */}
        {Object.keys(grouped).length > 0 ? (
          Object.entries(grouped).map(([pkg, widgets]) => (
            <div key={pkg} className="flex flex-col space-y-3">
              <SubHeading3 title={pkg} padding={false} />
              {widgets.map((wi) => (
                <div
                  key={wi.uuid}
                  className="flex flex-col space-y-2 pl-2 border-l-2 border-white/10"
                >
                  <span className="text-sm font-medium opacity-80">
                    {wi.title}
                  </span>
                  {wi.notifications.map((notif) => (
                    <div
                      key={notif.key}
                      className="flex flex-row items-center justify-between py-1 pl-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm">{notif.displayName}</span>
                        {notif.description && (
                          <span className="text-xs opacity-50">
                            {notif.description}
                          </span>
                        )}
                      </div>
                      <Switch
                        checked={getTypeEnabled(
                          wi.uuid,
                          notif.key,
                          notif.defaultEnabled,
                        )}
                        onChange={(value) =>
                          handleTypeToggle(wi.uuid, notif.key, value)
                        }
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="text-sm opacity-50">
            No widgets with notification support found. Add widgets that declare
            notifications to see per-type controls here.
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Recursively flatten a layout tree into a list of leaf items.
 */
function flattenLayout(layout) {
  if (!layout) return [];
  const items = [];
  if (Array.isArray(layout)) {
    layout.forEach((item) => items.push(...flattenLayout(item)));
  } else if (typeof layout === "object") {
    if (layout.children) {
      layout.children.forEach((child) => items.push(...flattenLayout(child)));
    }
    if (layout.component) {
      items.push(layout);
    }
  }
  return items;
}
