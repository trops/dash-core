/**
 * deleteGridRowOp.test.js
 *
 * Pin for the row-deletion op extracted from
 * `DashboardModel.deleteGridRow`.
 *
 * KEY INVARIANT (and the slice 11 bug-class to watch): widgets in the
 * deleted row MUST be reported as orphaned via the return value so the
 * caller can remove them from the layout. Pre-extraction, the model
 * deleted them inline via `removeItemFromLayout` — same end behavior,
 * but invisible to the caller. Surfacing the list lets future callers
 * implement "confirm before delete" UX without touching this op.
 */
import { deleteGridRowOp } from "./deleteGridRowOp";

const cell = (overrides = {}) => ({
  component: null,
  hide: false,
  ...overrides,
});

describe("deleteGridRowOp", () => {
  test("deletes empty row, shifts rows below up by 1", () => {
    const grid = {
      rows: 3,
      cols: 1,
      1.1: cell({ component: 1 }),
      2.1: cell(), // empty row to delete
      3.1: cell({ component: 3 }),
    };
    const out = deleteGridRowOp(grid, 2);
    expect(out.grid.rows).toBe(2);
    expect(out.grid["1.1"].component).toBe(1);
    expect(out.grid["2.1"].component).toBe(3); // was 3.1
    expect(out.grid["3.1"]).toBeUndefined();
    expect(out.orphanedComponents).toEqual([]);
  });

  test("deletes row containing widget → widget reported orphaned", () => {
    const grid = {
      rows: 2,
      cols: 2,
      1.1: cell({ component: 7 }),
      1.2: cell({ component: 9 }),
      2.1: cell(),
      2.2: cell(),
    };
    const out = deleteGridRowOp(grid, 1);
    expect(out.grid.rows).toBe(1);
    // Row 2 is now row 1 (empty cells).
    expect(out.grid["1.1"]).toEqual(cell());
    expect(out.grid["1.2"]).toEqual(cell());
    // Widgets from the deleted row are reported orphaned (caller removes).
    expect(out.orphanedComponents.sort()).toEqual([7, 9]);
  });

  test("deletes last row — first rows untouched", () => {
    const grid = {
      rows: 2,
      cols: 1,
      1.1: cell({ component: 1 }),
      2.1: cell({ component: 2 }),
    };
    const out = deleteGridRowOp(grid, 2);
    expect(out.grid.rows).toBe(1);
    expect(out.grid["1.1"].component).toBe(1);
    expect(out.grid["2.1"]).toBeUndefined();
    expect(out.orphanedComponents).toEqual([2]);
  });

  test("cannot delete the only row — returns grid unchanged + no orphans", () => {
    const grid = {
      rows: 1,
      cols: 1,
      1.1: cell({ component: 7 }),
    };
    const out = deleteGridRowOp(grid, 1);
    expect(out.grid.rows).toBe(1);
    expect(out.grid["1.1"].component).toBe(7);
    expect(out.orphanedComponents).toEqual([]);
  });

  test("rowHeights: deleted row's entry removed, rows below shift up", () => {
    const grid = {
      rows: 3,
      cols: 1,
      rowHeights: { 1: 2, 2: 3, 3: 1 },
      1.1: cell(),
      2.1: cell(),
      3.1: cell(),
    };
    const out = deleteGridRowOp(grid, 2);
    expect(out.grid.rowHeights).toEqual({ 1: 2, 2: 1 });
  });

  test("rowModes: deleted row's entry removed, rows below shift up", () => {
    const grid = {
      rows: 3,
      cols: 1,
      rowModes: { 1: "grow", 2: "shrink", 3: "fixed" },
      1.1: cell(),
      2.1: cell(),
      3.1: cell(),
    };
    const out = deleteGridRowOp(grid, 2);
    expect(out.grid.rowModes).toEqual({ 1: "grow", 2: "fixed" });
  });

  test("does not mutate the input grid", () => {
    const grid = {
      rows: 2,
      cols: 1,
      1.1: cell({ component: 7 }),
      2.1: cell({ component: 9 }),
    };
    const before = JSON.parse(JSON.stringify(grid));
    deleteGridRowOp(grid, 1);
    expect(grid).toEqual(before);
  });
});
