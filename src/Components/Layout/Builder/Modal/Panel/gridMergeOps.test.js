/**
 * gridMergeOps.test.js
 *
 * Pin for the pure cell-merge helpers extracted from GridEditor.
 *
 * Bug being fixed: pre-extraction, mergeRight/mergeDown deleted the
 * absorbed cell unconditionally — including any widget reference it
 * carried. Merging an empty cell into a cell that contained a widget
 * silently destroyed the widget. The fix migrates the absorbed cell's
 * `component` (and any companion fields like `hide`) onto the current
 * cell when the current cell is empty.
 */
import { mergeRightOp, mergeDownOp } from "./gridMergeOps";

const baseCell = (overrides = {}) => ({
  component: null,
  rowSpan: 1,
  colSpan: 1,
  hide: false,
  ...overrides,
});

describe("gridMergeOps — bug repro: widget preservation", () => {
  test("mergeRight: empty current + widget in next → widget MIGRATES to current", () => {
    const grid = {
      cols: 3,
      rows: 1,
      gap: "gap-2",
      1.1: baseCell(),
      1.2: baseCell({ component: 7 }),
      1.3: baseCell(),
    };
    const out = mergeRightOp(grid, 1, 1);
    expect(out["1.1"].component).toBe(7);
    expect(out["1.1"].colSpan).toBe(2);
    expect(out["1.2"]).toBeUndefined();
    // 1.3 untouched
    expect(out["1.3"]).toEqual(baseCell());
  });

  test("mergeDown: empty current + widget in below → widget MIGRATES to current", () => {
    const grid = {
      cols: 1,
      rows: 3,
      gap: "gap-2",
      1.1: baseCell(),
      2.1: baseCell({ component: 42 }),
      3.1: baseCell(),
    };
    const out = mergeDownOp(grid, 1, 1);
    expect(out["1.1"].component).toBe(42);
    expect(out["1.1"].rowSpan).toBe(2);
    expect(out["2.1"]).toBeUndefined();
    expect(out["3.1"]).toEqual(baseCell());
  });
});

describe("gridMergeOps — regression-pin: pre-existing behavior", () => {
  test("mergeRight: widget in current + empty next → widget stays in current", () => {
    const grid = {
      cols: 2,
      rows: 1,
      1.1: baseCell({ component: 7 }),
      1.2: baseCell(),
    };
    const out = mergeRightOp(grid, 1, 1);
    expect(out["1.1"].component).toBe(7);
    expect(out["1.1"].colSpan).toBe(2);
    expect(out["1.2"]).toBeUndefined();
  });

  test("mergeRight: widget in BOTH → current wins (matches pre-fix semantics)", () => {
    const grid = {
      cols: 2,
      rows: 1,
      1.1: baseCell({ component: 7 }),
      1.2: baseCell({ component: 9 }),
    };
    const out = mergeRightOp(grid, 1, 1);
    expect(out["1.1"].component).toBe(7);
    expect(out["1.1"].colSpan).toBe(2);
    expect(out["1.2"]).toBeUndefined();
  });

  test("mergeRight: skip-gap behavior — finds the next existing column", () => {
    // Grid where 1.2 doesn't exist (e.g. a previous merge already
    // absorbed it). mergeRight on (1,1) should jump to 1.3.
    const grid = {
      cols: 3,
      rows: 1,
      1.1: baseCell(),
      1.3: baseCell({ component: 5 }),
    };
    const out = mergeRightOp(grid, 1, 1);
    expect(out["1.1"].component).toBe(5);
    expect(out["1.3"]).toBeUndefined();
  });

  test("mergeDown: widget in current + empty below → widget stays in current", () => {
    const grid = {
      cols: 1,
      rows: 2,
      1.1: baseCell({ component: 7 }),
      2.1: baseCell(),
    };
    const out = mergeDownOp(grid, 1, 1);
    expect(out["1.1"].component).toBe(7);
    expect(out["1.1"].rowSpan).toBe(2);
    expect(out["2.1"]).toBeUndefined();
  });

  test("ops do not mutate input grid", () => {
    const grid = {
      cols: 2,
      rows: 1,
      1.1: baseCell(),
      1.2: baseCell({ component: 7 }),
    };
    const before = JSON.parse(JSON.stringify(grid));
    mergeRightOp(grid, 1, 1);
    expect(grid).toEqual(before);
  });
});

describe("gridMergeOps — defensive", () => {
  test("mergeRight: no next cell at all → returns grid unchanged", () => {
    const grid = {
      cols: 1,
      rows: 1,
      1.1: baseCell({ component: 7 }),
    };
    const out = mergeRightOp(grid, 1, 1);
    expect(out["1.1"]).toEqual(baseCell({ component: 7 }));
  });

  test("mergeDown: no below cell → returns grid unchanged", () => {
    const grid = {
      cols: 1,
      rows: 1,
      1.1: baseCell({ component: 7 }),
    };
    const out = mergeDownOp(grid, 1, 1);
    expect(out["1.1"]).toEqual(baseCell({ component: 7 }));
  });
});
