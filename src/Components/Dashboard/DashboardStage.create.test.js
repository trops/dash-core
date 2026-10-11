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
      /setCreateRequest\(\{\s*type: d\.type \|\| "widget",\s*workspaceId: d\.workspaceId \?\? null,\s*\}\)/,
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
});
