/**
 * Create screen wiring (create-entry PRD CRE-001 / CRE-008, phase 2a).
 *
 * The left rail's + and the palette's "Create…" open the Create screen;
 * anything else can open it with `dash:open-create` ({ type, workspaceId }).
 * Its start-without-AI row is handled here: a blank dashboard opens in Edit,
 * Import / Browse open the New Dashboard modal on that step, New theme opens
 * the theme chooser, and widget installs open the Widgets page.
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
  test("the rail's + opens Create (not the New Dashboard modal)", () => {
    expect(source).toMatch(/onNewDashboard=\{\(\) => openCreate\(\)\}/);
  });

  test("the palette's Create… opens Create", () => {
    expect(source).toMatch(/onCreate=\{\(\) => openCreate\(\)\}/);
  });

  test("dash:open-create opens it on the requested type and dashboard", () => {
    expect(source).toMatch(
      /window\.addEventListener\("dash:open-create", handler\)/,
    );
    expect(source).toMatch(
      /setCreateRequest\(\{\s*type: cell \? "widget" : d\.type \|\| "auto",\s*workspaceId: cell \? cell\.workspaceId : \(d\.workspaceId \?\? null\),\s*recentId: d\.recentId \|\| null,\s*seed: d\.seed \|\| null,\s*cell,[\s\S]{0,80}prompt: typeof d\.prompt === "string" \? d\.prompt : "",[\s\S]{0,120}context:\s*d\.context && typeof d\.context === "object" \? d\.context : null,\s*\}\)/,
    );
  });

  test("dash:open-create can fill in what to ask (2c)", () => {
    expect(source).toMatch(
      /initialPrompt=\{createRequest \? createRequest\.prompt \|\| "" : ""\}/,
    );
    expect(source).toMatch(
      /initialContext=\{\s*createRequest \? createRequest\.context \|\| null : null\s*\}/,
    );
  });

  test("Expand from the dock opens Create on a plan; Go to dashboard opens a built one (4e-2)", () => {
    expect(source).toMatch(
      /initialRecentId=\{createRequest \? createRequest\.recentId : null\}/,
    );
    expect(source).toMatch(
      /window\.addEventListener\("dash:open-built-dashboard", onOpenBuilt\)/,
    );
    expect(source).toMatch(
      /handleOpenBuiltRef\.current = handleOpenBuiltDashboard;/,
    );
  });

  test("CreateModal is mounted with the no-AI and bot handlers", () => {
    expect(source).toMatch(/<CreateModal\s+open=\{!!createRequest\}/);
    expect(source).toMatch(/onStartWithoutAi=\{handleStartWithoutAi\}/);
    expect(source).toMatch(/onBotCreated=\{handleBotCreated\}/);
    expect(source).toMatch(
      /onOpenAiSettings=\{\(\) => openAppSettings\("ai-assistant"\)\}/,
    );
  });

  test("a blank dashboard is created from the single-panel template and named", () => {
    expect(source).toMatch(
      /createLayoutFromTemplate\(layoutTemplates\[0\], menuId\),\s*themeKey \|\| null,\s*"Untitled dashboard",/,
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

  test("Import / Browse open the New Dashboard modal on that step", () => {
    expect(source).toMatch(
      /setLayoutInitialMethod\(\s*key === "import-dashboard" \? "import" : "registry",?\s*\)/,
    );
    expect(source).toMatch(/initialMethod=\{layoutInitialMethod\}/);
  });

  test("New theme opens the theme manager in its chooser", () => {
    expect(source).toMatch(/startInCreate=\{themeStartInCreate\}/);
  });

  test("widget installs open the Widgets page with an install link", () => {
    expect(source).toMatch(
      /handleOpenPageGuarded\("widgets", \{\s*widgetLink: \{ action: WIDGET_INSTALL_ACTIONS\[key\], nonce: Date\.now\(\) \},/,
    );
    expect(source).toMatch(/widgetLink=\{widgetLink\}/);
  });

  test("All drafts, and a widget Create just built, open the Widgets page (2c-2, 3b)", () => {
    expect(source).toMatch(
      /key === "widget-drafts" \|\| key === "open-widgets"\) \{[\s\S]{0,200}handleOpenPageGuarded\("widgets"\);/,
    );
  });

  test("Build it by hand opens the Widget Builder (3b)", () => {
    expect(source).toMatch(
      /key === "widget-by-hand"\) \{[\s\S]{0,120}new CustomEvent\("dash:open-widget-builder"\)/,
    );
  });

  test("Type: Theme hands its theme to the theme editor, unsaved; Auto by default (5c)", () => {
    expect(source).toMatch(/initialTheme=\{themeInitial\}/);
    expect(source).toMatch(
      /onOpenTheme=\{\(theme\) => \{[\s\S]{0,200}setThemeInitial\(theme\);[\s\S]{0,60}setIsThemeManagerOpen\(true\);/,
    );
    expect(source).toMatch(
      /function openCreate\(type = "auto", workspaceId = null\)/,
    );
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
