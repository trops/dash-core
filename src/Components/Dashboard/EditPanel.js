import React, { useContext, useState } from "react";
import {
  Button,
  InputText,
  RadioGroup,
  SectionLabel,
  SelectInput,
  Tabs3,
  Toggle,
} from "@trops/dash-react";
import { ThemeContext } from "../../Context";
import { ThemeColorDots } from "../Theme/ThemeColorDots";
import { WidgetSidebar } from "../Navigation/WidgetSidebar";

/**
 * EditPanel — the right-hand panel of the full-screen dashboard editor
 * (create-entry phase 1b / CRE-010). Replaces the old collapsible widget
 * sidebar and the settings that used to crowd the edit header.
 *
 *   Add       — the widget library (Installed / Registry), drag onto the
 *               dashboard
 *   Dashboard — name, folder, Scrollable, pinned sidebar, Dashboard Config
 *   Theme     — the dashboard's theme
 *
 * Every change here is staged like any other edit and saved with Save.
 */
export const EditPanel = ({
  workspace,
  menuItems = [],
  themes = {},
  username = "",
  onNameChange = null,
  onFolderChange = null,
  onThemeChange = null,
  scrollableEnabled = false,
  onScrollableChange = null,
  sidebarEnabled = false,
  onSidebarChange = null,
  onOpenConfig = null,
  configUnresolvedCount = 0,
}) => {
  const { currentTheme = {}, themes: contextThemes } = useContext(ThemeContext);
  const [tab, setTab] = useState("add");
  const allThemes =
    themes && Object.keys(themes).length > 0 ? themes : contextThemes || {};
  const ws = workspace || {};

  const themeOptions = Object.entries(allThemes)
    .sort(([, a], [, b]) => (a.name || "").localeCompare(b.name || ""))
    .map(([key, t]) => ({
      value: key,
      label: (
        <span className="inline-flex items-center gap-2">
          {t.name || key}
          <ThemeColorDots theme={t} />
        </span>
      ),
    }));

  return (
    <aside
      aria-label="Edit dashboard"
      className={`flex flex-col w-80 flex-shrink-0 h-full min-h-0 border-l ${
        currentTheme["border-primary-dark"] || ""
      } ${currentTheme["bg-primary-very-dark"] || ""}`}
    >
      <Tabs3
        value={tab}
        onValueChange={setTab}
        className="flex flex-col flex-1 min-h-0 border-0"
      >
        <Tabs3.List className="mx-3 mt-3 self-start">
          <Tabs3.Trigger value="add">Add</Tabs3.Trigger>
          <Tabs3.Trigger value="dashboard">Dashboard</Tabs3.Trigger>
          <Tabs3.Trigger value="theme">Theme</Tabs3.Trigger>
        </Tabs3.List>

        <Tabs3.Content value="add" className="flex flex-1 min-h-0">
          <WidgetSidebar embedded username={username} />
        </Tabs3.Content>

        <Tabs3.Content
          value="dashboard"
          className="flex flex-col gap-4 p-4 overflow-y-auto"
        >
          {onNameChange && (
            <div className="flex flex-col gap-1">
              <SectionLabel>Name</SectionLabel>
              <InputText
                name="name"
                value={ws.name || ""}
                onChange={onNameChange}
                placeholder="Dashboard name"
              />
            </div>
          )}
          {onFolderChange && menuItems.length > 0 && (
            <div className="flex flex-col gap-1">
              <SectionLabel>Folder</SectionLabel>
              <SelectInput
                value={ws.menuId ?? ""}
                options={menuItems
                  .map((m) => ({
                    label: m.name,
                    value: m.id,
                    icon: m.icon || m.folder || "folder",
                  }))
                  .sort((a, b) => (a.label || "").localeCompare(b.label || ""))}
                onChange={onFolderChange}
                placeholder="Folder"
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <SectionLabel>Layout</SectionLabel>
            {onScrollableChange && (
              <Toggle
                text="Scrollable"
                enabled={scrollableEnabled}
                setEnabled={onScrollableChange}
              />
            )}
            {onSidebarChange && (
              <Toggle
                text="Pinned sidebar"
                enabled={sidebarEnabled}
                setEnabled={onSidebarChange}
              />
            )}
          </div>
          {onOpenConfig && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Providers, listeners and bots</SectionLabel>
              {configUnresolvedCount > 0 && (
                <span
                  className={`text-sm ${currentTheme["text-primary-medium"] || ""}`}
                >
                  {configUnresolvedCount} widget
                  {configUnresolvedCount === 1 ? " needs" : "s need"} a
                  provider.
                </span>
              )}
              <Button
                title="Open Dashboard Config"
                onClick={onOpenConfig}
                size="sm"
              />
            </div>
          )}
        </Tabs3.Content>

        <Tabs3.Content
          value="theme"
          className="flex flex-col p-4 overflow-y-auto"
        >
          {onThemeChange && themeOptions.length > 0 ? (
            <RadioGroup
              label="Theme"
              name="dashboard-theme"
              value={ws.themeKey || ""}
              onChange={(key) => onThemeChange(key)}
              options={themeOptions}
            />
          ) : (
            <span className="text-sm opacity-60">No themes yet.</span>
          )}
        </Tabs3.Content>
      </Tabs3>
    </aside>
  );
};
