/**
 * cellPlacement.js — whether a widget can go into a grid cell the user is
 * editing (lead-workspace release 6c: an empty cell's conversation). A cell
 * is only ever filled while it's empty, so trying again never replaces a
 * widget. Pure.
 *
 * @returns {null | "gone" | "taken"} null: it can go in; "gone": no such
 *   grid or cell; "taken": the cell has a widget (or another cell covers it)
 */
export function cellProblem(layout, gridItemId, cellNumber) {
  const grid = (Array.isArray(layout) ? layout : []).find(
    (item) => item && item.id === gridItemId,
  );
  if (!grid || !grid.grid) return "gone";
  const [row, col] = String(cellNumber || "")
    .split(".")
    .map((n) => Number(n));
  const rows = Number(grid.grid.rows) || 0;
  const cols = Number(grid.grid.cols) || 0;
  if (!row || !col || row > rows || col > cols) return "gone";
  const cell = grid.grid[cellNumber];
  if (cell && (cell.component != null || cell.hide)) return "taken";
  return null;
}

export default cellProblem;
