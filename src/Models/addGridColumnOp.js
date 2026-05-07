/**
 * addGridColumnOp
 *
 * Pure helper for `DashboardModel.addGridColumn`. Symmetric to
 * `addGridRowOp` but for columns. Inserts an empty column after the
 * supplied column number (afterCol=0 inserts at the left edge).
 * colModes shifts to track its original columns. (Original code
 * doesn't track colWidths, so we don't either; can be added later.)
 */

const META_KEYS = new Set([
  "rows",
  "cols",
  "gap",
  "rowHeights",
  "rowModes",
  "colModes",
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

export function addGridColumnOp(grid, afterCol = 0) {
  if (!grid) return grid;

  const newColNumber = afterCol + 1;
  const out = {};
  for (const k of Object.keys(grid)) {
    if (META_KEYS.has(k)) out[k] = grid[k];
  }
  out.cols = (grid.cols || 0) + 1;
  out.rows = grid.rows;

  for (const k of Object.keys(grid)) {
    if (!_isCellKey(k)) continue;
    const [r, c] = k.split(".").map(Number);
    const newCol = c >= newColNumber ? c + 1 : c;
    out[`${r}.${newCol}`] = grid[k];
  }

  const rows = grid.rows || 0;
  for (let r = 1; r <= rows; r++) {
    out[`${r}.${newColNumber}`] = { component: null, hide: false };
  }

  const newColModes = _shiftKeyMap(grid.colModes, newColNumber);
  if (newColModes) out.colModes = newColModes;
  else delete out.colModes;

  return out;
}
