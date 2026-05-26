import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WizardThemePreview } from "./WizardThemePreview";

/**
 * WizardThemePreview — Phase 3B wizard polish.
 *
 * Pins the small static preview that renders the chosen theme's
 * primary/secondary/tertiary colors against the chosen layout
 * template's grid shape. Three behaviors worth pinning:
 *
 *   1. Render gates: missing theme → null; theme with no color
 *      families → null. Either case would otherwise paint an empty
 *      box that looks broken.
 *   2. Grid shape follows templateKey. Unknown / missing template
 *      keys fall back to 2×2 so the preview always has a sensible
 *      shape.
 *   3. Cells rotate through the family list in order. This is the
 *      load-bearing visual signal — if the order ever drifts, the
 *      preview no longer matches the swatches above the tile.
 */

const NORDIC_THEME = {
  name: "Nordic Frost",
  primary: "sky",
  secondary: "slate",
  tertiary: "blue",
};

describe("WizardThemePreview", () => {
  test("returns null when no theme is provided", () => {
    const { container } = render(<WizardThemePreview theme={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("returns null when theme has no color families", () => {
    const { container } = render(
      <WizardThemePreview theme={{ name: "Empty" }} templateKey="two-by-two" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("renders header with theme name + grid shape annotation", () => {
    render(
      <WizardThemePreview theme={NORDIC_THEME} templateKey="two-by-two" />,
    );
    expect(screen.getByText(/Nordic Frost/)).toBeInTheDocument();
    expect(screen.getByText(/2×2/)).toBeInTheDocument();
  });

  test("renders one cell per row*col for the chosen template", () => {
    const cases = [
      { templateKey: "single", expected: 1 },
      { templateKey: "two-columns", expected: 2 },
      { templateKey: "two-rows", expected: 2 },
      { templateKey: "three-columns", expected: 3 },
      { templateKey: "two-by-two", expected: 4 },
      { templateKey: "two-by-three", expected: 6 },
      { templateKey: "three-by-three", expected: 9 },
    ];
    for (const { templateKey, expected } of cases) {
      const { unmount } = render(
        <WizardThemePreview theme={NORDIC_THEME} templateKey={templateKey} />,
      );
      const cells = screen
        .getAllByTestId(/wizard-theme-preview-cell-/)
        .map((el) => el.getAttribute("data-testid"));
      expect(cells).toHaveLength(expected);
      unmount();
    }
  });

  test("unknown template key falls back to 2×2 (never blank)", () => {
    render(
      <WizardThemePreview
        theme={NORDIC_THEME}
        templateKey="not-a-real-template"
      />,
    );
    const cells = screen.getAllByTestId(/wizard-theme-preview-cell-/);
    expect(cells).toHaveLength(4);
  });

  test("missing template key falls back to 2×2", () => {
    render(<WizardThemePreview theme={NORDIC_THEME} />);
    const cells = screen.getAllByTestId(/wizard-theme-preview-cell-/);
    expect(cells).toHaveLength(4);
  });

  test("cells rotate through primary → secondary → tertiary in order", () => {
    render(
      <WizardThemePreview theme={NORDIC_THEME} templateKey="two-by-two" />,
    );
    const families = [
      "wizard-theme-preview-cell-0",
      "wizard-theme-preview-cell-1",
      "wizard-theme-preview-cell-2",
      "wizard-theme-preview-cell-3",
    ].map((id) => screen.getByTestId(id).getAttribute("data-family"));
    // 4 cells across 3 families: sky, slate, blue, sky
    expect(families).toEqual(["sky", "slate", "blue", "sky"]);
  });

  test("only uses families that exist on the theme (skips falsy)", () => {
    render(
      <WizardThemePreview
        theme={{ name: "Mono", primary: "indigo" }}
        templateKey="three-columns"
      />,
    );
    const families = [0, 1, 2].map((i) =>
      screen
        .getByTestId(`wizard-theme-preview-cell-${i}`)
        .getAttribute("data-family"),
    );
    expect(families).toEqual(["indigo", "indigo", "indigo"]);
  });
});
