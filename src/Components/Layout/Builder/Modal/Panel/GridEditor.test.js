/**
 * GridEditor.test.js
 *
 * RTL coverage of the grid layout editor's button → state wiring.
 * Pure helpers (mergeRightOp, mergeDownOp, splitGridCellOp,
 * addGridRowOp, deleteGridRowOp, addGridColumnOp, deleteGridColumnOp)
 * are unit-tested in their own files. These tests verify the
 * GridEditor's UI actually invokes them on the right buttons and
 * propagates the result to its `onUpdate` callback.
 *
 * Why this matters: slice 11 pinned the helpers; this slice closes
 * the loop on the wiring so a refactor that swaps a button's
 * onClick handler can't silently break the editor.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// react-dnd lives in dash-electron's dependency tree, not dash-core's
// own node_modules. Mock the surface GridEditor uses so jest can
// resolve the module under test without the real drag-and-drop layer
// (we don't exercise drag here — those are covered separately).
jest.mock(
  "react-dnd",
  () => ({
    DndProvider: ({ children }) => children,
    useDrag: () => [{ isDragging: false }, () => {}],
    useDrop: () => [{}, () => {}],
  }),
  { virtual: true },
);
jest.mock("react-dnd-html5-backend", () => ({ HTML5Backend: {} }), {
  virtual: true,
});

import GridEditor from "./GridEditor";

function lastUpdate(mock) {
  if (mock.mock.calls.length === 0) return null;
  return mock.mock.calls[mock.mock.calls.length - 1][0];
}

function gridKeys(grid) {
  return Object.keys(grid)
    .filter((k) => k !== "rows" && k !== "cols")
    .sort();
}

describe("GridEditor — basic button wiring", () => {
  test("renders default 1x1 grid header and a single cell", () => {
    render(<GridEditor onUpdate={() => {}} />);
    expect(screen.getByText("Rows 1 Columns 1")).toBeInTheDocument();
    expect(screen.getByText("0.0")).toBeInTheDocument();
  });

  test("Add Row → onUpdate receives a grid with rows=2 and a new 1.0 cell", async () => {
    const onUpdate = jest.fn();
    render(<GridEditor onUpdate={onUpdate} />);
    await userEvent.click(screen.getByText("Add Row"));
    const grid = lastUpdate(onUpdate);
    expect(grid).not.toBeNull();
    expect(grid.rows).toBe(2);
    expect(grid["1.0"]).toEqual({ component: null, rowSpan: 1, colSpan: 1 });
  });

  test("Add Column → onUpdate receives a grid with cols=2 and a new 0.1 cell", async () => {
    const onUpdate = jest.fn();
    render(<GridEditor onUpdate={onUpdate} />);
    await userEvent.click(screen.getByText("Add Column"));
    const grid = lastUpdate(onUpdate);
    expect(grid.cols).toBe(2);
    expect(grid["0.1"]).toEqual({ component: null, rowSpan: 1, colSpan: 1 });
  });

  test("Reset Grid → onUpdate receives the 1x1 default", async () => {
    const onUpdate = jest.fn();
    const initialGrid = {
      rows: 2,
      cols: 2,
      "0.0": { component: null, rowSpan: 1, colSpan: 1 },
      0.1: { component: null, rowSpan: 1, colSpan: 1 },
      "1.0": { component: null, rowSpan: 1, colSpan: 1 },
      1.1: { component: null, rowSpan: 1, colSpan: 1 },
    };
    render(<GridEditor onUpdate={onUpdate} initialGrid={initialGrid} />);
    await userEvent.click(screen.getByText("Reset Grid"));
    const grid = lastUpdate(onUpdate);
    expect(grid.rows).toBe(1);
    expect(grid.cols).toBe(1);
    expect(grid["0.0"]).toBeDefined();
    expect(grid["1.1"]).toBeUndefined();
  });
});

describe("GridEditor — merge / split per-cell wiring", () => {
  test("merge-right absorbs the right neighbor (colSpan grows, neighbor key removed)", async () => {
    const onUpdate = jest.fn();
    const initialGrid = {
      rows: 1,
      cols: 2,
      "0.0": { component: null, rowSpan: 1, colSpan: 1 },
      0.1: { component: null, rowSpan: 1, colSpan: 1 },
    };
    render(<GridEditor onUpdate={onUpdate} initialGrid={initialGrid} />);
    // Cell 0.0 should expose a merge-right button (title "Merge");
    // 0.1 should not (no right neighbor). Find the button via title
    // attribute — there's exactly one merge-right in this fixture.
    const mergeButtons = screen.getAllByTitle("Merge");
    expect(mergeButtons).toHaveLength(1);
    await userEvent.click(mergeButtons[0]);
    const grid = lastUpdate(onUpdate);
    expect(grid["0.0"].colSpan).toBe(2);
    expect(grid["0.1"]).toBeUndefined();
  });

  test("merge-down absorbs the cell below (rowSpan grows, below key removed)", async () => {
    const onUpdate = jest.fn();
    const initialGrid = {
      rows: 2,
      cols: 1,
      "0.0": { component: null, rowSpan: 1, colSpan: 1 },
      "1.0": { component: null, rowSpan: 1, colSpan: 1 },
    };
    render(<GridEditor onUpdate={onUpdate} initialGrid={initialGrid} />);
    const mergeDown = screen.getAllByTitle("down");
    expect(mergeDown).toHaveLength(1);
    await userEvent.click(mergeDown[0]);
    const grid = lastUpdate(onUpdate);
    expect(grid["0.0"].rowSpan).toBe(2);
    expect(grid["1.0"]).toBeUndefined();
  });

  test("split a wide cell restores a sibling and resets colSpan", async () => {
    const onUpdate = jest.fn();
    // 1×2 grid where 0.0 has already absorbed 0.1 (colSpan=2)
    const initialGrid = {
      rows: 1,
      cols: 2,
      "0.0": { component: null, rowSpan: 1, colSpan: 2 },
    };
    render(<GridEditor onUpdate={onUpdate} initialGrid={initialGrid} />);
    // Split icon shows on cells with colSpan > 1.
    const split = screen.getAllByTitle("split");
    expect(split).toHaveLength(1);
    await userEvent.click(split[0]);
    const grid = lastUpdate(onUpdate);
    expect(grid["0.0"].colSpan).toBe(1);
    // Splitting reintroduces the sibling at the next column.
    expect(grid["0.1"]).toBeDefined();
  });

  test("merge-right then split round-trips back to two single-span cells", async () => {
    const onUpdate = jest.fn();
    const initialGrid = {
      rows: 1,
      cols: 2,
      "0.0": { component: null, rowSpan: 1, colSpan: 1 },
      0.1: { component: null, rowSpan: 1, colSpan: 1 },
    };
    render(<GridEditor onUpdate={onUpdate} initialGrid={initialGrid} />);
    await userEvent.click(screen.getByTitle("Merge"));
    // After merge, the split button should be available.
    const split = await screen.findByTitle("split");
    await userEvent.click(split);
    const grid = lastUpdate(onUpdate);
    expect(grid.cols).toBe(2);
    expect(grid["0.0"].colSpan).toBe(1);
    expect(grid["0.1"]).toBeDefined();
    expect(grid["0.1"].colSpan).toBe(1);
  });
});

describe("GridEditor — cell-render invariants", () => {
  test("merge buttons hide on cells that have no neighbor in that direction", () => {
    const initialGrid = {
      rows: 1,
      cols: 2,
      "0.0": { component: null, rowSpan: 1, colSpan: 1 },
      0.1: { component: null, rowSpan: 1, colSpan: 1 },
    };
    render(<GridEditor onUpdate={() => {}} initialGrid={initialGrid} />);
    // Right-most cell (0.1) has no right neighbor and no cell below.
    // Only the left cell (0.0) should expose a merge-right button.
    expect(screen.getAllByTitle("Merge")).toHaveLength(1);
    expect(screen.queryAllByTitle("down")).toHaveLength(0);
    // No split — both cells have colSpan=1.
    expect(screen.queryAllByTitle("split")).toHaveLength(0);
  });

  test("each cell renders its position key (row.col) for visibility", () => {
    const initialGrid = {
      rows: 2,
      cols: 2,
      "0.0": { component: null, rowSpan: 1, colSpan: 1 },
      0.1: { component: null, rowSpan: 1, colSpan: 1 },
      "1.0": { component: null, rowSpan: 1, colSpan: 1 },
      1.1: { component: null, rowSpan: 1, colSpan: 1 },
    };
    render(<GridEditor onUpdate={() => {}} initialGrid={initialGrid} />);
    expect(screen.getByText("0.0")).toBeInTheDocument();
    expect(screen.getByText("0.1")).toBeInTheDocument();
    expect(screen.getByText("1.0")).toBeInTheDocument();
    expect(screen.getByText("1.1")).toBeInTheDocument();
  });
});
