import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { TeamChartLegend } from "./TeamChartLegend";

describe("TeamChartLegend (DASH-139)", () => {
  it("explains the selected, linked, failure and dimmed styles", () => {
    render(<TeamChartLegend />);
    const legend = screen.getByTestId("team-chart-legend");
    for (const label of ["Selected", "Linked", "Gets its failures", "Dimmed"]) {
      expect(legend).toHaveTextContent(label);
    }
  });
});
