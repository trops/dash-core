/**
 * deleteGridRowOp
 *
 * Pure helper for `DashboardModel.deleteGridRow`. Removes the row at
 * `rowNumber`, shifts everything below up by one, and **returns the
 * list of widget component ids that lived on the deleted row** so the
 * caller can remove them from the layout (or surface them to a
 * confirm-before-delete UX in the future).
 *
 * Refuses to delete the only remaining row (returns the input grid
 * unchanged + empty orphans list — same fail-safe the model had).
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

export function deleteGridRowOp(grid, rowNumber) {
  if (!grid) return { grid, orphanedComponents: [] };

  if ((grid.rows || 0) <= 1) {
    // Can't delete the only row — fail-safe no-op.
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

    if (r === rowNumber) {
      // Cell is in the row being deleted — collect its component (if
      // any) as an orphan, drop the cell entirely.
      const comp = grid[k] && grid[k].component;
      if (comp != null) orphanedComponents.push(comp);
      continue;
    }

    if (r > rowNumber) {
      // Cells below the deleted row shift up by one.
      out[`${r - 1}.${c}`] = grid[k];
    } else {
      // Cells above the deleted row are unchanged.
      out[k] = grid[k];
    }
  }

  out.rows = (grid.rows || 0) - 1;
  out.cols = grid.cols;

  const newRowHeights = _shiftKeyMapDown(grid.rowHeights, rowNumber);
  if (newRowHeights) out.rowHeights = newRowHeights;
  else delete out.rowHeights;

  const newRowModes = _shiftKeyMapDown(grid.rowModes, rowNumber);
  if (newRowModes) out.rowModes = newRowModes;
  else delete out.rowModes;

  return { grid: out, orphanedComponents };
}
