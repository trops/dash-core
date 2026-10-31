/**
 * A dashboard's theme colours the dashboard only: the app (sidebar, tabs,
 * header, Lead) keeps the app theme's colours.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { DashboardThemeProvider } from "./DashboardThemeProvider";

const appTheme = {
  "bg-primary-very-dark": "bg-[var(--primary-900)]",
  cssVars: { "--primary-900": "#101820" },
};
const brown = {
  "bg-primary-very-dark": "bg-[var(--primary-900)]",
  cssVars: { "--primary-900": "#4a2a1a", "--accent-500": "#e08a3c" },
};

const renderWith = (themeKey) =>
  render(
    <ThemeContext.Provider
      value={{
        currentTheme: appTheme,
        currentThemeKey: "app",
        themeVariant: "dark",
        themes: { app: { dark: appTheme }, brown: { dark: brown } },
      }}
    >
      <span data-testid="chrome">app chrome</span>
      <DashboardThemeProvider themeKey={themeKey}>
        <span data-testid="widget">widget</span>
      </DashboardThemeProvider>
    </ThemeContext.Provider>,
  );

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

test("the dashboard's colours sit on the dashboard, not the page", () => {
  document.documentElement.style.setProperty("--primary-900", "#101820");
  renderWith("brown");
  const box = screen.getByTestId("widget").parentElement;
  expect(box).toHaveAttribute("data-dashboard-theme", "brown");
  expect(box.style.getPropertyValue("--primary-900")).toBe("#4a2a1a");
  expect(box.style.display).toBe("contents");
  // The app's own colour on the page is untouched.
  expect(document.documentElement.style.getPropertyValue("--primary-900")).toBe(
    "#101820",
  );
});

test("colours the app theme doesn't set are filled on the page (for dialogs), and removed after", () => {
  const { unmount } = renderWith("brown");
  expect(document.documentElement.style.getPropertyValue("--accent-500")).toBe(
    "#e08a3c",
  );
  expect(document.documentElement.style.getPropertyValue("--primary-900")).toBe(
    "",
  );
  unmount();
  expect(document.documentElement.style.getPropertyValue("--accent-500")).toBe(
    "",
  );
});

test("no theme of its own: nothing wrapped, nothing written", () => {
  renderWith(null);
  expect(screen.getByTestId("widget").parentElement).not.toHaveAttribute(
    "data-dashboard-theme",
  );
  expect(document.documentElement.getAttribute("style")).toBeNull();
});
