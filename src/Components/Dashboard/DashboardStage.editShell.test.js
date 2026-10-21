/**
 * Full-screen edit shell (create-entry phase 1b).
 *
 * In edit mode the dashboard fills the window: the app's left rail, the
 * open-tabs bar and the assistant rail are hidden, and the right-hand
 * EditPanel (Add / Dashboard / Theme) replaces the old widget sidebar.
 *
 * The dashboard column itself must stay in the same place in the tree —
 * the bars are dropped with conditionals in their existing slots — so
 * widgets don't remount (and reconnect their providers) on entering or
 * leaving edit mode.
 *
 * DashboardStage is too large to mount in a unit test; like its other
 * pins these check the source.
 */
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "DashboardStage.js"),
  "utf8",
);

describe("DashboardStage — full-screen edit shell", () => {
  test("isEditingDashboard is derived once from preview, popout, stage and selection", () => {
    expect(source).toMatch(
      /const isEditingDashboard =\s*!popout &&\s*!previewMode &&\s*stageMode === "dashboard" &&\s*workspaceSelected !== null;/,
    );
  });

  test("the app's left rail hides while editing", () => {
    expect(source).toMatch(
      /\{!popout && !isEditingDashboard && \(\s*<DashSidebar/,
    );
  });

  test("the open-tabs bar hides while editing", () => {
    expect(source).toMatch(
      /\{!popout && !isEditingDashboard && openTabs\.length > 0 && \(\s*<DashTabBar/,
    );
  });

  test("the assistant rail hides while editing", () => {
    expect(source).toMatch(
      /\{!popout && !isEditingDashboard && \(\s*<WorkspaceContext\.Provider value=\{dockWorkspaceContext\}>/,
    );
  });

  test("the EditPanel replaces the old widget sidebar", () => {
    // Wrapped so its notifications / schedule editors wait for Save.
    expect(source).toMatch(
      /\{isEditingDashboard && \(\s*<PendingSettingsContext\.Provider value=\{pendingSettings\}>\s*<EditPanel/,
    );
    expect(source).not.toMatch(/<WidgetSidebar/);
  });

  test("the header no longer receives dashboard settings (the panel does)", () => {
    const header = source.match(/<DashboardHeader([\s\S]*?)\/>/);
    expect(header).not.toBeNull();
    expect(header[1]).not.toMatch(/onFolderChange=/);
    expect(header[1]).not.toMatch(/onThemeChange=/);
    expect(header[1]).not.toMatch(/onScrollableChange=/);
    expect(header[1]).not.toMatch(/onSidebarChange=/);
    expect(header[1]).not.toMatch(/onOpenConfig=/);
  });
});
