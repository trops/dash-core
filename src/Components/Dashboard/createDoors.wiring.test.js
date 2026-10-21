/**
 * One door for making things (consolidation Phase 2a): every "New …" opens
 * Create; the Wizard and the old New Dashboard picker are gone; ⌘N / Ctrl+N
 * opens Create. Source checks, like botsTabWiring.test.js.
 */
const fs = require("fs");
const path = require("path");

const read = (...p) =>
  fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const stageSrc = read("Dashboard", "DashboardStage.js");

describe("DashboardStage — one door (Phase 2a)", () => {
  it("the empty screen's New Dashboard opens Create on Dashboard, with no Wizard", () => {
    expect(stageSrc).toMatch(
      /text="New Dashboard"\s*onClick=\{\(\) => openCreate\("dashboard"\)\}/,
    );
    expect(stageSrc).not.toMatch(/Wizard/);
  });

  it("the palette's New Dashboard opens Create on Dashboard", () => {
    expect(stageSrc).toMatch(
      /onCreateNewWorkspace=\{\(\) => openCreate\("dashboard"\)\}/,
    );
  });

  it("⌘N (Mac) / Ctrl+N opens Create — not while editing, over a dialog, or in a popout", () => {
    expect(stageSrc).toMatch(
      /isMac \? e\.metaKey && !e\.ctrlKey : e\.ctrlKey && !e\.metaKey/,
    );
    expect(stageSrc).toMatch(/e\.key !== "n" && e\.key !== "N"/);
    expect(stageSrc).toMatch(/e\.repeat/);
    expect(stageSrc).toMatch(/if \(editingRef\.current\) return;/);
    expect(stageSrc).toMatch(/document\.querySelector\('\[role="dialog"\]'\)/);
    expect(stageSrc).toMatch(
      /setCreateRequest\(\(r\) => r \|\| \{ type: "auto", workspaceId: null \}\)/,
    );
    expect(stageSrc).toMatch(/if \(popout\) return undefined;/);
  });

  it("import and registry are Create's no-AI starts; there's no method picker", () => {
    expect(stageSrc).toMatch(
      /key === "import-dashboard" \? "import" : "registry"/,
    );
    expect(stageSrc).not.toMatch(/setLayoutInitialMethod\(null\)/);
  });
});

describe("Manage › Dashboards — New Dashboard opens Create", () => {
  it("is in OPENS_CREATE", () => {
    expect(read("AppPages", "AppPage.js")).toMatch(
      /OPENS_CREATE = \{\s*dashboards: "dashboard",\s*widgets: "widget",\s*bots: "bot",?\s*\}/,
    );
  });
});

describe("removed for good", () => {
  it.each([
    ["Layout", "DashboardWizard"],
    ["Layout", "LayoutManager", "Panel", "CreationMethodPicker.js"],
    ["Settings", "details", "NewDashboardChooser.js"],
    ["Bots", "TeamLeadSection.js"],
    ["Bots", "AskLead.js"],
    ["Bots", "BotEditorModal.js"],
    ["Dashboard", "WelcomePrompt.js"],
  ])("%s/%s", (...p) => {
    expect(fs.existsSync(path.join(__dirname, "..", ...p))).toBe(false);
  });
});

// Consolidation Phase 2b: a cell's Build with AI and Edit's Ask AI open
// Create for that cell (the Dash team, a preview, placed in the edit).
describe("an empty cell's AI doors open Create for that cell", () => {
  it("Build with AI on the grid", () => {
    const grid = read("Layout", "Builder", "LayoutGridContainer.js");
    expect(grid).toMatch(
      /new CustomEvent\("dash:open-create", \{\s*detail: \{\s*cell: \{\s*cellNumber,\s*gridItemId: item\.id,\s*workspaceId: workspace\?\.id,\s*scope: workspaceScope \|\| "main",/,
    );
    expect(grid).not.toMatch(/dash:open-widget-builder/);
  });
  it("Edit's Ask AI › Build a widget for this cell", () => {
    expect(stageSrc).toMatch(
      /new CustomEvent\("dash:open-create", \{\s*detail: \{\s*cell: \{\s*cellNumber: editSelection\.cellNumber,/,
    );
  });
  it("the request carries the page being edited, and Create gets the cell", () => {
    expect(stageSrc).toMatch(/activePageRef\.current = currentActivePageId;/);
    expect(stageSrc).toMatch(
      /cell=\{createRequest \? createRequest\.cell \|\| null : null\}/,
    );
  });
});

// Consolidation Phase 3: every Change with AI door opens Create › Change
// <widget> — the card menu, the Edit panel and Ask AI, the error box, the
// Widgets page — through one event DashboardStage turns into Create.
describe("Change with AI doors open Create on the widget", () => {
  it("DashboardStage opens Create with the change", () => {
    expect(stageSrc).toMatch(
      /window\.addEventListener\("dash:edit-widget-with-ai", handler\)/,
    );
    expect(stageSrc).toMatch(
      /edit=\{createRequest \? createRequest\.edit \|\| null : null\}/,
    );
  });
  it("the card menu and the Edit panel have one Change <widget>; no Ask AI tab (Phase 3P)", () => {
    const header = read("Layout", "Builder", "Enhanced", "WidgetCardHeader.js");
    expect(header).toMatch(
      /label: `Change \$\{widgetName \|\| "this widget"\}`/,
    );
    expect(header).not.toMatch(/"Change with AI"/);
    const panel = read("Dashboard", "EditPanel.js");
    expect(panel).toMatch(/title=\{`Change \$\{widgetName\}`\}/);
    expect(panel).not.toMatch(/Change this widget with AI/);
    expect(panel).not.toMatch(/value="ask"/);
    expect(panel).not.toMatch(/Opens the Widget Builder/);
  });
  it("the card and the Edit panel say where the widget is", () => {
    const grid = read("Layout", "Builder", "LayoutGridContainer.js");
    expect(grid).toMatch(
      /new CustomEvent\("dash:edit-widget-with-ai", \{[\s\S]*?scope: workspaceScope \|\| "main",/,
    );
    const builder = read("Layout", "Builder", "LayoutBuilder.js");
    expect(builder).toMatch(
      /scope: scope \|\| "main",\s*pageId: pageId \?\? null,/,
    );
  });
});
