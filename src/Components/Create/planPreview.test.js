/**
 * The plan's preview sketch (create-entry PRD CRE-003 AC6, phase 5d).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { previewBoxes, sampleLines, hasSamples } from "./planPreview";
import { PlanSketch } from "./PlanSketch";

const plan = {
  summary: "Brief",
  pieces: [
    {
      kind: "widget",
      name: "Calendar",
      source: "registry",
      package: "@trops/google-calendar",
      sample: [
        "9:30 Design review · 3 people",
        "13:00 1:1 with Alex",
        "x",
        "dropped",
      ],
    },
    { kind: "widget", name: "Unread", source: "new", notes: "Unread count" },
    {
      kind: "bot",
      name: "Briefer",
      source: "new",
      instructions: "Brief.",
      showResults: true,
      results: [{ name: "brief", label: "Morning brief" }],
      sample: ["2 meetings; 1 email needs you"],
    },
    { kind: "bot", name: "Quiet", source: "new", instructions: "Shh." },
    { kind: "layout", name: "Brief", source: "new" },
  ],
};

describe("previewBoxes — laid out the way the build lays it out", () => {
  test("widgets in order, then a results box per bot that shows its results", () => {
    const p = previewBoxes(plan);
    expect(p.cols).toBe(2);
    expect(p.boxes.map((b) => [b.kind, b.title])).toEqual([
      ["widget", "Calendar"],
      ["widget", "Unread"],
      ["results", "Briefer · results"],
    ]);
    expect(p.boxes[0].lines).toEqual([
      "9:30 Design review · 3 people",
      "13:00 1:1 with Alex",
      "x",
    ]);
    expect(p.boxes[1]).toMatchObject({ lines: [], note: "Unread count" });
    expect(p.boxes[2].lines).toEqual(["2 meetings; 1 email needs you"]);
    expect(hasSamples(p)).toBe(true);
  });

  test("one widget → one column; bad or missing samples → none", () => {
    expect(previewBoxes({ pieces: [{ kind: "widget", name: "A" }] }).cols).toBe(
      1,
    );
    expect(sampleLines({ sample: "oops" })).toEqual([]);
    expect(sampleLines({ sample: [1, " ", "ok"] })).toEqual(["ok"]);
    expect(sampleLines({ sample: ["y".repeat(200)] })[0]).toHaveLength(80);
    expect(
      hasSamples(previewBoxes({ pieces: [{ kind: "widget", name: "A" }] })),
    ).toBe(false);
  });
});

describe("PlanSketch", () => {
  test("boxes marked Sample; Hide and Show", () => {
    render(<PlanSketch plan={plan} />);
    expect(screen.getAllByTestId("plan-preview-box")).toHaveLength(3);
    expect(screen.getAllByText("Sample")).toHaveLength(3);
    expect(screen.getByText("13:00 1:1 with Alex")).toBeInTheDocument();
    expect(screen.getByText("Unread count")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide preview" }));
    expect(screen.queryAllByTestId("plan-preview-box")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Show preview" }));
    expect(screen.getAllByTestId("plan-preview-box")).toHaveLength(3);
  });

  test("in the narrow dock the boxes stack in one column", () => {
    const { container, rerender } = render(<PlanSketch plan={plan} />);
    const grid = () =>
      container.querySelector('[data-testid="plan-preview-box"]').parentElement;
    expect(grid().style.gridTemplateColumns).not.toBe(
      "repeat(1, minmax(0, 1fr))",
    );
    rerender(<PlanSketch plan={plan} compact />);
    expect(grid().style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
  });

  test("no samples yet says so; no pieces, no preview", () => {
    const { rerender } = render(
      <PlanSketch
        plan={{ pieces: [{ kind: "widget", name: "A", notes: "n" }] }}
      />,
    );
    expect(
      screen.getByText(
        "The Planner hasn't added sample data to this plan yet.",
      ),
    ).toBeInTheDocument();
    rerender(<PlanSketch plan={{ pieces: [] }} />);
    expect(screen.queryByTestId("plan-preview")).toBeNull();
  });
});

describe("previewBoxes — a planned grid (plan grids)", () => {
  const store = () => ({
    summary: "Storefront",
    pieces: [
      {
        kind: "layout",
        name: "Algolia Storefront",
        source: "new",
        pages: [
          {
            name: "Search",
            widgets: [
              "Search Box",
              "Brand Filter",
              "Category Filter",
              "Hits",
              "Pagination",
            ],
            grid: {
              cols: 2,
              rows: 4,
              colWidths: { 1: "1/4" },
              rowHeights: { 1: "shrink", 4: "shrink" },
              cells: [
                { widget: "Search Box", row: 1, col: 1, colSpan: 2 },
                { widget: "Brand Filter", row: 2, col: 1 },
                { widget: "Category Filter", row: 3, col: 1 },
                { widget: "Hits", row: 2, col: 2, rowSpan: 2 },
                { widget: "Pagination", row: 4, col: 1, colSpan: 2 },
              ],
            },
          },
        ],
      },
      {
        kind: "widget",
        name: "Search Box",
        source: "yours",
        package: "@trops/algolia-search",
        component: "AlgoliaSearchBox",
      },
      {
        kind: "widget",
        name: "Brand Filter",
        source: "yours",
        package: "@trops/algolia-search",
        component: "AlgoliaRefinementList",
      },
      {
        kind: "widget",
        name: "Category Filter",
        source: "yours",
        package: "@trops/algolia-search",
        component: "AlgoliaRefinementList",
      },
      {
        kind: "widget",
        name: "Hits",
        source: "yours",
        package: "@trops/algolia-search",
        component: "AlgoliaHits",
      },
      {
        kind: "widget",
        name: "Pagination",
        source: "yours",
        package: "@trops/algolia-search",
        component: "AlgoliaPagination",
      },
    ],
    checks: ["Search and see hits"],
    estimate: { build: "small" },
  });

  it("boxes sit in their planned cells, with the planned column widths", () => {
    const pre = previewBoxes(store());
    assert_cols(pre);
    const at = (title) => pre.boxes.find((b) => b.title === title).area;
    expect(at("Search Box")).toEqual({
      gridRow: "1 / span 1",
      gridColumn: "1 / span 2",
    });
    expect(at("Hits")).toEqual({
      gridRow: "2 / span 2",
      gridColumn: "2 / span 1",
    });
    expect(at("Pagination")).toEqual({
      gridRow: "4 / span 1",
      gridColumn: "1 / span 2",
    });
  });

  it("without a grid, boxes flow as before", () => {
    const plan = store();
    delete plan.pieces[0].pages[0].grid;
    const pre = previewBoxes(plan);
    expect(pre.template).toBeNull();
    expect(pre.boxes.every((b) => !b.area)).toBe(true);
  });

  function assert_cols(pre) {
    expect(pre.cols).toBe(2);
    expect(pre.template).toBe("25% minmax(0, 1fr)");
  }
});
