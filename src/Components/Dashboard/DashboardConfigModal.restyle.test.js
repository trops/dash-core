/**
 * Dashboard Config restyle, slice 1 — the modal's frame and list tabs
 * (Providers, Listeners, Widgets) match the Bots view (bot-teams TEAM-011
 * follow-up): Bots-view tab strip, dashboard name under the title, an amber
 * dot + text for unresolved providers, theme-token list rows, and a calm
 * Required row instead of a red block.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DashboardConfigModal } from "./DashboardConfigModal";

jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: jest.fn().mockReturnValue(null) },
}));

const fs = require("fs");
const path = require("path");

const workspace = {
  id: 42,
  name: "Kitchen Sink",
  layout: [
    {
      id: 1,
      uuidString: "w-slack-1",
      component: "SlackWidget",
      dashboardId: 42,
    },
    {
      id: 2,
      uuidString: "w-gmail-1",
      component: "GmailWidget",
      dashboardId: 42,
    },
  ],
};

const requirements = {
  SlackWidget: [{ type: "slack", required: true }],
  GmailWidget: [{ type: "gmail", required: false }],
};

function renderModal(props = {}) {
  return render(
    <DashboardConfigModal
      isOpen
      setIsOpen={() => {}}
      workspace={workspace}
      appProviders={{ "Slack Work": { type: "slack" } }}
      getWidgetRequirements={(c) => requirements[c] || []}
      getWidgetConfig={() => ({})}
      onSaveBindings={() => {}}
      onSaveListeners={() => {}}
      {...props}
    />,
  );
}

describe("Dashboard Config — frame", () => {
  it("shows the dashboard's name under the title", () => {
    renderModal();
    expect(screen.getByText("Dashboard Config")).toBeInTheDocument();
    expect(screen.getByText("Kitchen Sink")).toBeInTheDocument();
  });

  it("shows unresolved providers as an amber dot and text, not a tag", () => {
    renderModal();
    const unresolved = screen.getByTestId("config-unresolved");
    expect(unresolved).toHaveTextContent("1 unresolved");
    expect(unresolved).toHaveClass("text-amber-400");
    expect(
      unresolved.querySelector(".bg-amber-400.rounded-full"),
    ).not.toBeNull();
  });

  it("has a Bots-view tab strip with proper tab semantics", () => {
    renderModal();
    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringMatching(/^Providers/),
      "Listeners",
      "Notifications",
      "Widgets",
      "Permissions",
      "Bots",
      expect.stringMatching(/^Dependencies/),
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
  });
});

describe("Dashboard Config — Providers tab", () => {
  it("lists provider types as Bots-view rows; the selected one is marked", () => {
    renderModal();
    const slack = screen.getByRole("button", { name: /^slack/ });
    expect(slack).toHaveAttribute("aria-current", "true");
    expect(slack).toHaveClass("rounded-lg");
    const gmail = screen.getByRole("button", { name: /^gmail/ });
    expect(gmail).not.toHaveAttribute("aria-current");
  });

  it("a missing required provider is a calm row with an amber Required label", () => {
    renderModal();
    const row = screen.getByTestId("provider-row");
    expect(row.className).not.toMatch(/bg-red-/);
    const label = within(row).getByText("Required");
    expect(label).toHaveClass("text-amber-400");
  });

  it("an optional provider's row says Optional in muted text", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /^gmail/ }));
    const row = screen.getByTestId("provider-row");
    expect(within(row).getByText("Optional")).not.toHaveClass("text-amber-400");
  });
});

describe("Dashboard Config — list headings", () => {
  it("use dash-react's SectionLabel, like the Bots view", () => {
    const src = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
    for (const [file, labels] of [
      [
        "DashboardConfigModal.js",
        ["Provider Types", "Per-widget", "Widgets", "Event Handlers"],
      ],
      ["WidgetsTab.js", ["{section}"]],
    ]) {
      for (const label of labels) {
        expect(src(file)).toMatch(
          new RegExp(
            `<SectionLabel[^>]*>\\s*${label.replace(/[{}]/g, "\\$&")}\\s*</SectionLabel>`,
          ),
        );
      }
    }
  });
});

describe("Dashboard Config — slice 1 uses theme tokens", () => {
  const modalSrc = fs.readFileSync(
    path.join(__dirname, "DashboardConfigModal.js"),
    "utf8",
  );
  const widgetsSrc = fs.readFileSync(
    path.join(__dirname, "WidgetsTab.js"),
    "utf8",
  );
  const between = (src, start, end) => {
    const a = src.indexOf(start);
    const b = end ? src.indexOf(end, a) : src.length;
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    return src.slice(a, b);
  };
  const regions = {
    "modal frame": between(
      modalSrc,
      "export const DashboardConfigModal",
      "function NotificationsTab",
    ),
    ProvidersTab: between(
      modalSrc,
      "function ProvidersTab",
      "function ProviderTypeRow",
    ),
    "Listeners tab": between(modalSrc, "function ListenersTab", null),
    WidgetsTab: widgetsSrc,
  };
  // Bare greys / indigo / red fills, white-opacity tints and arbitrary
  // values don't follow the theme (or don't exist in the prebuilt CSS).
  // A bare class is fine only as a `currentTheme[...] || "…"` fallback.
  const BANNED =
    /(?:bg|text|border)-(?:gray|red)-\d+|bg-indigo-\d+|text-indigo-\d+|(?:bg|border)-white\/\d+|(?:text|min-w|w)-\[[^\]]+\]/;

  for (const [name, src] of Object.entries(regions)) {
    it(`${name}: no bare theme-blind colours outside fallbacks`, () => {
      const offenders = src
        .split("\n")
        .filter((line) => BANNED.test(line) && !/\|\|\s*"/.test(line))
        .map((line) => line.trim());
      expect(offenders).toEqual([]);
    });
  }
});
