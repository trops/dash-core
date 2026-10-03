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

  it("closing by dashboard name never closes a page tab", () => {
    expect(src).toMatch(
      /\(openTabsRef\.current \|\| \[\]\)\.find\(\s*\(t\) =>\s*t\.workspace &&/,
    );
  });
});
