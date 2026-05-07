/**
 * gridMergeOps
 *
 * Pure helpers for merging adjacent grid cells in the layout editor.
 *
 * Bug history: pre-extraction, the inline implementations in
 * GridEditor blindly `delete`d the absorbed cell. When the user
 * merged an empty cell into a cell that already contained a widget,
 * the widget's component reference vanished with the deleted entry.
 * These helpers preserve the absorbed cell's component when the
 * current cell is empty — so a merge always shows the merged cell
 * with whichever widget existed.
 *
 * Conflict policy when BOTH cells have widgets: current wins (matches
 * the pre-fix semantics; surfaces no surprise behavior change). The
 * MergeCellsModal flow handles explicit conflict resolution for
 * multi-cell selections — that's a separate code path.
 */

const META_KEYS = new Set(["rows", "cols", "gap"]);

/**
 * Merge `(row, col)` with the cell to its right. Skips empty
 * column slots if the immediate next col was already absorbed by a
 * prior merge. Preserves the absorbed cell's `component` and `hide`
 * when the current cell has no component.
 */
export function mergeRightOp(grid, row, col) {
  const currentKey = `${row}.${col}`;
  const current = grid[currentKey];
  if (!current) return grid;

  // Find the next existing cell to the right in the same row.
  let nextKey = `${row}.${col + 1}`;
  if (!grid[nextKey]) {
    let bestCol = Infinity;
    for (const k of Object.keys(grid)) {
      if (META_KEYS.has(k)) continue;
      const [r, c] = k.split(".").map((n) => parseInt(n, 10));
      if (r === parseInt(row, 10) && c > parseInt(col, 10) && c < bestCol) {
        bestCol = c;
        nextKey = k;
      }
    }
    if (!grid[nextKey]) return grid;
  }

  const next = grid[nextKey];
  if (!next) return grid;

  const newGrid = { ...grid };
  newGrid[currentKey] = {
    ...current,
    colSpan: (current.colSpan || 1) + 1,
    // Migrate component (and hide) from absorbed cell when current
    // is empty. Without this, mergeRight on (empty, widget) silently
    // destroys the widget — the bug we're fixing.
    component: current.component != null ? current.component : next.component,
    hide: current.component != null ? current.hide : next.hide,
  };
  delete newGrid[nextKey];
  return newGrid;
}

/**
 * Merge `(row, col)` with the cell directly below. Same widget-
 * preservation semantics as mergeRightOp.
 */
export function mergeDownOp(grid, row, col) {
  const currentKey = `${row}.${col}`;
  const current = grid[currentKey];
  if (!current) return grid;

  const belowKey = `${row + 1}.${col}`;
  const below = grid[belowKey];
  if (!below) return grid;

  const newGrid = { ...grid };
  newGrid[currentKey] = {
    ...current,
    rowSpan: (current.rowSpan || 1) + 1,
    component: current.component != null ? current.component : below.component,
    hide: current.component != null ? current.hide : below.hide,
  };
  delete newGrid[belowKey];
  return newGrid;
}
