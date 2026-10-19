/**
 * DashCommandPalette — "Go to" the Manage pages (app-navigation NAV-004 AC3).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";

jest.mock("@trops/dash-react", () => {
  const React = require("react");
  const CommandPalette = ({ isOpen, children }) =>
    isOpen ? <div role="dialog">{children}</div> : null;
  CommandPalette.Group = ({ label, children }) => (
    <section aria-label={label}>{children}</section>
  );
  CommandPalette.Item = ({ children, onSelect, shortcut }) => (
    <button onClick={onSelect} data-shortcut={shortcut || undefined}>
      {children}
    </button>
  );
  return {
    CommandPalette,
    FontAwesomeIcon: ({ icon }) => <span data-icon={icon} />,
  };
});

import { DashCommandPalette } from "./DashCommandPalette";

describe("DashCommandPalette — Go to", () => {
  it("lists the Manage pages and opens the chosen one", () => {
    const onOpenPage = jest.fn();
    const setIsOpen = jest.fn();
    render(
      <DashCommandPalette
        isOpen
        setIsOpen={setIsOpen}
        onOpenPage={onOpenPage}
      />,
    );
    const goTo = screen.getByRole("region", { name: "Go to" });
    expect(
      within(goTo)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Dashboards", "Bots", "Providers", "Widgets", "Themes"]);
    fireEvent.click(within(goTo).getByText("Providers"));
    expect(onOpenPage).toHaveBeenCalledWith("providers");
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  it("is hidden without onOpenPage", () => {
    render(<DashCommandPalette isOpen setIsOpen={() => {}} />);
    expect(screen.queryByRole("region", { name: "Go to" })).toBeNull();
  });
});

describe("DashCommandPalette — Providers (app-navigation NAV-007 AC2)", () => {
  it("a provider result opens it on the Providers page", () => {
    const onOpenProviderDetail = jest.fn();
    const setIsOpen = jest.fn();
    render(
      <DashCommandPalette
        isOpen
        setIsOpen={setIsOpen}
        providers={{ Gong: { type: "gong" } }}
        onOpenProviderDetail={onOpenProviderDetail}
      />,
    );
    const group = screen.getByRole("region", { name: "Providers" });
    fireEvent.click(within(group).getByText("Gong"));
    expect(onOpenProviderDetail).toHaveBeenCalledWith("Gong");
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });
});

describe("DashCommandPalette — Create… (create-entry PRD CRE-001 AC1)", () => {
  it("opens the Create screen", () => {
    const onCreate = jest.fn();
    const setIsOpen = jest.fn();
    render(
      <DashCommandPalette isOpen setIsOpen={setIsOpen} onCreate={onCreate} />,
    );
    fireEvent.click(screen.getByText("Create…"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  // Consolidation Phase 2a: ⌘N opens Create (DashboardStage binds it), so
  // the hint is on Create…; New Dashboard opens Create on Dashboard and the
  // Wizard is gone.
  it("shows ⌘N on Create…, and no Dashboard Wizard", () => {
    const onCreateNewWorkspace = jest.fn();
    render(
      <DashCommandPalette
        isOpen
        setIsOpen={() => {}}
        onCreate={() => {}}
        onCreateNewWorkspace={onCreateNewWorkspace}
      />,
    );
    expect(screen.getByText("Create…").closest("button")).toHaveAttribute(
      "data-shortcut",
      "⌘N",
    );
    expect(
      screen.getByText("New Dashboard").closest("button"),
    ).not.toHaveAttribute("data-shortcut");
    expect(screen.queryByText("Dashboard Wizard")).toBeNull();
    fireEvent.click(screen.getByText("New Dashboard"));
    expect(onCreateNewWorkspace).toHaveBeenCalled();
  });

  it("is hidden without onCreate", () => {
    render(<DashCommandPalette isOpen setIsOpen={() => {}} />);
    expect(screen.queryByText("Create…")).toBeNull();
  });
});
