/**
 * Edit-mode staging (create-entry CRE-006 AC6 / phase 1a).
 *
 * Bugs pinned here:
 *  - Folder, theme and Scrollable changes never marked the dashboard dirty,
 *    so Cancel and the close/navigation guards could silently drop them.
 *  - Main-grid edits arrive through handlePageWorkspaceChange, which never
 *    marked the dashboard dirty either.
 *  - Provider picks, Dashboard Config bulk edits and grid ↔ pinned-sidebar
 *    moves saved the whole dashboard immediately — committing every other
 *    unsaved edit even if the user then pressed Cancel.
 *
 * While editing, each of these now stages the change (stageWorkspaceEdit:
 * tab state + Save's layout refs + dirty) and waits for Save. Outside edit
 * mode the one-off saves still persist straight away.
 *
 * DashboardStage is too large to mount in a unit test, so — like the other
 * DashboardStage pins — these check the source.
 */
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "DashboardStage.js"),
  "utf8",
);

/** The body of `function name(...) { ... }` (top-level, 2-space indent). */
function fnBody(name) {
  const m = source.match(
    new RegExp(`\\n  function ${name}\\([\\s\\S]*?\\n  \\}\\n`),
  );
  return m ? m[0] : null;
}

describe("DashboardStage — edits wait for Save", () => {
  test("stageWorkspaceEdit updates the tab, Save's refs and the dirty flag", () => {
    const body = fnBody("stageWorkspaceEdit");
    expect(body).not.toBeNull();
    expect(body).toMatch(/updateTabWorkspace\(/);
    expect(body).toMatch(/syncLayoutRefs\(/);
    expect(body).toMatch(/setIsDirty\(true\)/);
  });

  test.each([
    "handleWorkspaceFolderChange",
    "handleWorkspaceThemeChange",
    "handleScrollableChange",
  ])("%s marks the dashboard dirty", (name) => {
    expect(fnBody(name)).toMatch(/setIsDirty\(true\)/);
  });

  test("main-grid edits (handlePageWorkspaceChange) mark the dashboard dirty while editing", () => {
    const m = source.match(
      /handlePageWorkspaceChange\s*=\s*useCallback\(\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[/,
    );
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(
      /if\s*\(\s*!previewModeRef\.current\s*\)\s*setIsDirty\(true\)/,
    );
  });

  test.each([
    "handleProviderSelect",
    "handleBulkProviderBindings",
    "handleBulkUserPrefs",
    "handleBulkListenerBindings",
  ])("%s stages instead of saving while editing", (name) => {
    const body = fnBody(name);
    expect(body).not.toBeNull();
    // The staging branch comes before (and returns ahead of) the save.
    const stage = body.search(
      /if\s*\(\s*!previewModeRef\.current\s*\)\s*\{\s*stageWorkspaceEdit\(\s*reconciled\s*\);\s*return;\s*\}/,
    );
    const save = body.indexOf("dashApi.saveWorkspace(");
    expect(stage).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(stage);
  });

  test("grid ↔ pinned-sidebar moves stage instead of saving", () => {
    const start = source.indexOf(
      'window.addEventListener("dash:cross-container-widget-move"',
    );
    expect(start).toBeGreaterThan(-1);
    const handler = source.slice(
      source.lastIndexOf("const handler", start),
      start,
    );
    expect(handler).toMatch(/stageWorkspaceEdit\(\s*reconciled\s*\)/);
    expect(handler).not.toMatch(/dashApi\.saveWorkspace\(/);
  });

  test("previewModeRef tracks previewMode for callbacks with stale closures", () => {
    expect(source).toMatch(
      /const previewModeRef = useRef\(previewMode\);\s*previewModeRef\.current = previewMode;/,
    );
  });
});
