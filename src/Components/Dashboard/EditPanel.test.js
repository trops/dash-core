import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditPanel } from "./EditPanel";
import { ThemeContext } from "../../Context";

// The Context barrel pulls in the layout builder; the panel only needs
// ThemeContext. The Add tab's library has its own tests.
jest.mock("../../Context", () => ({
  ThemeContext: require("react").createContext({ currentTheme: {} }),
}));
jest.mock("../Theme/ThemeColorDots", () => ({ ThemeColorDots: () => null }));
jest.mock("../Navigation/WidgetSidebar", () => ({
  WidgetSidebar: (props) => (
    <div data-testid="widget-library">
      {props.embedded ? "embedded" : "standalone"} · {props.username || ""}
    </div>
  ),
}));

const workspace = {
  id: 7,
  name: "Inbox triage",
  menuId: 2,
  themeKey: "t1",
};
const themes = {
  t1: { name: "Bluish Hue" },
  t2: { name: "Crimson Glow" },
};

function renderPanel(props = {}) {
  const handlers = {
    onNameChange: jest.fn(),
    onFolderChange: jest.fn(),
    onThemeChange: jest.fn(),
    onScrollableChange: jest.fn(),
    onSidebarChange: jest.fn(),
    onOpenConfig: jest.fn(),
  };
  render(
    <ThemeContext.Provider value={{ currentTheme: {}, themes: {} }}>
      <EditPanel
        workspace={workspace}
        menuItems={[
          { id: 1, name: "Work" },
          { id: 2, name: "Home" },
        ]}
        themes={themes}
        scrollableEnabled={false}
        sidebarEnabled={true}
        username="trops"
        {...handlers}
        {...props}
      />
    </ThemeContext.Provider>,
  );
  return handlers;
}

describe("EditPanel (phase 1b)", () => {
  test("opens on Add, showing the widget library embedded", () => {
    renderPanel();
    expect(screen.getByRole("tab", { name: "Add" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("widget-library")).toHaveTextContent(
      "embedded · trops",
    );
  });

  test("Dashboard tab edits the name and toggles", () => {
    const h = renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
    fireEvent.change(screen.getByDisplayValue("Inbox triage"), {
      target: { value: "Inbox" },
    });
    expect(h.onNameChange).toHaveBeenCalledWith("Inbox");
    fireEvent.click(screen.getByText("Scrollable"));
    expect(h.onScrollableChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText("Pinned sidebar"));
    expect(h.onSidebarChange).toHaveBeenCalledWith(false);
  });

  test("Dashboard tab opens Dashboard Config, with the unresolved count", () => {
    const h = renderPanel({ configUnresolvedCount: 2 });
    fireEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
    expect(screen.getByText(/2 widgets need a provider/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Dashboard Config"));
    expect(h.onOpenConfig).toHaveBeenCalled();
  });

  test("Scrollable is hidden when the dashboard has several pages", () => {
    renderPanel({ onScrollableChange: null });
    fireEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
    expect(screen.queryByText("Scrollable")).toBeNull();
  });

  test("Theme tab lists themes, marks the current one and picks another", () => {
    const h = renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Theme" }));
    expect(screen.getByRole("radio", { name: /Bluish Hue/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Crimson Glow/ }));
    expect(h.onThemeChange).toHaveBeenCalledWith("t2");
  });
});
