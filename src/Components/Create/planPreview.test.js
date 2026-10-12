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
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryAllByTestId("plan-preview-box")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getAllByTestId("plan-preview-box")).toHaveLength(3);
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
