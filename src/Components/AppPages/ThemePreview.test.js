/**
 * ThemePreview — a mock dashboard drawn in a theme's own colours
 * (app-navigation PRD NAV-009 AC2).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { ThemePreview } from "./ThemePreview";

const variant = (prefix) => ({
  cssValue: {
    "bg-neutral-very-dark": `${prefix}01`,
    "bg-neutral-dark": `${prefix}02`,
    "bg-neutral-medium": `${prefix}03`,
    "border-neutral-medium": `${prefix}04`,
    "bg-primary-dark": `${prefix}05`,
    "bg-primary-medium": `${prefix}06`,
    "bg-secondary-dark": `${prefix}07`,
    "bg-tertiary-medium": `${prefix}08`,
    "text-neutral-light": `${prefix}09`,
    "text-neutral-medium": `${prefix}10`,
    "text-secondary-light": `${prefix}11`,
  },
});
const theme = {
  name: "Aurora",
  dark: variant("#1111"),
  light: variant("#2222"),
};

const hex = (el, prop) => el.style[prop];

describe("ThemePreview", () => {
  it("draws the dashboard in the chosen variant's colours", () => {
    render(<ThemePreview theme={theme} variant="dark" />);
    const root = screen.getByTestId("theme-preview");
    expect(hex(root, "backgroundColor")).toBe("rgb(17, 17, 1)");
    expect(hex(screen.getByTestId("preview-header"), "backgroundColor")).toBe(
      "rgb(17, 17, 5)",
    );
    expect(screen.getAllByTestId("preview-card")).toHaveLength(3);
    expect(hex(screen.getByTestId("preview-button"), "backgroundColor")).toBe(
      "rgb(17, 17, 6)",
    );
  });

  it("switches to the light variant", () => {
    render(<ThemePreview theme={theme} variant="light" />);
    expect(hex(screen.getByTestId("theme-preview"), "backgroundColor")).toBe(
      "rgb(34, 34, 1)",
    );
  });

  it("says when there's nothing to draw", () => {
    render(<ThemePreview theme={null} variant="dark" />);
    expect(screen.getByText("No preview for this theme")).toBeInTheDocument();
  });
});
