/**
 * addGridColumnOp.test.js — symmetric to addGridRowOp.
 */
import { addGridColumnOp } from "./addGridColumnOp";

const cell = (overrides = {}) => ({
  component: null,
  hide: false,
  ...overrides,
});

describe("addGridColumnOp", () => {
  test("inserts at right (afterCol = current cols)", () => {
    const grid = {
      rows: 2,
      cols: 1,
      1.1: cell({ component: 7 }),
      2.1: cell({ component: 9 }),
    };
    const out = addGridColumnOp(grid, 1);
    expect(out.cols).toBe(2);
    expect(out["1.1"].component).toBe(7);
    expect(out["2.1"].component).toBe(9);
    expect(out["1.2"]).toEqual(cell());
    expect(out["2.2"]).toEqual(cell());
  });

  test("inserts at left (afterCol = 0) — existing cols shift right", () => {
    const grid = {
      rows: 1,
      cols: 2,
      1.1: cell({ component: 7 }),
      1.2: cell({ component: 9 }),
    };
    const out = addGridColumnOp(grid, 0);
    expect(out.cols).toBe(3);
    expect(out["1.1"]).toEqual(cell());
    expect(out["1.2"].component).toBe(7);
    expect(out["1.3"].component).toBe(9);
  });

  test("inserts in middle — cols to the right shift by 1", () => {
    const grid = {
      rows: 1,
      cols: 3,
      1.1: cell({ component: 1 }),
      1.2: cell({ component: 2 }),
      1.3: cell({ component: 3 }),
    };
    const out = addGridColumnOp(grid, 1);
    expect(out.cols).toBe(4);
    expect(out["1.1"].component).toBe(1);
    expect(out["1.2"]).toEqual(cell()); // new column
    expect(out["1.3"].component).toBe(2);
    expect(out["1.4"].component).toBe(3);
  });

  test("colModes keys shift right for cols at/after insertion point", () => {
    const grid = {
      rows: 1,
      cols: 3,
      colModes: { 1: "shrink", 2: "grow", 3: "fixed" },
      1.1: cell(),
      1.2: cell(),
      1.3: cell(),
    };
    const out = addGridColumnOp(grid, 1);
    expect(out.colModes).toEqual({ 1: "shrink", 3: "grow", 4: "fixed" });
  });

  test("does not mutate the input grid", () => {
    const grid = {
      rows: 1,
      cols: 1,
      1.1: cell({ component: 7 }),
    };
    const before = JSON.parse(JSON.stringify(grid));
    addGridColumnOp(grid, 0);
    expect(grid).toEqual(before);
  });
});
