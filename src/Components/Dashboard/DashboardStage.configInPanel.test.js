/**
 * A selected widget's settings inline in the edit panel (create-entry PRD
 * CRE-006 AC4/AC5) — the wiring around WidgetConfigPanel.
 *
 * DashboardStage finds the widget's page and prepares the item like the
 * Configure dialog; each change goes to the owning LayoutBuilder as an
 * `update` edit action, staged until the dashboard's Save. In edit mode the
 * widget's gear and footer Configure open the panel section instead of the
 * dialog. Source pins, like the other DashboardStage tests.
 */
const fs = require("fs");
const path = require("path");

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const stage = read("DashboardStage.js");
const builder = read("..", "Layout", "Builder", "LayoutBuilder.js");
const grid = read("..", "Layout", "Builder", "LayoutGridContainer.js");
const sectionLayout = read("..", "Settings", "SectionLayout.js");
const handlers = read(
  "..",
  "Layout",
  "Builder",
  "Modal",
  "Panel",
  "PanelEditItemHandlers.js",
);

describe("DashboardStage — inline widget settings", () => {
  test("finds the widget's page and prepares the item like the dialog", () => {
    expect(stage).toMatch(/const editConfigTarget = useMemo\(/);
    expect(stage).toMatch(
      /\.\.\.\(LayoutModel\(copy, layout, workspaceSelected\.id\) \|\| copy\),\s*uuid: raw\.uuid,/,
    );
    expect(stage).toMatch(/workspace: \{ \.\.\.workspaceSelected, layout \}/);
  });

  test("renders WidgetConfigPanel in the panel, keyed by the widget", () => {
    expect(stage).toMatch(
      /widgetConfig=\{\s*editConfigTarget \? \(\s*<WidgetConfigPanel\s+key=\{editSelection\.uuid\}/,
    );
  });

  test("changes go out as an update edit action; More settings opens the dialog", () => {
    expect(stage).toMatch(
      /onCommit=\{\(ws\) =>\s*dispatchEditAction\("update", null, \{ workspace: ws \}\)\s*\}/,
    );
    expect(stage).toMatch(
      /onOpenMore=\{\(\) => dispatchEditAction\("configure"\)\}/,
    );
  });

  test("a selection can ask for a section (the gear → Listeners)", () => {
    expect(stage).toMatch(
      /\(editSelection\?\.kind === "widget" && editSelection\.section\) \|\| "edit"/,
    );
  });
});

describe("LayoutBuilder — the update action", () => {
  test("commits the page's new layout (staged until Save)", () => {
    expect(builder).toMatch(
      /if \(action === "update"\) \{[\s\S]{0,200}commitWorkspace\(\{\s*\.\.\.ws,\s*layout: next\.layout,\s*selectedProviders: next\.selectedProviders \?\? ws\.selectedProviders,\s*\}\);/,
    );
  });
});

describe("Grid — the widget's Configure buttons while editing", () => {
  test("the gear and the footer open the panel section, not the dialog", () => {
    expect(
      grid.match(
        /editSelection\.available && opensInPanel\(section\)\s*\)?\s*\{\s*selectWidget\("widget", section \|\| "edit"\);\s*return;/g,
      ),
    ).toHaveLength(2);
  });

  test("notifications / schedule still open the dialog", () => {
    expect(grid).toMatch(
      /!section \|\| \["edit", "handlers", "providers", "code"\]\.includes\(section\)/,
    );
  });
});

describe("Listeners fits the narrow panel", () => {
  test("SectionLayout can stack list above detail", () => {
    expect(sectionLayout).toMatch(/stacked = false,/);
    expect(sectionLayout).toMatch(/stacked \? "w-full max-h-48 border-b"/);
  });

  test("PanelEditItemHandlers passes stacked through", () => {
    expect(handlers).toMatch(/stacked=\{stacked\}/);
  });
});

describe("DashboardStage — bot tabs in the panel (CRE-006 AC5)", () => {
  test("the Bot tab renders BotConfigPanel, keyed by the bot", () => {
    expect(stage).toMatch(
      /botEditor=\{\s*selectedEditBot \? \(\s*<BotConfigPanel\s+key=\{selectedEditBot\.id\}/,
    );
  });

  test("re-staging keeps the form as first opened (for keepLatest at Save)", () => {
    expect(stage).toMatch(/opened: prevForm \? prevForm\.opened : opened,/);
    expect(stage).toMatch(/pendingBotFormsRef\.current = \{\};/);
  });
});
