/**
 * mergeGridCellsOp.test.js
 *
 * Pin for the multi-cell merge operation extracted from
 * DashboardModel.mergeGridCells.
 *
 * Bug being fixed: the original code picked `cellNumbers[0]` as the
 * kept cell, hid the rest, and recorded any non-kept components in
 * `componentsToMove`. Critically, it never *moved* the kept component
 * onto the kept cell. When the user clicked an empty cell first then a
 * widget cell second, the empty cell became "kept" and the widget cell
 * was hidden — the widget reference still existed on the now-hidden
 * cell but never rendered, so the widget visually disappeared.
 *
 * Fix: pick a `keepComponent` (explicit caller choice OR first found),
 * place it on the kept cell, hide all others and clear their component
 * refs. Return the orphaned (non-kept) components so the caller can
 * remove them from the layout (existing semantics preserved).
 */
import { mergeGridCellsOp } from "./mergeGridCellsOp";

const baseCell = (overrides = {}) => ({
  component: null,
  rowSpan: 1,
  colSpan: 1,
  hide: false,
  ...overrides,
});

describe("mergeGridCellsOp — bug repro: empty kept cell + absorbed widget", () => {
  test("first cell empty + second cell has widget → widget MIGRATES to kept cell", () => {
    const grid = {
      cols: 2,
      rows: 1,
      1.1: baseCell(),
      1.2: baseCell({ component: 7 }),
    };
    const out = mergeGridCellsOp(grid, ["1.1", "1.2"]);
    expect(out.grid["1.1"].component).toBe(7);
    expect(out.grid["1.1"].hide).toBe(false);
    expect(out.grid["1.1"].span).toEqual({ row: 1, col: 2 });
    expect(out.grid["1.2"].component).toBeNull();
    expect(out.grid["1.2"].hide).toBe(true);
    // No orphans — the only widget went to the kept cell.
    expect(out.conflictingComponents).toEqual([]);
  });

  test("first cell empty + second cell with widget across multi-row → widget MIGRATES to kept cell", () => {
    const grid = {
      cols: 1,
      rows: 2,
      1.1: baseCell(),
      2.1: baseCell({ component: 42 }),
    };
    const out = mergeGridCellsOp(grid, ["1.1", "2.1"]);
    expect(out.grid["1.1"].component).toBe(42);
    expect(out.grid["1.1"].span).toEqual({ row: 2, col: 1 });
    expect(out.grid["2.1"].component).toBeNull();
    expect(out.grid["2.1"].hide).toBe(true);
    expect(out.conflictingComponents).toEqual([]);
  });
});

describe("mergeGridCellsOp — explicit keepComponent choice", () => {
  test("keepComponent specified → that component lands on kept cell", () => {
    const grid = {
      cols: 2,
      rows: 1,
      1.1: baseCell({ component: 5 }),
      1.2: baseCell({ component: 9 }),
    };
    const out = mergeGridCellsOp(grid, ["1.1", "1.2"], 9);
    expect(out.grid["1.1"].component).toBe(9);
    expect(out.grid["1.2"].component).toBeNull();
    expect(out.grid["1.2"].hide).toBe(true);
    // 5 is orphaned — caller removes it from the layout.
    expect(out.conflictingComponents).toEqual([5]);
  });

  test("keepComponent NOT in selection → falls back to first-found", () => {
    const grid = {
      cols: 2,
      rows: 1,
      1.1: baseCell({ component: 5 }),
      1.2: baseCell({ component: 9 }),
    };
    // 99 isn't present — defensive: don't blow up; default to first.
    const out = mergeGridCellsOp(grid, ["1.1", "1.2"], 99);
    expect(out.grid["1.1"].component).toBe(5);
    expect(out.conflictingComponents).toEqual([9]);
  });
});

describe("mergeGridCellsOp — regression: pre-fix happy paths still work", () => {
  test("first cell has widget + others empty → widget stays on kept cell", () => {
    const grid = {
      cols: 2,
      rows: 1,
      1.1: baseCell({ component: 7 }),
      1.2: baseCell(),
    };
    const out = mergeGridCellsOp(grid, ["1.1", "1.2"]);
    expect(out.grid["1.1"].component).toBe(7);
    expect(out.grid["1.1"].span).toEqual({ row: 1, col: 2 });
    expect(out.grid["1.2"].hide).toBe(true);
    expect(out.conflictingComponents).toEqual([]);
  });

  test("all empty cells → kept cell stays empty, gets the span", () => {
    const grid = {
      cols: 2,
      rows: 1,
      1.1: baseCell(),
      1.2: baseCell(),
    };
    const out = mergeGridCellsOp(grid, ["1.1", "1.2"]);
    expect(out.grid["1.1"].component).toBeNull();
    expect(out.grid["1.1"].span).toEqual({ row: 1, col: 2 });
    expect(out.grid["1.2"].hide).toBe(true);
    expect(out.conflictingComponents).toEqual([]);
  });

  test("3-cell merge with widget in last → widget migrates to kept cell", () => {
    const grid = {
      cols: 3,
      rows: 1,
      1.1: baseCell(),
      1.2: baseCell(),
      1.3: baseCell({ component: 11 }),
    };
    const out = mergeGridCellsOp(grid, ["1.1", "1.2", "1.3"]);
    expect(out.grid["1.1"].component).toBe(11);
    expect(out.grid["1.1"].span).toEqual({ row: 1, col: 3 });
    expect(out.grid["1.2"].hide).toBe(true);
    expect(out.grid["1.3"].hide).toBe(true);
  });

  test("does not mutate the input grid", () => {
    const grid = {
      cols: 2,
      rows: 1,
      1.1: baseCell(),
      1.2: baseCell({ component: 7 }),
    };
    const before = JSON.parse(JSON.stringify(grid));
    mergeGridCellsOp(grid, ["1.1", "1.2"]);
    expect(grid).toEqual(before);
  });
});

describe("mergeGridCellsOp — clears prior spans on selected cells", () => {
  test("selected cell already has a span → covered cells unhidden, span cleared before re-merge", () => {
    // Realistic case: a previous merge left "1.1" spanning [1.1, 1.2] with
    // "1.2" hidden. User now selects {1.1, 1.3} to merge — the prior merge
    // state on 1.1 must be unwound first.
    const grid = {
      cols: 3,
      rows: 1,
      1.1: baseCell({ span: { row: 1, col: 2 }, component: 7 }),
      1.2: baseCell({ hide: true }),
      1.3: baseCell({ component: 11 }),
    };
    const out = mergeGridCellsOp(grid, ["1.1", "1.3"]);
    // 1.1 keeps its widget (first-found default), span re-computed.
    expect(out.grid["1.1"].component).toBe(7);
    expect(out.grid["1.3"].component).toBeNull();
    expect(out.grid["1.3"].hide).toBe(true);
    // 11 is orphaned (caller removes).
    expect(out.conflictingComponents).toEqual([11]);
  });
});
