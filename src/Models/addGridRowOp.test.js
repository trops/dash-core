/**
 * addGridRowOp.test.js
 *
 * Pin for the row-insertion op extracted from
 * `DashboardModel.addGridRow`.
 *
 * Invariants tested:
 *   - Existing rows shift down (preserving widget refs)
 *   - New row's cells are empty + visible
 *   - rowHeights and rowModes keys shift to track their original rows
 *   - Insertion at the beginning (afterRow=0) and at the end work
 *   - Input grid is not mutated
 */
import { addGridRowOp } from "./addGridRowOp";

const cell = (overrides = {}) => ({
  component: null,
  hide: false,
  ...overrides,
});

describe("addGridRowOp", () => {
  test("inserts at end (afterRow = current rows) — new row is last", () => {
    const grid = {
      rows: 1,
      cols: 2,
      1.1: cell({ component: 7 }),
      1.2: cell({ component: 9 }),
    };
    const out = addGridRowOp(grid, 1);
    expect(out.rows).toBe(2);
    // Original row untouched.
    expect(out["1.1"].component).toBe(7);
    expect(out["1.2"].component).toBe(9);
    // New row is empty.
    expect(out["2.1"]).toEqual(cell());
    expect(out["2.2"]).toEqual(cell());
  });

  test("inserts at beginning (afterRow = 0) — existing rows shift down", () => {
    const grid = {
      rows: 1,
      cols: 2,
      1.1: cell({ component: 7 }),
      1.2: cell({ component: 9 }),
    };
    const out = addGridRowOp(grid, 0);
    expect(out.rows).toBe(2);
    // New row at top.
    expect(out["1.1"]).toEqual(cell());
    expect(out["1.2"]).toEqual(cell());
    // Original row shifted to row 2.
    expect(out["2.1"].component).toBe(7);
    expect(out["2.2"].component).toBe(9);
  });

  test("inserts in middle — rows below shift down by 1", () => {
    const grid = {
      rows: 3,
      cols: 1,
      1.1: cell({ component: 1 }),
      2.1: cell({ component: 2 }),
      3.1: cell({ component: 3 }),
    };
    const out = addGridRowOp(grid, 1);
    expect(out.rows).toBe(4);
    expect(out["1.1"].component).toBe(1);
    expect(out["2.1"]).toEqual(cell()); // new row
    expect(out["3.1"].component).toBe(2);
    expect(out["4.1"].component).toBe(3);
  });

  test("rowHeights keys shift down for rows at/after insertion point", () => {
    const grid = {
      rows: 3,
      cols: 1,
      rowHeights: { 1: 2, 2: 3, 3: 1 },
      1.1: cell(),
      2.1: cell(),
      3.1: cell(),
    };
    const out = addGridRowOp(grid, 1);
    // Row 1 stays at 1; rows 2 and 3 shift to 3 and 4.
    expect(out.rowHeights).toEqual({ 1: 2, 3: 3, 4: 1 });
  });

  test("rowModes keys shift down similarly", () => {
    const grid = {
      rows: 2,
      cols: 1,
      rowModes: { 1: "grow", 2: "shrink" },
      1.1: cell(),
      2.1: cell(),
    };
    const out = addGridRowOp(grid, 0);
    expect(out.rowModes).toEqual({ 2: "grow", 3: "shrink" });
  });

  test("does not mutate the input grid", () => {
    const grid = {
      rows: 1,
      cols: 1,
      1.1: cell({ component: 7 }),
    };
    const before = JSON.parse(JSON.stringify(grid));
    addGridRowOp(grid, 0);
    expect(grid).toEqual(before);
  });
});
