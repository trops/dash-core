/**
 * deleteGridColumnOp.test.js — symmetric to deleteGridRowOp.
 */
import { deleteGridColumnOp } from "./deleteGridColumnOp";

const cell = (overrides = {}) => ({
  component: null,
  hide: false,
  ...overrides,
});

describe("deleteGridColumnOp", () => {
  test("deletes empty column, shifts cols to right left by 1", () => {
    const grid = {
      rows: 1,
      cols: 3,
      1.1: cell({ component: 1 }),
      1.2: cell(), // empty col to delete
      1.3: cell({ component: 3 }),
    };
    const out = deleteGridColumnOp(grid, 2);
    expect(out.grid.cols).toBe(2);
    expect(out.grid["1.1"].component).toBe(1);
    expect(out.grid["1.2"].component).toBe(3);
    expect(out.grid["1.3"]).toBeUndefined();
    expect(out.orphanedComponents).toEqual([]);
  });

  test("deletes column containing widget → widget reported orphaned", () => {
    const grid = {
      rows: 2,
      cols: 2,
      1.1: cell({ component: 7 }),
      1.2: cell({ component: 9 }),
      2.1: cell({ component: 11 }),
      2.2: cell({ component: 13 }),
    };
    const out = deleteGridColumnOp(grid, 1);
    expect(out.grid.cols).toBe(1);
    expect(out.grid["1.1"].component).toBe(9);
    expect(out.grid["2.1"].component).toBe(13);
    expect(out.orphanedComponents.sort()).toEqual([11, 7]);
  });

  test("cannot delete the only column — returns unchanged", () => {
    const grid = {
      rows: 1,
      cols: 1,
      1.1: cell({ component: 7 }),
    };
    const out = deleteGridColumnOp(grid, 1);
    expect(out.grid.cols).toBe(1);
    expect(out.grid["1.1"].component).toBe(7);
    expect(out.orphanedComponents).toEqual([]);
  });

  test("colModes: deleted column's entry removed, cols to right shift left", () => {
    const grid = {
      rows: 1,
      cols: 3,
      colModes: { 1: "shrink", 2: "grow", 3: "fixed" },
      1.1: cell(),
      1.2: cell(),
      1.3: cell(),
    };
    const out = deleteGridColumnOp(grid, 2);
    expect(out.grid.colModes).toEqual({ 1: "shrink", 2: "fixed" });
  });

  test("does not mutate the input grid", () => {
    const grid = {
      rows: 1,
      cols: 2,
      1.1: cell({ component: 7 }),
      1.2: cell({ component: 9 }),
    };
    const before = JSON.parse(JSON.stringify(grid));
    deleteGridColumnOp(grid, 1);
    expect(grid).toEqual(before);
  });
});
