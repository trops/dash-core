/**
 * addGridRowOp
 *
 * Pure helper for `DashboardModel.addGridRow`. Inserts a new empty row
 * after the supplied row number (afterRow=0 inserts at the top). All
 * rows at or after the insertion point shift down by one. rowHeights
 * and rowModes maps shift correspondingly so that per-row sizing/mode
 * state tracks the original rows.
 *
 * Pure — input grid is never mutated.
 */

const META_KEYS = new Set([
  "rows",
  "cols",
  "gap",
  "rowHeights",
  "rowModes",
  "colWidths",
]);

function _isCellKey(key) {
  return /^\d+\.\d+$/.test(key);
}

function _shiftKeyMap(map, insertAt) {
  if (!map) return undefined;
  const shifted = {};
  for (const [key, value] of Object.entries(map)) {
    const n = Number(key);
    shifted[String(n >= insertAt ? n + 1 : n)] = value;
  }
  return Object.keys(shifted).length > 0 ? shifted : undefined;
}

export function addGridRowOp(grid, afterRow = 0) {
  if (!grid) return grid;

  const newRowNumber = afterRow + 1;
  const out = {};
  // Copy meta keys forward.
  for (const k of Object.keys(grid)) {
    if (META_KEYS.has(k)) out[k] = grid[k];
  }
  out.rows = (grid.rows || 0) + 1;
  out.cols = grid.cols;

  // Walk every cell. Cells at row >= insertion point shift down by 1.
  for (const k of Object.keys(grid)) {
    if (!_isCellKey(k)) continue;
    const [r, c] = k.split(".").map(Number);
    const newRow = r >= newRowNumber ? r + 1 : r;
    out[`${newRow}.${c}`] = grid[k];
  }

  // Insert empty cells in the new row.
  const cols = grid.cols || 0;
  for (let c = 1; c <= cols; c++) {
    out[`${newRowNumber}.${c}`] = { component: null, hide: false };
  }

  // Shift rowHeights / rowModes keys to track original rows.
  const newRowHeights = _shiftKeyMap(grid.rowHeights, newRowNumber);
  if (newRowHeights) out.rowHeights = newRowHeights;
  else delete out.rowHeights;

  const newRowModes = _shiftKeyMap(grid.rowModes, newRowNumber);
  if (newRowModes) out.rowModes = newRowModes;
  else delete out.rowModes;

  return out;
}
