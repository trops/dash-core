/**
 * WidgetCardStatusBar — rendering + theme-compliance pins.
 *
 * The footer strip renders under every widget with scheduled tasks, so
 * it must follow the light/dark theme: no hardcoded Tailwind colors
 * (which render dark-only, and opacity modifiers like `bg-gray-900/30`
 * aren't in the prebuilt CSS bundle).
 */
import React from "react";
import fs from "fs";
import path from "path";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeContext } from "@trops/dash-react";
import { WidgetCardStatusBar } from "./WidgetCardStatusBar";

jest.mock("../../../../ComponentManager", () => ({
  ComponentManager: {
    config: () => ({ scheduledTasks: [{ key: "refreshData" }] }),
  },
}));

const mockStatus = { tasks: [], isLoading: false };
jest.mock("../../../../hooks/useWidgetSchedulerStatus", () => ({
  useWidgetSchedulerStatus: () => mockStatus,
}));

const THEME = {
  "bg-primary-dark": "bg-theme-surface",
  "border-primary-dark": "border-theme-line",
  "hover-bg-primary-dark": "hover:bg-theme-hover",
  "text-secondary-medium": "text-theme-accent",
  "text-primary-medium": "text-theme-body",
  "bg-primary-medium": "bg-theme-idle",
};

const HARDCODED =
  /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border)-(?:gray|blue|green|red|white|black)(?:-\d{2,3})?(?:\/\d+)?\b/;

function renderBar(tasks) {
  mockStatus.tasks = tasks;
  return render(
    <ThemeContext.Provider value={{ currentTheme: THEME }}>
      <WidgetCardStatusBar item={{ uuid: "w1", component: "Scheduler" }} />
    </ThemeContext.Provider>,
  );
}

const NOW = Date.now();
const TASKS = [
  {
    taskId: "t1",
    taskKey: "refreshData",
    enabled: true,
    nextFireAt: NOW + 4000,
    lastFiredAt: NOW - 10000,
    fireCount: 3,
  },
  {
    taskId: "t2",
    taskKey: "generateReport",
    enabled: false,
    nextFireAt: null,
    fireCount: 0,
  },
];

describe("WidgetCardStatusBar", () => {
  test("renders nothing when there are no tasks", () => {
    const { container } = renderBar([]);
    expect(container).toBeEmptyDOMElement();
  });

  test("collapsed strip summarises the timers", () => {
    renderBar(TASKS);
    expect(screen.getByText(/2 timers · next in/)).toBeInTheDocument();
  });

  test("expands to show per-task detail", () => {
    renderBar(TASKS);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Scheduled Tasks")).toBeInTheDocument();
    expect(screen.getByText("refreshData")).toBeInTheDocument();
    expect(screen.getByText("generateReport")).toBeInTheDocument();
  });

  test("uses theme tokens for the strip surface, border and accent", () => {
    const { container } = renderBar(TASKS);
    const html = container.innerHTML;
    expect(html).toMatch(/bg-theme-surface/);
    expect(html).toMatch(/border-theme-line/);
    expect(html).toMatch(/text-theme-accent/);
  });

  test("strip is a rounded, bordered block (matches the card above it)", () => {
    const { container } = renderBar(TASKS);
    const strip = container.firstChild;
    // getStylesForItem is mocked to {} → falls back to rounded-lg.
    expect(strip.className).toMatch(/\brounded-lg\b/);
    expect(strip.className).toMatch(/(^|\s)border(\s|$)/);
    expect(strip.className).not.toMatch(/\bborder-t\b/);
  });

  test("enabled-task dot uses the status token, paused dot the theme", () => {
    const { container } = renderBar(TASKS);
    fireEvent.click(screen.getByRole("button"));
    const dots = container.querySelectorAll("span.rounded-full");
    // useStatusTokens() mock (src/__mocks__/dash-react.js) → success.solidBg
    expect(dots[0].className).toMatch(/bg-green-500/);
    expect(dots[1].className).toMatch(/bg-theme-idle/);
  });

  test("component source contains no hardcoded color classes", () => {
    // Checked on the source (not the rendered HTML) because status colors
    // legitimately arrive as Tailwind classes from useStatusTokens().
    const src = fs
      .readFileSync(path.join(__dirname, "WidgetCardStatusBar.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(src).not.toMatch(HARDCODED);
    expect(src).not.toMatch(/(?:text|bg|border)-\[/);
  });
});
