import React, { useContext, useEffect, useState } from "react";
import {
  ButtonIcon,
  ButtonIcon2,
  InputText,
  SelectInput,
  SubHeading3,
  Toggle,
} from "@trops/dash-react";
import { ThemeContext } from "../../Context";
import { ThemeColorDots } from "../Theme/ThemeColorDots";
import deepEqual from "deep-equal";

export const DashboardHeader = ({
  workspace,
  preview,
  onClickEdit = null,
  onPopout = null,
  onNameChange,
  onSaveChanges = null,
  menuItems = [],
  themes = {},
  onFolderChange = null,
  onThemeChange = null,
  scrollableEnabled = false,
  onScrollableChange = null,
  sidebarEnabled = false,
  onSidebarChange = null,
  // Dashboard Config modal trigger. Present = render a gear button in
  // the header. `configUnresolvedCount` drives an amber dot indicator.
  onOpenConfig = null,
  configUnresolvedCount = 0,
}) => {
  const [workspaceSelected, setWorkspaceSelected] = useState(workspace);
  const { currentTheme, themes: contextThemes } = useContext(ThemeContext);
  const resolvedThemes =
    themes && Object.keys(themes).length > 0 ? themes : contextThemes || {};

  useEffect(() => {
    if (deepEqual(workspace, workspaceSelected) === false) {
      setWorkspaceSelected(() => workspace);
    }
  }, [workspace, workspaceSelected]);

  return (
    <div
      className={`flex flex-row p-1 justify-between shrink items-center px-4 ${currentTheme["bg-primary-dark"]} py-2`}
    >
      {preview === true ? (
        <>
          <SubHeading3
            title={(workspaceSelected.name || "Untitled").replace(/^./, (c) =>
              c.toUpperCase(),
            )}
            padding={false}
            className="font-bold text-base"
          />
          <div className="flex flex-row items-center gap-1">
            {onOpenConfig !== null && (
              <DashboardConfigButton
                onClick={onOpenConfig}
                unresolvedCount={configUnresolvedCount}
              />
            )}
            {onPopout !== null && (
              <ButtonIcon
                icon="arrow-up-right-from-square"
                onClick={onPopout}
                hoverBackgroundColor={"hover:bg-indigo-700"}
              />
            )}
            {onClickEdit !== null && (
              <ButtonIcon
                icon="pencil"
                onClick={onClickEdit}
                hoverBackgroundColor={"hover:bg-indigo-700"}
              />
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-row items-center gap-2 flex-1 min-w-0">
            <InputText
              name="name"
              value={workspaceSelected.name}
              onChange={onNameChange}
              textSize={"text-lg"}
              placeholder="My Workspace"
              bgColor={currentTheme["bg-primary-very-dark"]}
              textColor={currentTheme["text-primary-medium"]}
              hasBorder={false}
              autoFocus
            />
            {onFolderChange && menuItems.length > 0 && (
              <SelectInput
                value={workspaceSelected.menuId ?? ""}
                options={menuItems
                  .map((m) => ({
                    label: m.name,
                    value: m.id,
                    icon: m.icon || m.folder || "folder",
                  }))
                  .sort((a, b) => (a.label || "").localeCompare(b.label || ""))}
                onChange={(menuId) => {
                  setWorkspaceSelected((prev) => ({
                    ...prev,
                    menuId,
                  }));
                  onFolderChange(menuId);
                }}
                placeholder="Folder"
                backgroundColor={currentTheme["bg-primary-very-dark"]}
                textColor={currentTheme["text-primary-medium"]}
                borderColor={currentTheme["border-primary-dark"]}
                inputClassName="py-1 text-sm"
                className="w-40 shrink-0"
              />
            )}
            {onThemeChange && Object.keys(resolvedThemes).length > 0 && (
              <SelectInput
                value={workspaceSelected.themeKey || ""}
                options={Object.entries(resolvedThemes)
                  .sort(([, a], [, b]) =>
                    (a.name || "").localeCompare(b.name || ""),
                  )
                  .map(([key, t]) => ({
                    label: t.name || key,
                    value: key,
                    icon: "palette",
                    badge: <ThemeColorDots theme={t} />,
                  }))}
                onChange={(themeKey) => {
                  setWorkspaceSelected((prev) => ({
                    ...prev,
                    themeKey,
                  }));
                  onThemeChange(themeKey);
                }}
                placeholder="Select a theme"
                backgroundColor={currentTheme["bg-primary-very-dark"]}
                textColor={currentTheme["text-primary-medium"]}
                borderColor={currentTheme["border-primary-dark"]}
                inputClassName="py-1 text-sm"
                className="w-40 shrink-0"
              />
            )}
            {onScrollableChange && (
              <Toggle
                text="Scrollable"
                enabled={scrollableEnabled}
                setEnabled={onScrollableChange}
              />
            )}
            {onSidebarChange && (
              <Toggle
                text="Sidebar"
                enabled={sidebarEnabled}
                setEnabled={onSidebarChange}
              />
            )}
          </div>
          <div className="flex flex-row space-x-1 shrink-0 items-center">
            {onOpenConfig !== null && (
              <DashboardConfigButton
                onClick={onOpenConfig}
                unresolvedCount={configUnresolvedCount}
              />
            )}
            {onClickEdit !== null && (
              <ButtonIcon2
                icon="xmark"
                text="Cancel"
                onClick={onClickEdit}
                hoverBackgroundColor={"hover:bg-indigo-700"}
              />
            )}
            {onSaveChanges !== null && (
              <ButtonIcon2
                icon="check"
                text="Save"
                onClick={onSaveChanges}
                backgroundColor={"bg-green-800"}
                hoverBackgroundColor={"hover:bg-green-700"}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * DashboardConfigButton — gear icon with an optional amber dot when the
 * current dashboard has unresolved provider bindings. Opens the
 * Dashboard Config modal. Kept local to DashboardHeader because no
 * other caller needs it.
 */
function DashboardConfigButton({ onClick, unresolvedCount = 0 }) {
  return (
    <div className="relative inline-flex">
      <ButtonIcon
        icon="sliders"
        onClick={onClick}
        hoverBackgroundColor={"hover:bg-indigo-700"}
      />
      {unresolvedCount > 0 && (
        <span
          className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400 border border-black/40 pointer-events-none"
          title={`${unresolvedCount} unresolved provider${
            unresolvedCount === 1 ? "" : "s"
          }`}
        />
      )}
    </div>
  );
}
