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

  test("Save writes staged bot edits before the dashboard, and stops on failure", () => {
    const body = fnBody(stage, "handleClickSaveWorkspace");
    expect(body).not.toBeNull();
    expect(body).toMatch(/Object\.values\(pendingBotEdits\)/);
    expect(body).toMatch(
      /Promise\.all\(staged\.map\(\(def\) => window\.mainApi\.bots\.save\(def\)\)\)\s*\.then\(\(\) => saveDashboardWorkspace\(\)\)\s*\.catch\(/,
    );
  });

  test("Cancel discards staged bot edits", () => {
    expect(fnBody(stage, "performCancelEdit")).toMatch(
      /setPendingBotEdits\(\{\}\)/,
    );
  });

  test("the bot form in the editor stages instead of saving", () => {
    expect(stage).toMatch(
      /onSave=\{async \(definition\) => \{[\s\S]{0,200}setPendingBotEdits\(/,
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

  test("opens Configure at the requested section", () => {
    expect(builder).toMatch(/handleClickEditItem\(item, section \|\| null\)/);
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

  test("the widget menu's Configure and Edit with AI also select the widget", () => {
    const edit = grid.match(/function renderEditCell\([\s\S]*?\n    \}\n/)[0];
    expect(edit).toMatch(/selectWidget\(\)[\s\S]{0,80}onOpenConfig/);
    expect(edit).toMatch(/selectWidget\("ask"\)/);
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
