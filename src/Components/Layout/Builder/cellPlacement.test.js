/**
 * cellPlacement (lead-workspace release 6c): only an empty cell is filled.
 */
import { cellProblem } from "./cellPlacement";

const layout = [
  {
    id: 3,
    component: "LayoutGridContainer",
    grid: {
      rows: 2,
      cols: 2,
      1.1: { component: 10, hide: false },
      1.2: { component: null, hide: true },
      2.1: { component: null, hide: false },
    },
  },
];

test("an empty cell (or one never set) can be filled", () => {
  expect(cellProblem(layout, 3, "2.1")).toBeNull();
  expect(cellProblem(layout, 3, "2.2")).toBeNull();
});

test("a cell with a widget, or covered by another, is taken", () => {
  expect(cellProblem(layout, 3, "1.1")).toBe("taken");
  expect(cellProblem(layout, 3, "1.2")).toBe("taken");
});

test("no such grid or cell: gone", () => {
  expect(cellProblem(layout, 9, "1.1")).toBe("gone");
  expect(cellProblem(layout, 3, "3.1")).toBe("gone");
  expect(cellProblem(layout, 3, "x")).toBe("gone");
  expect(cellProblem(null, 3, "1.1")).toBe("gone");
});
