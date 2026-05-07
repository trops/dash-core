/**
 * splitGridCellOp.test.js
 *
 * Pin for cell-splitting extracted from `DashboardModel.splitGridCell`.
 *
 * Two regimes the original code maintains:
 *   - CASE A: target span is divisible by count → subdivide in place
 *   - CASE B: target span isn't divisible → multiply the grid's
 *     row/col resolution by count and reposition every visible cell
 *
 * Pinned invariants:
 *   - Widget on a split cell ends up on the FIRST sub-cell (preserving
 *     pre-fix behavior)
 *   - Other widgets in the grid don't get lost during CASE B's
 *     resolution-multiplication
 *   - Splitting horizontal vs vertical is symmetric
 *   - Empty cells split cleanly without spurious component refs
 *   - Input grid is not mutated
 */
import { splitGridCellOp } from "./splitGridCellOp";

const cell = (overrides = {}) => ({
  component: null,
  hide: false,
  ...overrides,
});

describe("splitGridCellOp — CASE A (divisible span)", () => {
  test("horizontal: cell with col span 2, count=2 → 2 sub-cells with span 1", () => {
    const grid = {
      rows: 1,
      cols: 2,
      1.1: cell({ component: 7, span: { col: 2 } }),
    };
    const out = splitGridCellOp(grid, "1.1", "horizontal", 2);
    expect(out.cols).toBe(2);
    // Span removed; widget on first sub-cell.
    expect(out["1.1"].component).toBe(7);
    expect(out["1.1"].span).toBeUndefined();
    expect(out["1.2"].component).toBeNull();
  });

  test("vertical: cell with row span 2, count=2 → 2 sub-cells with span 1", () => {
    const grid = {
      rows: 2,
      cols: 1,
      1.1: cell({ component: 7, span: { row: 2 } }),
    };
    const out = splitGridCellOp(grid, "1.1", "vertical", 2);
    expect(out.rows).toBe(2);
    expect(out["1.1"].component).toBe(7);
    expect(out["1.1"].span).toBeUndefined();
    expect(out["2.1"].component).toBeNull();
  });
});

describe("splitGridCellOp — CASE B (resolution multiply)", () => {
  test("horizontal: cell with no span, count=2 → grid.cols doubles, widget on first sub-cell", () => {
    const grid = {
      rows: 1,
      cols: 2,
      1.1: cell({ component: 7 }),
      1.2: cell({ component: 9 }),
    };
    const out = splitGridCellOp(grid, "1.1", "horizontal", 2);
    expect(out.cols).toBe(4);
    // Cell 1.1 split into two sub-cells at 1.1 and 1.2; widget on first.
    expect(out["1.1"].component).toBe(7);
    expect(out["1.2"].component).toBeNull();
    // Cell 1.2 (the OTHER widget) was repositioned to 1.3 with col span 2.
    expect(out["1.3"].component).toBe(9);
    expect(out["1.3"].span).toEqual({ row: 1, col: 2 });
  });

  test("vertical: cell with no span, count=2 → grid.rows doubles, widget on first sub-cell", () => {
    const grid = {
      rows: 2,
      cols: 1,
      1.1: cell({ component: 7 }),
      2.1: cell({ component: 9 }),
    };
    const out = splitGridCellOp(grid, "1.1", "vertical", 2);
    expect(out.rows).toBe(4);
    expect(out["1.1"].component).toBe(7);
    expect(out["2.1"].component).toBeNull();
    // Cell 2.1 repositioned to 3.1 with row span 2.
    expect(out["3.1"].component).toBe(9);
    expect(out["3.1"].span).toEqual({ row: 2, col: 1 });
  });

  test("horizontal split of empty cell — empty sub-cells, no spurious widget refs", () => {
    const grid = {
      rows: 1,
      cols: 1,
      1.1: cell(),
    };
    const out = splitGridCellOp(grid, "1.1", "horizontal", 2);
    expect(out.cols).toBe(2);
    expect(out["1.1"].component).toBeNull();
    expect(out["1.2"].component).toBeNull();
  });
});

describe("splitGridCellOp — defensive", () => {
  test("missing target cell — returns input grid unchanged", () => {
    const grid = { rows: 1, cols: 1, 1.1: cell() };
    const out = splitGridCellOp(grid, "5.5", "horizontal", 2);
    expect(out).toEqual(grid);
  });

  test("unknown direction — returns input grid unchanged", () => {
    const grid = { rows: 1, cols: 1, 1.1: cell({ component: 7 }) };
    const out = splitGridCellOp(grid, "1.1", "diagonal", 2);
    expect(out).toEqual(grid);
  });

  test("does not mutate the input grid", () => {
    const grid = {
      rows: 1,
      cols: 2,
      1.1: cell({ component: 7 }),
      1.2: cell({ component: 9 }),
    };
    const before = JSON.parse(JSON.stringify(grid));
    splitGridCellOp(grid, "1.1", "horizontal", 2);
    expect(grid).toEqual(before);
  });
});
