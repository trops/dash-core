/**
 * Widgets stay mounted across view ↔ edit (create-entry phase 1c).
 *
 * Three things rebuilt every widget on a mode switch:
 *  1. layout.js put the mode into each grid's React key
 *     (`grid-container-<uuid>-view` / `-edit`), forcing a full remount.
 *  2. LayoutGridContainer drew a different element tree around the grid in
 *     each mode (LayoutContainer + gutters vs a bare grid div).
 *  3. Cells drew the widget bare in view mode and inside a card in edit
 *     mode — and the view-mode popout wrapper was a component declared
 *     inside the render function, so a new type every render.
 *
 * Now the keys are mode-free, the grid keeps one skeleton (edit-only
 * wrappers become `display: contents` in view mode, so view layout is
 * unchanged), and occupied cells use GridCellFrame in both modes.
 *
 * The behaviour of the frame is tested in GridCellFrame.test.js; these pin
 * the wiring in the large render paths.
 */
const fs = require("fs");
const path = require("path");

const grid = fs.readFileSync(
  path.join(__dirname, "LayoutGridContainer.js"),
  "utf8",
);
// Commented-out JSX ({/* … */}) isn't rendered — ignore it.
const builder = fs
  .readFileSync(path.join(__dirname, "LayoutBuilder.js"), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const dragEdit = fs.readFileSync(
  path.join(__dirname, "LayoutDragBuilderEdit.js"),
  "utf8",
);
const layout = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "utils", "layout.js"),
  "utf8",
);

describe("stable widgets across view ↔ edit", () => {
  test("LayoutBuilder renders ONE builder for both modes, in one slot", () => {
    // View used LayoutDragBuilder (with its own nested DndProvider) and edit
    // used LayoutDragBuilderEdit — different components, so every widget was
    // rebuilt on a mode switch.
    expect(builder).not.toMatch(/<LayoutDragBuilder\b/);
    expect((builder.match(/<LayoutDragBuilderEdit\b/g) || []).length).toBe(1);
    expect(builder).toMatch(
      /<LayoutDragBuilderEdit[\s\S]*?previewMode=\{preview\}[\s\S]*?onWidgetPopout=\{onWidgetPopout\}/,
    );
  });

  test("the single builder passes the popout handler through to the layout", () => {
    expect(dragEdit).toMatch(/onWidgetPopout = null/);
    expect(dragEdit).toMatch(
      /renderLayout\(\{[\s\S]*onWidgetPopout,[\s\S]*\}\)/,
    );
  });

  test("layout.js keys no longer include the mode", () => {
    expect(layout).not.toMatch(/previewMode === true \? "view" : "edit"/);
  });

  test("no component is declared inside LayoutGridContainer's render", () => {
    expect(grid).not.toMatch(/\n    function PopoutOverlay\(/);
  });

  test("occupied cells use GridCellFrame in both view and edit", () => {
    const view = grid.match(/function renderCellComponent\([\s\S]*?\n    \}\n/);
    const edit = grid.match(/function renderEditCell\([\s\S]*?\n    \}\n/);
    expect(view).not.toBeNull();
    expect(edit).not.toBeNull();
    expect(view[0]).toMatch(/<GridCellFrame/);
    expect(edit[0]).toMatch(/<GridCellFrame/);
  });

  test("grid mode renders one skeleton for both modes", () => {
    // One `return useGridLayout ? (` branch for both modes instead of
    // separate `preview === false && useGridLayout` and preview branches.
    expect(grid).not.toMatch(/return preview === false && useGridLayout \?/);
    expect(grid).toMatch(/return useGridLayout \?/);
  });
});

describe("an empty cell outside edit mode", () => {
  test("shows no cell number (QA 2026-10-22: a stray '1.1')", () => {
    const body = grid.match(
      /function renderPreviewEmptyCell\(cellNumber\) \{[\s\S]*?\n {4}\}\n/,
    );
    expect(body).not.toBeNull();
    expect(body[0]).not.toMatch(/>\{cellNumber\}</);
  });
});
