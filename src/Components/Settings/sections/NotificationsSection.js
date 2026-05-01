import React, { useState, useEffect, useMemo, useContext } from "react";
import {
  Switch,
  SubHeading3,
  SearchInput,
  Sidebar,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { ComponentManager } from "../../../ComponentManager";
import { SectionLayout } from "../SectionLayout";

/**
 * NotificationsSection
 *
 * Master-detail layout for notification preferences. Mirrors the
 * WidgetsSection pattern (SectionLayout + Sidebar + SearchInput):
 *
 *   - Left list: a pinned "Global" entry (master enable + DND
 *     toggles), then an alphabetical, searchable list of every
 *     widget instance in the user's workspaces that declares
 *     notifications.
 *   - Right detail: when a widget instance is selected, shows its
 *     notification toggles. When "Global" is selected (or nothing
 *     is selected yet), shows the global controls.
 *
 * The data flow is unchanged from the previous flat-list version:
 *   `mainApi.notifications.getPreferences/setPreferences/setGlobal`
 *   own the persistence; this component is purely the UI.
 */

const GLOBAL_KEY = "__global__";

export const NotificationsSection = ({ workspaces = [] }) => {
  const appContext = useContext(AppContext);
  void appContext; // referenced for future use; not consumed here yet.

  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [doNotDisturb, setDoNotDisturb] = useState(false);
  const [instances, setInstances] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState(GLOBAL_KEY);
  const [filterDashboard, setFilterDashboard] = useState("all");
  const [filterPackage, setFilterPackage] = useState("all");

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

  // Collect every widget instance with notifications, alphabetized
  // by display title. Route through `ComponentManager.resolve` so a
  // legacy layout referencing a bare component name still finds the
  // registered scoped form.
  const widgetInstances = useMemo(() => {
    const out = [];
    workspaces.forEach((ws) => {
      const items = flattenLayout(ws.layout);
      items.forEach((item) => {
        const config = ComponentManager.resolve(item.component, item);
        if (config?.notifications?.length > 0) {
          out.push({
            uuid: item.uuid || item.uuidString,
            componentName: item.component,
            title:
              item.userPrefs?.title || config.displayName || item.component,
            workspaceName: ws.name || ws.id,
            notifications: config.notifications,
            package: config.package || "Other",
          });
        }
      });
    });
    return out.sort((a, b) =>
      String(a.title).localeCompare(String(b.title), undefined, {
        sensitivity: "base",
      }),
    );
  }, [workspaces]);

  // Derive dropdown option lists. Both sorted alphabetically so the
  // dropdowns don't shuffle as the underlying list changes order.
  const dashboardOptions = useMemo(() => {
    const set = new Set();
    widgetInstances.forEach((wi) => {
      if (wi.workspaceName) set.add(wi.workspaceName);
    });
    return [...set].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
    );
  }, [widgetInstances]);
  const packageOptions = useMemo(() => {
    const set = new Set();
    widgetInstances.forEach((wi) => {
      if (wi.package) set.add(wi.package);
    });
    return [...set].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
    );
  }, [widgetInstances]);
  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    filterDashboard !== "all" ||
    filterPackage !== "all";
  const clearFilters = () => {
    setSearchQuery("");
    setFilterDashboard("all");
    setFilterPackage("all");
  };

  // Filter by search + dashboard + package (composed AND).
  const filteredInstances = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return widgetInstances.filter((wi) => {
      if (filterDashboard !== "all" && wi.workspaceName !== filterDashboard)
        return false;
      if (filterPackage !== "all" && wi.package !== filterPackage) return false;
      if (!q) return true;
      const hay = [wi.title, wi.package, wi.workspaceName, wi.componentName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [widgetInstances, searchQuery, filterDashboard, filterPackage]);

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

  // ── Left list ──────────────────────────────────────────────────────
  const listContent = (
    <div className="flex flex-col h-full">
      <div className="flex flex-col gap-2 px-3 py-2 flex-shrink-0 border-b border-white/10">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search widgets..."
          inputClassName="py-1.5 text-xs"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <select
            value={filterDashboard}
            onChange={(e) => setFilterDashboard(e.target.value)}
            className="w-full px-2 py-1 text-xs bg-gray-800/50 border border-white/10 rounded text-gray-200 focus:outline-none"
          >
            <option value="all">All Dashboards</option>
            {dashboardOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            value={filterPackage}
            onChange={(e) => setFilterPackage(e.target.value)}
            className="w-full px-2 py-1 text-xs bg-gray-800/50 border border-white/10 rounded text-gray-200 focus:outline-none"
          >
            <option value="all">All Packages</option>
            {packageOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between text-[10px] px-0.5">
          <span className="opacity-50">
            {hasActiveFilters
              ? `${filteredInstances.length} of ${widgetInstances.length} widgets`
              : `${widgetInstances.length} widget${
                  widgetInstances.length === 1 ? "" : "s"
                }`}
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="opacity-60 hover:opacity-100 transition-opacity text-gray-300 hover:bg-white/10 px-1.5 py-0.5 rounded"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <Sidebar.Content>
        <Sidebar.Item
          icon={
            <FontAwesomeIcon
              icon={globalEnabled ? "bell" : "bell-slash"}
              className="h-3.5 w-3.5"
            />
          }
          active={selectedKey === GLOBAL_KEY}
          onClick={() => setSelectedKey(GLOBAL_KEY)}
        >
          <span className="flex flex-col">
            <span className="font-medium">Global</span>
            <span className="text-[10px] opacity-40">
              Master switch + Do Not Disturb
            </span>
          </span>
        </Sidebar.Item>
        {filteredInstances.length === 0 && widgetInstances.length === 0 && (
          <div className="px-3 py-2 text-xs opacity-50">
            No widgets with notification support found. Add widgets that declare
            notifications to see per-type controls here.
          </div>
        )}
        {filteredInstances.length === 0 && widgetInstances.length > 0 && (
          <div className="px-3 py-2 text-xs opacity-50">
            No widgets match "{searchQuery}".
          </div>
        )}
        {filteredInstances.map((wi) => {
          const isActive = selectedKey === wi.uuid;
          return (
            <Sidebar.Item
              key={wi.uuid}
              icon={<FontAwesomeIcon icon="bell" className="h-3.5 w-3.5" />}
              active={isActive}
              onClick={() => setSelectedKey(wi.uuid)}
              className={isActive ? "bg-white/10 opacity-100" : ""}
            >
              <span className="flex flex-col">
                <span className="font-medium truncate">{wi.title}</span>
                <span className="text-[10px] opacity-40 truncate">
                  {wi.package}
                  {wi.workspaceName ? ` · ${wi.workspaceName}` : ""}
                </span>
              </span>
            </Sidebar.Item>
          );
        })}
      </Sidebar.Content>
    </div>
  );

  // ── Right detail ───────────────────────────────────────────────────
  let detailContent;
  if (selectedKey === GLOBAL_KEY) {
    detailContent = (
      <div className="flex flex-col p-6 space-y-6">
        <SubHeading3 title="Global" padding={false} />
        <div className="flex flex-col space-y-3">
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
      </div>
    );
  } else {
    const wi = widgetInstances.find((w) => w.uuid === selectedKey);
    if (!wi) {
      detailContent = (
        <div className="flex-1 p-6 text-sm opacity-50">
          Select a widget on the left to configure its notifications.
        </div>
      );
    } else {
      detailContent = (
        <div className="flex flex-col p-6 space-y-4">
          <div className="flex flex-col space-y-1">
            <SubHeading3 title={wi.title} padding={false} />
            <span className="text-xs opacity-50">
              {wi.package}
              {wi.workspaceName ? ` · ${wi.workspaceName}` : ""}
            </span>
          </div>
          <div className="flex flex-col space-y-3">
            {wi.notifications.map((notif) => (
              <div
                key={notif.key}
                className="flex flex-row items-center justify-between py-1"
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
        </div>
      );
    }
  }

  return (
    <SectionLayout
      listContent={listContent}
      detailContent={detailContent}
      emptyDetailMessage="Select a widget to configure notifications"
    />
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
