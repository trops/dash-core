/**
 * mergeGridCellsOp
 *
 * Pure helper for the multi-cell merge operation invoked by
 * `DashboardModel.mergeGridCells`. The model wraps this helper with
 * the workspace mutation glue.
 *
 * Bug history (slice 9): the original implementation always picked
 * `cellNumbers[0]` as the kept cell and unconditionally hid the rest.
 * If the user selected cells in the order (empty, widget) — clicking
 * the empty cell first — the widget cell got hidden and the kept
 * cell stayed empty. The widget's component reference still existed
 * on the now-hidden cell, but never rendered, so it visually
 * disappeared.
 *
 * Fix: deterministically place the chosen "keep" component onto the
 * kept cell. Caller can pass `keepComponentId` (e.g. from the
 * MergeCellsModal's user choice when multiple widgets are in
 * conflict). When omitted, default to the first non-null component
 * found across the selection. Components that aren't kept are
 * returned in `conflictingComponents` so the caller can remove them
 * from the layout (existing semantics).
 */

function _spanOf(grid, cellNumber) {
  const cell = grid[cellNumber];
  if (!cell || !cell.span) return { row: 1, col: 1 };
  return {
    row: cell.span.row || 1,
    col: cell.span.col || 1,
  };
}

/**
 * @param {object} grid - Grid object (cells keyed by "row.col")
 * @param {string[]} cellNumbers - Cell keys to merge
 * @param {*} [keepComponentId] - Optional explicit choice of which
 *   component (by component id) survives on the kept cell.
 * @returns {{
 *   grid: object,
 *   conflictingComponents: any[]
 * }}
 */
export function mergeGridCellsOp(grid, cellNumbers, keepComponentId) {
  // Deep clone the cells we touch so the input grid is never mutated.
  // Other entries pass through by reference (cheap; they aren't
  // touched by this op).
  const out = { ...grid };

  // 1. Find bounding box accounting for existing spans.
  let minRow = Infinity,
    maxRow = -Infinity;
  let minCol = Infinity,
    maxCol = -Infinity;
  for (const cn of cellNumbers) {
    const [r, c] = cn.split(".").map(Number);
    const span = _spanOf(grid, cn);
    if (r < minRow) minRow = r;
    if (r + span.row - 1 > maxRow) maxRow = r + span.row - 1;
    if (c < minCol) minCol = c;
    if (c + span.col - 1 > maxCol) maxCol = c + span.col - 1;
  }

  // 2. Clear prior merge state on selected cells: if any selected cell
  //    already has a span, unhide its previously-covered cells, then
  //    drop the span. This makes back-to-back merges idempotent.
  for (const cn of cellNumbers) {
    const cell = grid[cn];
    if (!cell) continue;
    if (cell.span) {
      const [cr, cc] = cn.split(".").map(Number);
      const sr = cell.span.row || 1;
      const sc = cell.span.col || 1;
      for (let r = cr; r < cr + sr; r++) {
        for (let c = cc; c < cc + sc; c++) {
          const coveredKey = `${r}.${c}`;
          if (grid[coveredKey]) {
            out[coveredKey] = { ...grid[coveredKey], hide: false };
          }
        }
      }
      out[cn] = { ...(out[cn] || cell) };
      delete out[cn].span;
      out[cn].hide = false;
    } else {
      out[cn] = { ...cell, hide: false };
    }
  }

  // 3. Collect every component sitting in any selected cell. Decide
  //    which one survives.
  const componentsInRange = [];
  for (const cn of cellNumbers) {
    const cell = out[cn];
    if (cell && cell.component != null) {
      componentsInRange.push({ cellNumber: cn, component: cell.component });
    }
  }

  let keepEntry;
  if (keepComponentId != null) {
    keepEntry = componentsInRange.find((e) => e.component === keepComponentId);
  }
  if (!keepEntry) {
    keepEntry = componentsInRange[0]; // first-found fallback
  }
  const keptComponent = keepEntry ? keepEntry.component : null;
  const conflictingComponents = componentsInRange
    .filter((e) => e.component !== keptComponent)
    .map((e) => e.component);

  // 4. Apply: kept cell gets the kept component + the new span; all
  //    other selected cells get hidden and have their component refs
  //    cleared (so a stale ref in a hidden cell never re-renders).
  const keepCell = cellNumbers[0];
  for (const cn of cellNumbers) {
    if (!out[cn]) continue;
    if (cn === keepCell) {
      out[cn] = {
        ...out[cn],
        component: keptComponent,
        hide: false,
      };
    } else {
      out[cn] = {
        ...out[cn],
        component: null,
        hide: true,
      };
    }
  }

  // 5. Span on kept cell.
  out[keepCell] = {
    ...out[keepCell],
    span: { row: maxRow - minRow + 1, col: maxCol - minCol + 1 },
  };

  return { grid: out, conflictingComponents };
}
