/**
 * deleteGridColumnOp
 *
 * Pure helper for `DashboardModel.deleteGridColumn`. Symmetric to
 * `deleteGridRowOp` — removes the column at `colNumber`, shifts
 * everything to the right left by one, returns orphaned widget ids.
 *
 * Refuses to delete the only remaining column (returns input grid
 * unchanged + empty orphans list).
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

function _shiftKeyMapDown(map, deletedAt) {
  if (!map) return undefined;
  const shifted = {};
  for (const [key, value] of Object.entries(map)) {
    const n = Number(key);
    if (n === deletedAt) continue;
    shifted[String(n > deletedAt ? n - 1 : n)] = value;
  }
  return Object.keys(shifted).length > 0 ? shifted : undefined;
}

export function deleteGridColumnOp(grid, colNumber) {
  if (!grid) return { grid, orphanedComponents: [] };

  if ((grid.cols || 0) <= 1) {
    return { grid, orphanedComponents: [] };
  }

  const out = {};
  const orphanedComponents = [];

  for (const k of Object.keys(grid)) {
    if (META_KEYS.has(k)) {
      out[k] = grid[k];
      continue;
    }
    if (!_isCellKey(k)) continue;

    const [r, c] = k.split(".").map(Number);

    if (c === colNumber) {
      const comp = grid[k] && grid[k].component;
      if (comp != null) orphanedComponents.push(comp);
      continue;
    }

    if (c > colNumber) {
      out[`${r}.${c - 1}`] = grid[k];
    } else {
      out[k] = grid[k];
    }
  }

  out.cols = (grid.cols || 0) - 1;
  out.rows = grid.rows;

  const newColModes = _shiftKeyMapDown(grid.colModes, colNumber);
  if (newColModes) out.colModes = newColModes;
  else delete out.colModes;

  return { grid: out, orphanedComponents };
}
