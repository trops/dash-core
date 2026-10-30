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
  // Lead-workspace release 3c (frame 13): making something starts a new
  // Dash Lead conversation.
  it("the empty screen's New Dashboard starts a Dash Lead conversation, with no Wizard", () => {
    expect(stageSrc).toMatch(/text="New Dashboard"\s*onClick=\{openDashLead\}/);
    expect(stageSrc).toMatch(
      /function openDashLead\(\) \{[\s\S]{0,120}setWorkspaceRequest\(\{ key: "role:dashlead"/,
    );
    expect(stageSrc).not.toMatch(/Wizard/);
  });

  it("the palette's New Dashboard starts a Dash Lead conversation", () => {
    expect(stageSrc).toMatch(/onCreateNewWorkspace=\{openDashLead\}/);
  });

  it("⌘N (Mac) / Ctrl+N starts a Dash Lead conversation — not while editing, over a dialog, or in a popout", () => {
    expect(stageSrc).toMatch(
      /isMac \? e\.metaKey && !e\.ctrlKey : e\.ctrlKey && !e\.metaKey/,
    );
    expect(stageSrc).toMatch(/e\.key !== "n" && e\.key !== "N"/);
    expect(stageSrc).toMatch(/e\.repeat/);
    expect(stageSrc).toMatch(/if \(editingRef\.current\) return;/);
    expect(stageSrc).toMatch(/document\.querySelector\('\[role="dialog"\]'\)/);
    expect(stageSrc).toMatch(
      /setWorkspaceRequest\(\s*\(r\) => r \|\| \{ key: "role:dashlead", seq: Date\.now\(\) \},?\s*\)/,
    );
    expect(stageSrc).toMatch(/if \(popout\) return undefined;/);
  });

  it("a dashboard file is Start from's no-AI start (6c); there's no method picker", () => {
    expect(stageSrc).toMatch(/setLayoutInitialMethod\("import"\);/);
    expect(stageSrc).not.toMatch(/setLayoutInitialMethod\(null\)/);
  });
});

// Lead-workspace release 6c (frame 41): a page's New opens a Dash Lead
// conversation about making one.
describe("Manage › Dashboards — New Dashboard opens a Dash Lead conversation", () => {
  it("is in OPENS_WORKSPACE", () => {
    const src = read("AppPages", "AppPage.js");
    expect(src).toMatch(
      /OPENS_WORKSPACE = \{\s*dashboards: "dashboard",\s*widgets: "widget",\s*bots: "bot",?\s*\}/,
    );
    expect(src).not.toMatch(/dash:open-create/);
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

// Lead-workspace release 6c-2: a cell's Build with AI, on the grid and in
// the Edit panel, opens a conversation with its dashboard's lead.
describe("an empty cell's AI doors open its lead's conversation (lead-workspace 6c)", () => {
  it("Build with AI on the grid", () => {
    const grid = read("Layout", "Builder", "LayoutGridContainer.js");
    expect(grid).toMatch(
      /new CustomEvent\("dash:open-workspace", \{\s*detail: \{\s*cell: \{\s*cellNumber,\s*gridItemId: item\.id,\s*workspaceId: workspace\?\.id,\s*scope: workspaceScope \|\| "main",/,
    );
    expect(grid).not.toMatch(/dash:open-create/);
    expect(grid).not.toMatch(/dash:open-widget-builder/);
  });
  it("Edit's Ask AI › Build a widget for this cell", () => {
    expect(stageSrc).toMatch(
      /new CustomEvent\("dash:open-workspace", \{\s*detail: \{\s*cell: \{\s*cellNumber: editSelection\.cellNumber,/,
    );
  });
  it("the request carries the page being edited, and no Dash Lead key (its lead is found)", () => {
    expect(stageSrc).toMatch(/activePageRef\.current = currentActivePageId;/);
    expect(stageSrc).toMatch(
      /d\.key \|\| \(d\.cell \? null : "role:dashlead"\)/,
    );
    expect(stageSrc).toMatch(
      /cell:\s*d\.cell && d\.cell\.gridItemId != null && d\.cell\.cellNumber/,
    );
  });
});

// Lead-workspace release 6c-3: every Change with AI door — the card menu,
// the Edit panel and Ask AI, the error box, the Widgets page — opens a
// conversation about that widget, through one event.
describe("Change with AI doors open a conversation about the widget", () => {
  it("DashboardStage opens the workspace with the widget, no lead key (its dashboard's lead is found)", () => {
    expect(stageSrc).toMatch(
      /window\.addEventListener\("dash:edit-widget-with-ai", handler\)/,
    );
    expect(stageSrc).toMatch(
      /setWorkspaceRequest\(\{\s*key: null,\s*seq: Date\.now\(\),\s*widget: \{\s*component: String\(d\.widgetComponentName\),/,
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
