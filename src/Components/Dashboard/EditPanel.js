import React, { useContext, useEffect, useState } from "react";
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
 *   Widget    — the selected widget (phase 1c): its Settings, Listeners,
 *               Providers and Code open the Configure dialog at that
 *               section; Edit with AI; Remove
 *   Bot       — the selected bot's form (passed in as `botEditor`)
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
  // Select-to-edit (phase 1c)
  selection = null,
  onWidgetAction = null,
  widgetHasProviders = false,
  botEditor = null,
  // Phase 1d: place a picked widget in the selected empty cell; Ask AI.
  onPlaceWidget = null,
  onAskAi = null,
  // Phase 1e: move the selected widget without dragging (true = start).
  onMoveWidget = null,
}) => {
  const { currentTheme = {}, themes: contextThemes } = useContext(ThemeContext);
  const [tab, setTab] = useState("add");
  const selectionKey = selection
    ? selection.kind === "widget"
      ? `widget:${selection.uuid}:${selection.openTab || ""}`
      : selection.kind === "cell"
        ? `cell:${selection.scope}:${selection.gridItemId}:${selection.cellNumber}`
        : `bot:${selection.botId}`
    : null;
  const canAskAi = selection?.kind === "widget" || selection?.kind === "cell";
  // A new selection opens its tab; clearing it leaves a stale tab — fall
  // back to Add.
  useEffect(() => {
    if (!selection) {
      setTab((t) => (t === "widget" || t === "bot" || t === "ask" ? "add" : t));
    } else {
      setTab(
        selection.openTab ||
          (selection.kind === "cell" ? "add" : selection.kind),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);
  const act = (...args) => onWidgetAction && onWidgetAction(...args);
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
          {selection?.kind === "widget" && (
            <Tabs3.Trigger value="widget">Widget</Tabs3.Trigger>
          )}
          {selection?.kind === "bot" && (
            <Tabs3.Trigger value="bot">Bot</Tabs3.Trigger>
          )}
          {canAskAi && <Tabs3.Trigger value="ask">Ask AI</Tabs3.Trigger>}
          <Tabs3.Trigger value="dashboard">Dashboard</Tabs3.Trigger>
          <Tabs3.Trigger value="theme">Theme</Tabs3.Trigger>
        </Tabs3.List>

        <Tabs3.Content value="add" className="flex flex-1 min-h-0">
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            {selection?.kind === "cell" && (
              <span
                className={`mx-4 mt-3 text-xs ${currentTheme["text-primary-medium"] || ""}`}
              >
                Placing in cell {selection.cellNumber} — click a widget, or drag
                one onto the dashboard.
              </span>
            )}
            <WidgetSidebar
              embedded
              username={username}
              onPick={
                selection?.kind === "cell" && onPlaceWidget
                  ? onPlaceWidget
                  : null
              }
            />
          </div>
        </Tabs3.Content>

        {selection?.kind === "widget" && (
          <Tabs3.Content
            value="widget"
            className="flex flex-col gap-4 p-4 overflow-y-auto"
          >
            <div className="flex flex-col gap-1">
              <SectionLabel>Widget</SectionLabel>
              <span className="text-base font-semibold">
                {selection.label || selection.component}
              </span>
              <span
                className={`text-xs break-all ${currentTheme["text-primary-medium"] || ""}`}
              >
                {selection.component}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <SectionLabel>Configure</SectionLabel>
              <Button
                title="Settings"
                onClick={() => act("configure", "edit")}
                size="sm"
              />
              <Button
                title="Listeners"
                onClick={() => act("configure", "handlers")}
                size="sm"
              />
              {widgetHasProviders && (
                <Button
                  title="Providers"
                  onClick={() => act("configure", "providers")}
                  size="sm"
                />
              )}
              <Button
                title="Code"
                onClick={() => act("configure", "code")}
                size="sm"
              />
            </div>
            <div className="flex flex-col gap-2">
              <SectionLabel>More</SectionLabel>
              {onMoveWidget &&
                (selection.moving ? (
                  <div className="flex flex-col gap-2">
                    <span
                      role="status"
                      className={`text-xs ${currentTheme["text-primary-light"] || ""}`}
                    >
                      Choose a cell in the same grid: click it, or Tab to it and
                      press Enter. An empty cell takes the widget; a full one
                      swaps with it.
                    </span>
                    <Button
                      title="Stop moving"
                      onClick={() => onMoveWidget(false)}
                      size="sm"
                    />
                  </div>
                ) : (
                  <Button
                    title="Move to another cell"
                    onClick={() => onMoveWidget(true)}
                    size="sm"
                  />
                ))}
              <Button
                title="Edit with AI"
                onClick={() => act("edit-with-ai")}
                size="sm"
              />
              <Button
                title="Remove from dashboard"
                onClick={() => act("remove")}
                size="sm"
              />
            </div>
            <span
              className={`text-xs ${currentTheme["text-primary-medium"] || ""}`}
            >
              Changes wait for Save. Press Esc or click the dashboard name to go
              back to the dashboard.
            </span>
          </Tabs3.Content>
        )}

        {selection?.kind === "bot" && (
          <Tabs3.Content
            value="bot"
            className="flex flex-col flex-1 min-h-0 overflow-y-auto"
          >
            {botEditor}
          </Tabs3.Content>
        )}

        {canAskAi && (
          <Tabs3.Content value="ask" className="flex flex-col gap-3 p-4">
            <SectionLabel>Ask AI</SectionLabel>

            <Button
              title={
                selection.kind === "cell"
                  ? "Build a widget for this cell"
                  : "Edit this widget with AI"
              }
              onClick={() => onAskAi && onAskAi()}
              size="sm"
            />

            <span
              className={`text-xs ${currentTheme["text-primary-medium"] || ""}`}
            >
              Opens the Widget Builder. Building right here in the panel comes
              with the Create screen.
            </span>
          </Tabs3.Content>
        )}

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
