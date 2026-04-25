import { useState, useEffect, useCallback } from "react";
import {
  Button,
  FontAwesomeIcon,
  Sidebar,
  SettingsModal,
  SubHeading2,
} from "@trops/dash-react";

import PanelEditItem from "./Panel/PanelEditItem";
import PanelEditItemGrid from "./Panel/PanelEditItemGrid";
import PanelEditItemNotifications from "./Panel/PanelEditItemNotifications";
import PanelEditItemSchedule from "./Panel/PanelEditItemSchedule";

import { PanelEditItemHandlers, PanelEditItemProviders } from "./Panel";
import PanelCode from "./Panel/PanelCode";
import { ComponentManager } from "../../../../ComponentManager";
import { getUserConfigurableProviders } from "../../../../utils/providerUtils";
import { pickWidgetDisplayName } from "../../../../utils/widgetIdentity";

const getSections = (item) => {
  const widgetConfig = item
    ? ComponentManager.config(item.component, item)
    : null;
  const hasNotifications = widgetConfig?.notifications?.length > 0;
  const hasScheduledTasks = widgetConfig?.scheduledTasks?.length > 0;
  // Show the Providers section whenever the widget declares any
  // user-configurable providers. Previously provider selection lived
  // inline in the card header dropdown; this moves it into the
  // widget config modal so the header stays uncluttered and there's
  // room for richer per-provider UX.
  const declaredProviders = Array.isArray(widgetConfig?.providers)
    ? widgetConfig.providers
    : Array.isArray(item?.providers)
      ? item.providers
      : [];
  const userConfigurableProviders =
    getUserConfigurableProviders(declaredProviders);
  return [
    { key: "edit", label: "Settings", icon: "cog" },
    ...(item?.type !== "widget" && item?.grid
      ? [{ key: "grid_layout", label: "Layout", icon: "square" }]
      : []),
    ...(hasNotifications
      ? [{ key: "notifications", label: "Notifications", icon: "bell" }]
      : []),
    ...(hasScheduledTasks
      ? [{ key: "schedule", label: "Schedule", icon: "clock" }]
      : []),
    ...(item?.workspace !== "layout"
      ? [{ key: "handlers", label: "Listeners", icon: "phone" }]
      : []),
    ...(userConfigurableProviders.length > 0
      ? [{ key: "providers", label: "Providers", icon: "plug" }]
      : []),
    { key: "code", label: "Code", icon: "code" },
  ];
};

export const LayoutBuilderConfigModal = ({
  workspace,
  open,
  setIsOpen,
  onSaveWorkspace,
  item = null,
  initialSection = null,
}) => {
  const [itemSelected, setItemSelected] = useState(item);
  const [workspaceSelected, setWorkspaceSelected] = useState(workspace);
  const [activeSection, setActiveSection] = useState("edit");

  const [, updateState] = useState();
  const forceUpdate = useCallback(() => updateState({}), []);

  useEffect(() => {
    if (item !== itemSelected) {
      setItemSelected(() => item);
    }

    if (workspace !== workspaceSelected) {
      setWorkspaceSelected(() => workspace);
    }

    if (open && initialSection) {
      setActiveSection(initialSection);
    }

    if (open === false) {
      setItemSelected(null);
      setActiveSection("edit");
      setWorkspaceSelected(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleEditChange(itemChanged, workspaceChanged) {
    setItemSelected(() => itemChanged);
    setWorkspaceSelected(() => workspaceChanged);
    forceUpdate();
  }

  function handleSaveConfig() {
    onSaveWorkspace(workspaceSelected);
  }

  const sections = itemSelected ? getSections(itemSelected) : [];
  const activeDef =
    sections.find((s) => s.key === activeSection) || sections[0];

  // Footer label: full scoped id (`scope.package.Component`) so the
  // user always sees the underlying widget identity, even when the
  // primary title is a custom per-instance label. No workspace fallback.
  const footerPackageLabel = (() => {
    const scopedId = itemSelected?.component || "";
    if (typeof scopedId !== "string") return "";
    const parts = scopedId.split(".");
    return parts.length === 3 ? scopedId : "";
  })();
  // Friendly name on the top line, full scoped id on the subtitle.
  // Same priority chain the Listeners/Widgets tabs and WidgetCardHeader
  // use, via the shared `pickWidgetDisplayName` helper.
  const widgetCfg = itemSelected
    ? ComponentManager.config(itemSelected.component, itemSelected)
    : null;
  const friendlyName = itemSelected
    ? pickWidgetDisplayName(itemSelected, widgetCfg)
    : "";
  const footerLeftContent = footerPackageLabel ? (
    <span className="flex flex-col leading-tight">
      <span>{friendlyName}</span>
      <span className="text-[10px] opacity-50 font-mono">
        {footerPackageLabel}
      </span>
    </span>
  ) : (
    friendlyName
  );

  return (
    itemSelected !== null && (
      <SettingsModal isOpen={open} setIsOpen={setIsOpen}>
        <SettingsModal.Sidebar>
          <Sidebar.Content>
            {sections.map((section) => {
              const isActive = activeSection === section.key;
              return (
                <Sidebar.Item
                  key={section.key}
                  icon={
                    <FontAwesomeIcon
                      icon={section.icon}
                      className="h-3.5 w-3.5"
                    />
                  }
                  active={isActive}
                  onClick={() => setActiveSection(section.key)}
                  className={isActive ? "bg-white/10 opacity-100" : ""}
                >
                  {section.label}
                </Sidebar.Item>
              );
            })}
          </Sidebar.Content>
        </SettingsModal.Sidebar>

        <SettingsModal.Header border={true} padding="px-4 py-3">
          <SubHeading2 title={activeDef?.label || "Settings"} padding={false} />
        </SettingsModal.Header>

        <SettingsModal.Body
          scrollable={false}
          padding="p-0"
          className="flex flex-col min-h-0"
        >
          {activeSection === "edit" && (
            <PanelEditItem
              item={itemSelected}
              onUpdate={handleEditChange}
              workspace={workspaceSelected}
            />
          )}

          {activeSection === "grid_layout" && (
            <PanelEditItemGrid
              item={itemSelected}
              onUpdate={handleEditChange}
              workspace={workspaceSelected}
            />
          )}

          {activeSection === "notifications" && (
            <PanelEditItemNotifications
              item={itemSelected}
              onUpdate={handleEditChange}
              workspace={workspaceSelected}
            />
          )}

          {activeSection === "schedule" && (
            <PanelEditItemSchedule
              item={itemSelected}
              onUpdate={handleEditChange}
              workspace={workspaceSelected}
            />
          )}

          {activeSection === "handlers" && (
            <PanelEditItemHandlers
              item={itemSelected}
              onUpdate={handleEditChange}
              workspace={workspaceSelected}
            />
          )}

          {activeSection === "providers" && (
            <PanelEditItemProviders
              item={itemSelected}
              onUpdate={handleEditChange}
              workspace={workspaceSelected}
            />
          )}

          {activeSection === "code" && (
            <PanelCode
              item={itemSelected}
              onUpdate={handleEditChange}
              workspace={workspaceSelected}
            />
          )}
        </SettingsModal.Body>

        <SettingsModal.Footer leftContent={footerLeftContent}>
          <Button title={"Cancel"} onClick={() => setIsOpen(false)} />
          <Button
            title={"Save Changes"}
            hoverBackgroundColor={"hover:bg-green-700"}
            onClick={handleSaveConfig}
          />
        </SettingsModal.Footer>
      </SettingsModal>
    )
  );
};
