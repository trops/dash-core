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
  CommandPalette.Item = ({ children, onSelect }) => (
    <button onClick={onSelect}>{children}</button>
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
