import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DashTabBar } from "./DashTabBar";

const tabs = [
  { id: 7, name: "kitchen sink", workspace: { id: 7 } },
  { id: "page:bots", kind: "page", pageKey: "bots", name: "Bots" },
];

describe("DashTabBar — dashboards and Manage pages (app-navigation NAV-002)", () => {
  it("shows a page tab with its page's icon; dashboard tabs have none", () => {
    render(<DashTabBar tabs={tabs} activeTabId="page:bots" />);
    const bots = screen.getByText("Bots").closest("button");
    expect(within(bots).getByTestId("icon-robot")).toBeInTheDocument();
    const ks = screen.getByText("Kitchen sink").closest("button");
    expect(within(ks).queryByTestId("icon-robot")).toBeNull();
    expect(bots).toHaveAttribute("aria-current", "true");
    expect(ks).not.toHaveAttribute("aria-current");
  });

  it("switches and closes page tabs by id", () => {
    const onSwitchTab = jest.fn();
    const onCloseTab = jest.fn();
    render(
      <DashTabBar
        tabs={tabs}
        activeTabId={7}
        onSwitchTab={onSwitchTab}
        onCloseTab={onCloseTab}
      />,
    );
    fireEvent.click(screen.getByText("Bots"));
    expect(onSwitchTab).toHaveBeenCalledWith("page:bots");
    fireEvent.click(screen.getByLabelText("Close Bots"));
    expect(onCloseTab).toHaveBeenCalledWith("page:bots");
    expect(onSwitchTab).toHaveBeenCalledTimes(1);
  });
});
