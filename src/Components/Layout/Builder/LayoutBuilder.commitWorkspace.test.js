/**
 * Every layout edit must reach the dashboard (phase 1a).
 *
 * Bug: adding a widget, split, merge, add/delete row or column, row/column
 * sizing, drop, direction, order and widget-for-cell updated only
 * LayoutBuilder's local state. DashboardStage never heard about them, so the
 * dashboard wasn't marked dirty (Cancel and the close guard missed them) and
 * the next re-render from the parent could revert them.
 *
 * Fix: one helper, commitWorkspace, sets local state AND tells the parent.
 * The only other setCurrentWorkspace calls left are the effect that syncs
 * from the `workspace` prop (a load, not an edit — it must not mark dirty).
 *
 * Source pins, like the other LayoutBuilder tests.
 */
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "LayoutBuilder.js"),
  "utf8",
);

describe("LayoutBuilder — commitWorkspace", () => {
  test("commitWorkspace sets local state and tells the parent", () => {
    const m = source.match(/function commitWorkspace\([\s\S]*?\n  \}\n/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/setCurrentWorkspace\(/);
    expect(m[0]).toMatch(/onWorkspaceChangeRef\.current\(/);
  });

  test("edits go through commitWorkspace — setCurrentWorkspace stays only in the prop-sync effect and the helper", () => {
    const syncEnd = source.indexOf("}, [workspace]);");
    expect(syncEnd).toBeGreaterThan(-1);
    const helper = source.match(
      /function commitWorkspace\([\s\S]*?\n  \}\n/,
    )[0];
    const rest = source.slice(syncEnd).replace(helper, "");
    expect(rest).not.toMatch(/setCurrentWorkspace\(/);
  });

  test.each([
    "handleClickConfirmAdd",
    "handleSplitCell",
    "handleMergeCells",
    "handleAddGridRow",
    "handleDeleteGridRow",
    "handleAddGridColumn",
    "handleDeleteGridColumn",
    "handleChangeRowHeight",
    "handleChangeRowMode",
    "handleChangeRowSizing",
    "handleChangeColMode",
  ])("%s commits its change", (name) => {
    const m = source.match(
      new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}\\n`),
    );
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/commitWorkspace\(/);
  });
});
