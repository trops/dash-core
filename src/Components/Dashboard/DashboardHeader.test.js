import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardHeader } from "./DashboardHeader";
import { ThemeContext } from "../../Context";

// The Context barrel pulls in the layout builder; the header only needs
// ThemeContext.
jest.mock("../../Context", () => ({
  ThemeContext: require("react").createContext({ currentTheme: {} }),
}));
jest.mock("../Theme/ThemeColorDots", () => ({ ThemeColorDots: () => null }));

const workspace = { id: 7, name: "kitchen sink" };

function renderHeader(props = {}) {
  return render(
    <ThemeContext.Provider value={{ currentTheme: {}, themes: {} }}>
      <DashboardHeader workspace={workspace} preview {...props} />
    </ThemeContext.Provider>,
  );
}

describe("DashboardHeader — Dashboard | Bots switch (TEAM-011)", () => {
  it("is hidden when the host doesn't offer the Bots view", () => {
    renderHeader();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("Kitchen sink")).toBeInTheDocument();
  });

  it("switches between Dashboard and Bots", () => {
    const onStageModeChange = jest.fn();
    renderHeader({ stageMode: "dashboard", onStageModeChange });
    const group = screen.getByRole("radiogroup", { name: "View" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Dashboard/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: /Bots/ }));
    expect(onStageModeChange).toHaveBeenCalledWith("bots");
  });

  it("shows the attention count on Bots", () => {
    renderHeader({
      stageMode: "dashboard",
      onStageModeChange: jest.fn(),
      botsAttention: 3,
    });
    expect(screen.getByRole("radio", { name: /Bots/ })).toHaveTextContent("3");
    expect(screen.getByLabelText("3 need attention")).toBeInTheDocument();
  });

  it("no badge when nothing needs attention", () => {
    renderHeader({
      stageMode: "bots",
      onStageModeChange: jest.fn(),
      botsAttention: 0,
    });
    expect(screen.queryByLabelText(/need attention/)).toBeNull();
  });

  it("hides Pop out while the Bots view is showing", () => {
    renderHeader({
      stageMode: "bots",
      onStageModeChange: jest.fn(),
      onPopout: jest.fn(),
      onClickEdit: jest.fn(),
    });
    expect(screen.queryByLabelText("Pop out")).toBeNull();
    expect(screen.getByLabelText("Edit dashboard")).toBeInTheDocument();
  });

  it("is not shown in edit mode", () => {
    renderHeader({
      preview: false,
      stageMode: "dashboard",
      onStageModeChange: jest.fn(),
    });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
