/**
 * DashboardStage — Manage pages as tabs (app-navigation PRD NAV-002/003/004).
 * Static wiring pins (DashboardStage is too large to mount here; the pieces
 * are unit-tested in tabModel / appPages / AppPage / DashSidebar / DashTabBar).
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "DashboardStage.js"), "utf8");

describe("DashboardStage — Manage pages", () => {
  it("opens pages through the tab model and the sidebar", () => {
    expect(src).toMatch(/import \{ AppPage \} from "\.\.\/AppPages\/AppPage"/);
    expect(src).toMatch(/openPageTab\(/);
    expect(src).toMatch(
      /<DashSidebar[\s\S]*?activePageKey=\{activePageKey\}[\s\S]*?onOpenPage=\{handleOpenPageGuarded\}[\s\S]*?pageAttention=\{\{ bots: pendingApprovals \}\}/,
    );
    expect(src).toMatch(/usePendingApprovalCount\(\)/);
  });

  it("a page tab has no workspace, so dashboard-only UI switches off", () => {
    // workspaceSelected still comes from the active tab's workspace.
    expect(src).toMatch(
      /openTabs\.find\(\(tab\) => tab\.id === activeTabId\)\?\.workspace \?\? null/,
    );
    expect(src).toMatch(/const activePageKey = pageKeyOf\(activeTabId\)/);
  });

  it("renders the page host when a page tab is active, in the app theme", () => {
    // Outside DashboardThemeProvider: the page branch comes after the
    // dashboard branch's provider closes.
    expect(src).toMatch(
      /\) : activePageKey \? \([\s\S]{0,200}?<AppPage[\s\S]*?pageKey=\{activePageKey\}/,
    );
  });

  it("shows the tab bar whenever any tab is open (pages too)", () => {
    const bars = src.match(/<DashTabBar\b/g) || [];
    expect(bars.length).toBe(1);
    // Rendered after the main-area ternary, not inside the dashboard branch.
    expect(src).toMatch(
      /\{!popout && openTabs\.length > 0 && \(\s*<DashTabBar/,
    );
  });

  it("saves and restores page tabs with the session", () => {
    expect(src).toMatch(/restoreTabs\(state\.openTabIds, workspaceConfig\)/);
  });

  it("doesn't save the (empty) first-render tabs over the session before it's restored", () => {
    // The save effect used to run on mount with [] and overwrite the saved
    // session before restore read it (after dashboards load) — so nothing
    // ever came back.
    expect(src).toMatch(
      /\/\/ ─── Session save \(continuous\)[\s\S]{0,400}if \(popout \|\| !sessionRestored\.current\) return;/,
    );
    expect(src).toMatch(
      /\/\/ ─── Session save \(continuous\)[\s\S]{0,700}\}, \[openTabs, activeTabId, popout, sessionReady\]\);/,
    );
  });

  it("sends Settings sections that moved to their page", () => {
    expect(src).toMatch(
      /function openAppSettings\([\s\S]*?const page = pageForSettingsSection\(section\);[\s\S]*?handleOpenPageGuarded\(page\.key/,
    );
  });

  it("switching tabs with unsaved dashboard edits asks first", () => {
    expect(src).toMatch(
      /function handleSwitchTabGuarded\(tabId\)[\s\S]*?if \(isDirty && tabId !== activeTabId\)[\s\S]*?kind: "switch-tab"/,
    );
    expect(src).toMatch(/pending\.kind === "switch-tab"/);
  });

  it("the Bots page opens a bot in its team's Bots view", () => {
    expect(src).toMatch(
      /function handleOpenBotInBotsView\(ws, botId\) \{[\s\S]*?focusBot\(ws\.id, botId\);[\s\S]*?handleOpenTabGuarded\(ws\);/,
    );
    expect(src).toMatch(
      /<AppPage[\s\S]*?onOpenBotInBotsView=\{handleOpenBotInBotsView\}/,
    );
  });

  it("the Widgets page opens Settings › Privacy & Security", () => {
    expect(src).toMatch(
      /<AppPage[\s\S]*?onOpenPrivacySettings=\{\(\) =>\s*openAppSettings\("privacy-security"\)\s*\}/,
    );
  });

  it("Edit theme opens the theme editor on the theme the Themes page picked", () => {
    expect(src).toMatch(
      /function handleOpenThemeManager\(themeKey = null\) \{[\s\S]*?setThemeEditorKey\(typeof themeKey === "string" \? themeKey : null\);[\s\S]*?setIsThemeManagerOpen\(true\);/,
    );
    expect(src).toMatch(
      /<AppPage[\s\S]*?onOpenThemeEditor=\{handleOpenThemeManager\}/,
    );
    expect(src).toMatch(
      /<ThemeManagerModal[\s\S]*?initialThemeKey=\{themeEditorKey\}/,
    );
  });

  it("closing by dashboard name never closes a page tab", () => {
    expect(src).toMatch(
      /\(openTabsRef\.current \|\| \[\]\)\.find\(\s*\(t\) =>\s*t\.workspace &&/,
    );
  });
});

describe("DashboardStage — Dashboards page actions (NAV-005 AC3)", () => {
  it("Bots view opens the dashboard's tab in its Bots view", () => {
    expect(src).toMatch(
      /function handleOpenDashboardBotsView\(ws\) \{[\s\S]{0,300}setStageModeByWorkspace\(\(prev\) => \(\{ \.\.\.prev, \[ws\.id\]: "bots" \}\)\);[\s\S]{0,120}handleOpenTabGuarded\(ws\);/,
    );
  });

  it("Dashboard Config opens the dashboard, enters edit mode, then opens Config", () => {
    expect(src).toMatch(
      /function handleOpenDashboardConfig\(ws\) \{[\s\S]{0,200}setPendingConfigFor\(ws\.id\);[\s\S]{0,80}handleOpenTabGuarded\(ws\);/,
    );
    // Once that dashboard is showing: edit mode (with the usual snapshot,
    // so Cancel works) and the modal.
    expect(src).toMatch(
      /pendingConfigFor[\s\S]{0,200}workspaceSelected\.id\) !== String\(pendingConfigFor\)\) return;[\s\S]{0,200}if \(previewMode\) handleToggleEditMode\(\);[\s\S]{0,80}setIsConfigModalOpen\(true\);/,
    );
  });

  it("the page gets both handlers", () => {
    expect(src).toMatch(
      /<AppPage[\s\S]*?onOpenBotsView=\{handleOpenDashboardBotsView\}[\s\S]*?onOpenDashboardConfig=\{handleOpenDashboardConfig\}/,
    );
  });

  it("the command palette can open pages", () => {
    expect(src).toMatch(
      /<DashCommandPalette[\s\S]*?onOpenPage=\{handleOpenPageGuarded\}/,
    );
  });
});
