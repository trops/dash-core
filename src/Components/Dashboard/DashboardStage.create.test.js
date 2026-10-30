/**
 * Create screen wiring (create-entry PRD CRE-001 / CRE-008, phase 2a).
 *
 * The left rail's + and the palette's "Create…" open a Dash Lead
 * conversation; the Create window is gone (lead-workspace release 6c). Its
 * no-AI starts left are handled here (the conversation's Start from sends
 * them): a blank dashboard opens in Edit, and a dashboard file opens the New
 * Dashboard modal on its import step.
 *
 * DashboardStage is too large to mount in a unit test; like its other pins
 * these check the source.
 */
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "DashboardStage.js"),
  "utf8",
);

describe("DashboardStage — Create screen", () => {
  // Lead-workspace release 3c (frame 13): a new Dash Lead conversation.
  test("the rail's + starts a Dash Lead conversation (not the New Dashboard modal)", () => {
    expect(source).toMatch(/onNewDashboard=\{openDashLead\}/);
  });

  test("the palette's Create… starts a Dash Lead conversation", () => {
    expect(source).toMatch(/onCreate=\{openDashLead\}/);
  });

  test("there's no Create window, nor a door to it (lead-workspace 6c)", () => {
    expect(source).not.toMatch(/CreateModal/);
    expect(source).not.toMatch(/dash:open-create/);
    expect(source).not.toMatch(/createRequest/);
  });

  test("a door's words reach the conversation's reply box; Start from's no-AI starts come here", () => {
    expect(source).toMatch(
      /draft: typeof d\.draft === "string" \? d\.draft\.slice\(0, 4000\) : "",/,
    );
    expect(source).toMatch(
      /onStartWithoutAi=\{\(k\) => \{\s*setWorkspaceRequest\(null\);\s*handleStartWithoutAi\(k\);/,
    );
  });

  test("Go to dashboard opens a built one (4e-2)", () => {
    expect(source).toMatch(
      /window\.addEventListener\("dash:open-built-dashboard", onOpenBuilt\)/,
    );
    expect(source).toMatch(
      /handleOpenBuiltRef\.current = handleOpenBuiltDashboard;/,
    );
  });

  test("a blank dashboard is created from the single-panel template and named", () => {
    expect(source).toMatch(
      /createLayoutFromTemplate\(layoutTemplates\[0\], menuId\),\s*themeKey \|\| null,[\s\S]{0,120}?untitledDashboardName\(workspaceConfig\),/,
    );
  });

  // Found live (Phase 2b): Cancel kept a cell's widget on a new dashboard.
  test("a new dashboard opens in Edit with a snapshot, so Cancel can undo", () => {
    const body = source.slice(
      source.indexOf("async function handleCreateFromTemplate("),
      source.indexOf("function loadWorkspaces()"),
    );
    expect(body).toMatch(
      /originalWorkspaceRef\.current = deepCopy\(newWorkspace\);[\s\S]*setIsDirty\(false\);[\s\S]*setPreviewMode\(false\);/,
    );
  });

  test("Start from's dashboard file opens the New Dashboard modal on its import step (6c)", () => {
    expect(source).toMatch(
      /key === "import-dashboard"\) \{\s*setLayoutInitialMethod\("import"\);\s*setIsLayoutPickerOpen\(true\);/,
    );
    expect(source).toMatch(/initialMethod=\{layoutInitialMethod\}/);
  });

  test("only the starts something still sends are handled (6c)", () => {
    expect(source).not.toMatch(/WIDGET_INSTALL_ACTIONS/);
    expect(source).not.toMatch(/themeStartInCreate/);
    expect(source).not.toMatch(/"widget-by-hand"/);
  });

  // The theme editor can still take a theme made elsewhere (the Create
  // window that made one is gone — lead-workspace 6c; kept for the theme
  // round).
  test("the theme editor can open on a theme it's handed, unsaved", () => {
    expect(source).toMatch(/initialTheme=\{themeInitial\}/);
    const modal = require("fs").readFileSync(
      require("path").join(__dirname, "..", "Theme", "ThemeManagerModal.js"),
      "utf8",
    );
    expect(modal).toMatch(
      /setSelectedMethod\("ai"\);[\s\S]{0,120}setWizardTheme\(initialTheme\);/,
    );
    expect(modal).toMatch(
      /seedTheme=\{\s*selectedMethod === "ai" \? initialTheme : null\s*\}/,
    );
  });
});
