/**
 * useConfigTokens reads the design guide's color-role keys (dash-react
 * DASH_ROLES) and keeps its Tailwind fallbacks.
 */
import React from "react";
import { render } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { useConfigTokens } from "./ConfigListRow";

function tokensFor(currentTheme) {
  let out = null;
  const Probe = () => {
    out = useConfigTokens();
    return null;
  };
  render(
    <ThemeContext.Provider value={{ currentTheme }}>
      <Probe />
    </ThemeContext.Provider>,
  );
  return out;
}

describe("useConfigTokens", () => {
  test("maps each token to its role's theme key", () => {
    const t = tokensFor({
      "text-neutral-medium": "text-gray-600",
      "text-neutral-light": "text-gray-700",
      "border-neutral-dark": "border-gray-200",
      "bg-neutral-very-dark": "bg-gray-100",
      "border-primary-dark": "border-indigo-200",
      "text-primary-medium": "text-indigo-600",
    });
    expect(t).toEqual({
      muted: "text-gray-600 dr-role-muted",
      strong: "text-gray-700 dr-role-text",
      hairline: "border-gray-200 dr-role-hairline",
      selectedBg: "bg-gray-100 dr-role-surface",
      selectedBorder: "border-indigo-200",
      fieldBg: "bg-gray-100 dr-role-well",
      accent: "text-indigo-600 dr-role-accent",
    });
  });

  test("falls back to Tailwind shades without a theme", () => {
    const t = tokensFor(null);
    expect(t.muted).toBe("text-gray-400 dr-role-muted");
    expect(t.fieldBg).toBe("bg-gray-900 dr-role-well");
  });
});
