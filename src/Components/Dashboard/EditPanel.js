import React, { useContext, useEffect, useState } from "react";
import {
  ActionMenu,
  Button,
  Button2,
  Button3,
  InputText,
  RadioGroup,
  SectionLabel,
  SelectInput,
  Tabs3,
  Toggle,
  useStatusTokens,
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
 *   Widget    — the selected widget (consolidation Phase 3P): its name and
 *               whose it is, a ⋯ menu (Move, Split, Remove), one Change
 *               button (Create, where you pick AI or by hand — blocked
 *               while edits wait for Save), then everything you can set on
 *               it (WidgetPanel)
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
  // Everything you can set on the selected widget (WidgetPanel, built by
  // DashboardStage) — consolidation Phase 3P.
  widgetConfig = null,
  botEditor = null,
  // Phase 1d: place a picked widget in the selected empty cell; an empty
  // cell's Build with AI (Create, through the Dash team).
  onPlaceWidget = null,
  onBuildWithAi = null,
  // The selected widget: whose it is ("Built by AI · yours"), whether a
  // change can go in place, and why Change waits (unsaved edits).
  widgetOwner = "",
  widgetNotYours = false,
  changeBlocked = "",
  // False for a built-in widget (it ships with Dash; nothing to change).
  canChange = true,
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
  // A new selection opens its tab; clearing it leaves a stale tab — fall
  // back to Add.
  useEffect(() => {
    if (!selection) {
      setTab((t) => (t === "widget" || t === "bot" ? "add" : t));
    } else {
      // A new selection opens its own panel (a widget's, a bot's form; an
      // empty cell: Add, with Build with AI on top).
      setTab(() => {
        if (selection.kind === "cell") return "add";
        if (selection.openTab && selection.openTab !== "ask") {
          return selection.openTab;
        }
        return selection.kind;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);
  const act = (...args) => onWidgetAction && onWidgetAction(...args);
  const muted = currentTheme["text-neutral-medium"] || "";
  const status = useStatusTokens();
  const widgetName =
    selection?.kind === "widget" ? selection.label || selection.component : "";
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

  // A raised neutral panel with a hairline edge, like the dock panels
  // (Create, Assistant): neutral tokens, not the saturated primary fill;
  // `chrome-glass` gives it the Aurora raised-glass surface.
  return (
    <aside
      aria-label="Edit dashboard"
      className={`chrome-glass flex flex-col w-80 flex-shrink-0 h-full min-h-0 border-l ${
        currentTheme["border-neutral-dark"] || ""
      } ${currentTheme["bg-neutral-very-dark"] || ""}`}
    >
      <Tabs3
        value={tab}
        onValueChange={setTab}
        // The panel is the surface; the tabs wrapper adds no fill of its own.
        backgroundColor="bg-transparent"
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
          <Tabs3.Trigger value="dashboard">Dashboard</Tabs3.Trigger>
          <Tabs3.Trigger value="theme">Theme</Tabs3.Trigger>
        </Tabs3.List>

        <Tabs3.Content value="add" className="flex flex-1 min-h-0">
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            {selection?.kind === "cell" && (
              <div
                className="flex flex-col gap-2 px-4 pt-4"
                data-testid="empty-cell"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-base font-semibold">Empty cell</span>
                  <span className={`text-xs ${muted}`}>
                    Cell {selection.cellNumber}
                  </span>
                </div>
                {onBuildWithAi && (
                  <Button3
                    title="Build with AI"
                    onClick={onBuildWithAi}
                    size="sm"
                  />
                )}
                <span className={`text-xs ${muted}`}>
                  Or add a widget you have: click it, or drag it onto the
                  dashboard.
                </span>
              </div>
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
            className="flex flex-col flex-1 min-h-0"
          >
            <div className="flex flex-col gap-3 px-4 pt-4 pb-2">
              <div className="flex flex-row items-start gap-2">
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="text-base font-semibold truncate">
                    {widgetName}
                  </span>
                  {widgetOwner ? (
                    <span className={`text-xs ${muted}`}>{widgetOwner}</span>
                  ) : null}
                </div>
                {!selection.moving && (
                  <ActionMenu
                    label={`${widgetName} options`}
                    items={[
                      ...(onMoveWidget
                        ? [
                            {
                              label: "Move to another cell",
                              onSelect: () => onMoveWidget(true),
                            },
                          ]
                        : []),
                      {
                        label: "Split side by side",
                        onSelect: () =>
                          act("split", null, {
                            direction: "horizontal",
                          }),
                      },
                      {
                        label: "Split top and bottom",
                        onSelect: () =>
                          act("split", null, {
                            direction: "vertical",
                          }),
                      },
                      "separator",
                      {
                        label: "Remove",
                        danger: true,
                        onSelect: () => act("remove"),
                      },
                    ]}
                  />
                )}
              </div>
              {onMoveWidget && selection.moving ? (
                <div className="flex flex-col gap-2">
                  <span
                    role="status"
                    className={`text-xs ${currentTheme["text-neutral-light"] || ""}`}
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
              ) : canChange ? (
                <div
                  className="flex flex-col gap-1"
                  data-testid="widget-change"
                >
                  {/* One Change: Create › Change, where you pick AI (the
                      Dash team) or by hand. Secondary — the dashboard's
                      Save stays the one main button. */}
                  <Button2
                    title={`Change ${widgetName}`}
                    onClick={() => act("edit-with-ai")}
                    disabled={!!changeBlocked}
                  />
                  {changeBlocked ? (
                    <span
                      role="status"
                      className={`text-xs ${status.warning.icon}`}
                    >
                      {changeBlocked}
                    </span>
                  ) : widgetNotYours ? (
                    <span className={`text-xs ${muted}`}>
                      It isn't yours, so a change is saved as a new widget in
                      this cell.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {widgetConfig}
            <span
              className={`px-4 py-2 border-t text-xs ${muted} ${
                currentTheme["border-neutral-dark"] || ""
              }`}
            >
              Settings wait for Save. Changes to the code are made in Create.
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
                  className={`text-sm ${currentTheme["text-neutral-medium"] || ""}`}
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
            <span
              className={`text-sm ${currentTheme["text-neutral-medium"] || ""}`}
            >
              No themes yet.
            </span>
          )}
        </Tabs3.Content>
      </Tabs3>
    </aside>
  );
};
