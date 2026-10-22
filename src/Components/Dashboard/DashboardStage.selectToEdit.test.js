/**
 * Select-to-edit wiring (create-entry phase 1c, CRE-006).
 *
 *  - The editor's selection is shared through EditSelectionContext, provided
 *    around the main row so grid cells deep in the layout can read it.
 *  - Bot edits made in the editor are staged and saved with the dashboard's
 *    Save (bots first — a failed bot save stops before the dashboard is
 *    written); Cancel and re-entering edit mode discard them.
 *  - Panel actions reach the LayoutBuilder holding the widget through the
 *    `dash:edit-widget-action` window event; only the matching dashboard,
 *    and the builder holding the widget (or the visible page), acts.
 *
 * DashboardStage and LayoutBuilder are too large to mount in a unit test;
 * the behaviour of the pieces is tested in editSelection, EditPanel,
 * EditBotsRow and GridCellFrame. These pin the wiring.
 */
const fs = require("fs");
const path = require("path");

const stage = fs.readFileSync(
  path.join(__dirname, "DashboardStage.js"),
  "utf8",
);
const builder = fs.readFileSync(
  path.join(__dirname, "..", "Layout", "Builder", "LayoutBuilder.js"),
  "utf8",
);

function fnBody(src, name) {
  const m = src.match(
    new RegExp(`\\n  function ${name}\\([\\s\\S]*?\\n  \\}\\n`),
  );
  return m ? m[0] : null;
}

describe("DashboardStage — select to edit", () => {
  test("the selection is provided around the main row", () => {
    expect(stage).toMatch(
      /<DndProvider backend=\{HTML5Backend\}>\s*<EditSelectionContext\.Provider value=\{editSelectionValue\}>/,
    );
  });

  test("Save first applies a widget setting still being typed (QA 2026-10-22)", () => {
    const body = fnBody(stage, "handleClickSaveWorkspace");
    const flush = body.indexOf("panelFlushRef.current()");
    expect(flush).toBeGreaterThan(-1);
    expect(flush).toBeLessThan(body.indexOf("return saveDashboardWorkspace()"));
    expect(stage).toMatch(
      /<WidgetPanel[\s\S]{0,1200}flushRef=\{panelFlushRef\}/,
    );
  });

  test("Save writes staged bot edits before the dashboard, and stops on failure", () => {
    const body = fnBody(stage, "handleClickSaveWorkspace");
    expect(body).not.toBeNull();
    expect(body).toMatch(/Object\.entries\(pendingBotEdits\)/);
    // Each staged bot is merged over the latest copy (keepLatest) first.
    expect(body).toMatch(
      /return \{ \.\.\.latest, \.\.\.keepLatest\(form\.edited, form\.opened, latest\) \};/,
    );
    expect(body).toMatch(
      /api\.save\(await finalDefinition\(id, def\)\)[\s\S]{0,40}\)\s*\.then\(\(\) => saveDashboardWorkspace\(\)\)\s*\.catch\(/,
    );
    // The widgets' notifications / schedule wait for the dashboard to be
    // saved (Phase 3P): not taken here, so a failed save keeps them.
    expect(body).not.toMatch(/pendingSettings\.take\(\)/);
    const done = fnBody(stage, "handleSaveWorkspaceComplete");
    expect(done).toMatch(/const settings = pendingSettings\.take\(\);/);
    const failed = fnBody(stage, "handleSaveWorkspaceError");
    expect(failed).not.toMatch(/pendingSettings/);
  });

  test("Cancel discards staged bot edits", () => {
    expect(fnBody(stage, "performCancelEdit")).toMatch(
      /setPendingBotEdits\(\{\}\)/,
    );
  });

  test("the bot form in the editor stages instead of saving", () => {
    // The bot tabs (BotConfigPanel) hand each change to onStage.
    expect(stage).toMatch(
      /onStage=\{\(definition, opened\) => \{[\s\S]{0,800}setPendingBotEdits\(/,
    );
    const botEditor = stage.slice(stage.indexOf("botEditor={"));
    expect(botEditor.slice(0, 1500)).not.toMatch(/bots\.save\(/);
  });

  test("the bots row shows only while editing", () => {
    expect(stage).toMatch(/\{isEditingDashboard && \(\s*<EditBotsRow/);
  });
});

describe("LayoutBuilder — edit panel actions", () => {
  test("listens for dash:edit-widget-action", () => {
    expect(builder).toMatch(
      /window\.addEventListener\("dash:edit-widget-action", handler\)/,
    );
  });

  test("ignores other dashboards, and page-targeted actions for other pages", () => {
    expect(builder).toMatch(
      /if \(workspaceId != null && String\(ws\.id\) !== String\(workspaceId\)\) return;/,
    );
    expect(builder).toMatch(
      /if \(!uuid && targetPage != null && targetPage !== pageId\) return;/,
    );
  });

  test("a widget's settings open in its panel, at the requested section", () => {
    expect(builder).not.toMatch(/action === "configure"/);
    expect(builder).toMatch(
      /function handleClickEditItem\(newItem, initialSection = null\) \{\s*if \(!newItem \|\| !editSelection\.available\) return;/,
    );
    expect(builder).toMatch(/section: initialSection \|\| "edit",/);
    expect(builder).toMatch(/handleClickEditItem\(d, "handlers"\)/);
  });
});

const grid = fs.readFileSync(
  path.join(__dirname, "..", "Layout", "Builder", "LayoutGridContainer.js"),
  "utf8",
);

describe("phase 1d — routing into the editor", () => {
  test("an empty cell's Add widget selects the cell (the pop-up is the fallback)", () => {
    expect(grid).toMatch(
      /if \(editSelection\.available\) \{\s*return editSelection\.select\(\{\s*kind: "cell"[\s\S]{0,200}\}\s*handleClickAdd\(cellNumber\);/,
    );
  });

  test("the widget menu's Edit in panel, Change and Move select the widget", () => {
    const edit = grid.match(/function renderEditCell\([\s\S]*?\n    \}\n/)[0];
    expect(edit).toMatch(/selectWidget\("widget", section \|\| "edit"\)/);
    expect(edit).toMatch(/selectWidget\("widget"\);/);
    expect(edit).toMatch(/selectWidget\("widget", null, \{ moving: true \}\)/);
    expect(edit).not.toMatch(/selectWidget\("ask"\)/);
  });

  test("LayoutBuilder places a picked widget, only in the matching scope and page", () => {
    expect(builder).toMatch(/action === "place"/);
    expect(builder).toMatch(
      /handleDropWidgetFromSidebar\(\s*detail\.gridItemId,\s*detail\.cellNumber,\s*detail\.widgetKey,?\s*\)/,
    );
    expect(builder).toMatch(
      /const scope = useContext\(WorkspaceScopeContext\)/,
    );
  });
});

describe("phase 1e — Cancel list and keyboard move", () => {
  test("the Discard prompt lists the changes", () => {
    expect(stage).toMatch(
      /describeEditChanges\(\{\s*original: originalWorkspaceRef\.current,/,
    );
    expect(stage).toMatch(/<DiscardList changes=\{cancelChanges\} \/>/);
  });

  test("a selected widget remembers its grid and cell", () => {
    expect(grid).toMatch(
      /gridItemId: item\.id,\s*cellNumber,\s*scope: workspaceScope,\s*label: pickWidgetDisplayName/,
    );
  });

  test("while moving, choosing another cell in the same grid moves (or swaps) the widget", () => {
    expect(grid).toMatch(/const moveTarget =/);
    expect(grid).toMatch(
      /onMoveWidgetToCell\(item\.id, moving\.cellNumber, cellNumber\)/,
    );
  });

  test("the empty cell's Add widget is a real button", () => {
    expect(grid).toMatch(
      /<button\s+type="button"[\s\S]{0,900}handleClickAdd\(cellNumber\);[\s\S]{0,400}<\/button>/,
    );
  });
});

describe("LayoutBuilder — a widget action reaches only its own page and scope (Phase 3P)", () => {
  const builderSrc = fs.readFileSync(
    path.join(__dirname, "..", "Layout", "Builder", "LayoutBuilder.js"),
    "utf8",
  );
  test("scope and page are checked before acting on a uuid", () => {
    expect(builderSrc).toMatch(
      /if \(\(detail\.scope \|\| "main"\) !== scope\) return;\s*if \(\s*scope === "main" &&\s*targetPage != null &&\s*pageId != null &&\s*targetPage !== pageId\s*\)/,
    );
  });
  test("the panel's actions name the selection's scope", () => {
    expect(stage).toMatch(
      /scope:\s*\(editSelection\?\.kind === "widget" && editSelection\.scope\) \|\|\s*"main",/,
    );
  });
  test("the builder shares its page with the widgets in it", () => {
    expect(builderSrc).toMatch(
      /<LayoutPageContext\.Provider value=\{scope === "main" \? pageId : null\}>/,
    );
  });
});
