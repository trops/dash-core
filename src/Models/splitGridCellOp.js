/**
 * splitGridCellOp
 *
 * Pure helper for `DashboardModel.splitGridCell`. Splits a single
 * cell horizontally or vertically into `count` sub-cells.
 *
 * Two regimes (preserving original DashboardModel semantics):
 *
 *   CASE A — divisible span: when the target cell already has a span
 *     in the split direction that's divisible by count, simply
 *     subdivide the span into count pieces. No grid resolution change.
 *
 *   CASE B — non-divisible span (typical for an unspanned cell with
 *     count=2): multiply the entire grid's resolution in the split
 *     direction by count, reposition every visible cell to its
 *     equivalent location, and place the count sub-cells at the
 *     scaled target position.
 *
 * In both regimes the widget on the original target cell ends up on
 * the FIRST sub-cell. The other sub-cells are empty.
 *
 * Pure — input grid is never mutated.
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

function _cloneShallow(grid) {
  const out = {};
  for (const k of Object.keys(grid)) {
    if (META_KEYS.has(k)) {
      out[k] = grid[k];
    } else if (_isCellKey(k)) {
      const cell = grid[k];
      out[k] = { ...cell };
      if (cell.span) out[k].span = { ...cell.span };
    }
  }
  return out;
}

function _stripSpan(span, removeKey) {
  if (!span) return undefined;
  const out = { ...span };
  delete out[removeKey];
  return Object.keys(out).length > 0 ? out : undefined;
}

function _splitCaseADivisibleSpan(grid, row, col, direction, count) {
  // direction: "horizontal" splits col span; "vertical" splits row span.
  const isHorizontal = direction === "horizontal";
  const targetCell = grid[`${row}.${col}`];
  const targetSpanCol = targetCell.span?.col || 1;
  const targetSpanRow = targetCell.span?.row || 1;
  const splitSpan = isHorizontal ? targetSpanCol : targetSpanRow;
  const otherSpan = isHorizontal ? targetSpanRow : targetSpanCol;
  const subSpan = splitSpan / count;
  const component = targetCell.component;

  const out = _cloneShallow(grid);

  // Unhide cells previously covered by the old span.
  for (let sr = row; sr < row + targetSpanRow; sr++) {
    for (let sc = col; sc < col + targetSpanCol; sc++) {
      const k = `${sr}.${sc}`;
      if (out[k]) out[k] = { ...out[k], hide: false };
    }
  }

  // Drop the old span on the target.
  if (out[`${row}.${col}`].span) {
    delete out[`${row}.${col}`].span;
  }

  // Create the count sub-cells.
  for (let i = 0; i < count; i++) {
    const subRow = isHorizontal ? row : row + i * subSpan;
    const subCol = isHorizontal ? col + i * subSpan : col;
    const key = `${subRow}.${subCol}`;
    const sub = {
      component: i === 0 ? component : null,
      hide: false,
    };
    if (subSpan > 1 || otherSpan > 1) {
      sub.span = {};
      if (isHorizontal) {
        if (subSpan > 1) sub.span.col = subSpan;
        if (otherSpan > 1) sub.span.row = otherSpan;
      } else {
        if (subSpan > 1) sub.span.row = subSpan;
        if (otherSpan > 1) sub.span.col = otherSpan;
      }
    }
    out[key] = sub;
  }

  return out;
}

function _splitCaseBResolutionMultiply(grid, row, col, direction, count) {
  const isHorizontal = direction === "horizontal";
  const targetCell = grid[`${row}.${col}`];
  const oldRows = grid.rows || 1;
  const oldCols = grid.cols || 1;
  const component = targetCell.component;

  // 1. Collect every visible cell's data + position + spans.
  const visibleCells = [];
  for (let r = 1; r <= oldRows; r++) {
    for (let c = 1; c <= oldCols; c++) {
      const key = `${r}.${c}`;
      const c0 = grid[key];
      if (c0 && !c0.hide) {
        visibleCells.push({
          row: r,
          col: c,
          data: { ...c0 },
          spanRow: c0.span?.row || 1,
          spanCol: c0.span?.col || 1,
        });
      }
    }
  }

  // 2. Build the new grid: copy meta keys, drop all cell keys.
  const out = {};
  for (const k of Object.keys(grid)) {
    if (META_KEYS.has(k)) out[k] = grid[k];
  }
  if (isHorizontal) {
    out.cols = oldCols * count;
    out.rows = oldRows;
  } else {
    out.rows = oldRows * count;
    out.cols = oldCols;
  }

  // 3. Reposition every visible cell to its scaled position with the
  //    span scaled in the split direction.
  for (const vc of visibleCells) {
    const newRow = isHorizontal ? vc.row : (vc.row - 1) * count + 1;
    const newCol = isHorizontal ? (vc.col - 1) * count + 1 : vc.col;
    const key = `${newRow}.${newCol}`;
    const repositioned = {
      ...vc.data,
      hide: false,
      span: {
        row: isHorizontal ? vc.spanRow : vc.spanRow * count,
        col: isHorizontal ? vc.spanCol * count : vc.spanCol,
      },
    };
    out[key] = repositioned;
  }

  // 4. Replace the target cell's repositioned entry with count sub-cells.
  const newTargetRow = isHorizontal ? row : (row - 1) * count + 1;
  const newTargetCol = isHorizontal ? (col - 1) * count + 1 : col;
  const newTargetSpanInSplitDir = isHorizontal
    ? (targetCell.span?.col || 1) * count
    : (targetCell.span?.row || 1) * count;
  const subSpan = newTargetSpanInSplitDir / count;
  const otherSpan = isHorizontal
    ? targetCell.span?.row || 1
    : targetCell.span?.col || 1;

  for (let i = 0; i < count; i++) {
    const subRow = isHorizontal ? newTargetRow : newTargetRow + i * subSpan;
    const subCol = isHorizontal ? newTargetCol + i * subSpan : newTargetCol;
    const key = `${subRow}.${subCol}`;
    const sub = {
      component: i === 0 ? component : null,
      hide: false,
    };
    if (subSpan > 1 || otherSpan > 1) {
      sub.span = {};
      if (isHorizontal) {
        if (subSpan > 1) sub.span.col = subSpan;
        if (otherSpan > 1) sub.span.row = otherSpan;
      } else {
        if (subSpan > 1) sub.span.row = subSpan;
        if (otherSpan > 1) sub.span.col = otherSpan;
      }
    }
    out[key] = sub;
  }

  return out;
}

export function splitGridCellOp(grid, cellNumber, direction, count = 2) {
  if (!grid) return grid;
  const targetCell = grid[cellNumber];
  if (!targetCell) return grid;
  if (direction !== "horizontal" && direction !== "vertical") return grid;
  if (!Number.isFinite(count) || count < 2) return grid;

  const [row, col] = cellNumber.split(".").map(Number);
  const targetSpanInSplitDir =
    direction === "horizontal"
      ? targetCell.span?.col || 1
      : targetCell.span?.row || 1;

  if (targetSpanInSplitDir % count === 0) {
    return _splitCaseADivisibleSpan(grid, row, col, direction, count);
  }
  return _splitCaseBResolutionMultiply(grid, row, col, direction, count);
}

// Exposed for tests / DashboardModel utility (kept private until needed).
splitGridCellOp._stripSpan = _stripSpan;
